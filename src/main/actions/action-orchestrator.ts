import { randomUUID } from "node:crypto";
import {
  ACTION_ERROR_CODES,
  ACTION_NAMES,
  type ActionLifecycleResult,
  type ActionOperationResult,
  type ActionOutcome,
  type ActionPolicy,
  type ActionSubmission,
  type ApprovedWebActionProposal,
  type AwaitingActionConfirmation,
  type ExecutableActionProposal,
  type FileActionProposal,
  type FileActionData,
  type HabitActionProposal,
  type LegacyFileActionProposal,
  type OpenWebPageActionProposal,
  type PlannerActionProposal,
  type RegisterCatalogApplicationActionProposal,
  type RequestCustomApplicationRegistrationActionProposal,
  type SafeHistoryMetadata,
  type SupervisedFilesActionProposal,
  type SupervisedFilesActionSubmission,
  type WeatherActionProposal
} from "../../shared/action-contracts";
import { createActionHistoryService, type ActionHistoryService } from "./action-history-service";
import { evaluateActionProposal, getActionPolicy } from "./action-policy";
import { createActionExecutor, type ActionExecutor } from "./action-executor";
import { isFoundOrdinal, isFileSearchKind, isSupervisedFileRoot, parseSelection } from "../files/supervised-file-validation";
import type { SupervisedFileMutationData, SupervisedFileSearchData } from "../../shared/supervised-file-contracts";
import { isKnownApplicationCatalogKey } from "../applications/known-application-catalog";
import { catalogRegistrationFailure } from "../applications/catalog-registration-failures";

const PENDING_PROPOSAL_LIFETIME_MS = 5 * 60 * 1000;

type PendingProposal = {
  proposal: ExecutableActionProposal;
  policy: ActionPolicy;
  confirmationId: string;
  startedAt: Date;
  expiresAt: Date;
  state: "AWAITING_CONFIRMATION" | "RUNNING";
};

type ActionOrchestratorDependencies = {
  executor: ActionExecutor;
  historyService: ActionHistoryService;
  generateIdentifier: () => string;
  now: () => Date;
  logError: (message: string) => void;
};

export type ActionOrchestrator = {
  propose: (submission: unknown) => Promise<ActionOperationResult<ActionLifecycleResult>>;
  confirm: (confirmationId: unknown) => Promise<ActionOperationResult<ActionOutcome>>;
  cancel: (confirmationId: unknown) => Promise<ActionOperationResult<ActionOutcome>>;
  confirmEventDeletion: (eventId: unknown, confirmationId: unknown) => Promise<ActionOperationResult<ActionOutcome>>;
  cancelEventDeletion: (eventId: unknown, confirmationId: unknown) => Promise<ActionOperationResult<ActionOutcome>>;
  confirmTaskDeletion: (taskId: unknown, confirmationId: unknown) => Promise<ActionOperationResult<ActionOutcome>>;
  cancelTaskDeletion: (taskId: unknown, confirmationId: unknown) => Promise<ActionOperationResult<ActionOutcome>>;
};

const messages = {
  [ACTION_ERROR_CODES.proposalInvalid]: "La propuesta de acción no es válida.",
  [ACTION_ERROR_CODES.confirmationInvalid]: "La confirmación de la acción no es válida.",
  [ACTION_ERROR_CODES.confirmationUnavailable]: "La confirmación ya no está disponible.",
  [ACTION_ERROR_CODES.executionUnavailable]: "No se pudo completar la acción solicitada."
} as const;

type OrchestratorErrorCode = keyof typeof messages;

const createFailure = <T>(code: OrchestratorErrorCode): ActionOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: messages[code] }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isActionName = (value: unknown): value is ActionSubmission["action"] =>
  typeof value === "string" && ACTION_NAMES.includes(value as ActionSubmission["action"]);

const hasOnlySubmissionKeys = (value: Record<string, unknown>): boolean =>
  Object.keys(value).every((key) => key === "action" || key === "input");

const isPlannerAction = (action: ActionSubmission["action"]): action is PlannerActionProposal["action"] =>
  [
    "CREATE_TASK",
    "UPDATE_TASK",
    "COMPLETE_TASK",
    "CREATE_EVENT",
    "UPDATE_EVENT",
    "CREATE_REMINDER",
    "GET_TODAY_SCHEDULE",
    "GET_WEEK_SCHEDULE",
    "GET_WEEKLY_SCHEDULE_DETAILS",
    "ANALYZE_WEEKLY_SCHEDULE",
    "GET_TODAY_AVAILABILITY",
    "CREATE_WEEKLY_SCHEDULE",
    "UPDATE_WEEKLY_SCHEDULE",
    "CREATE_WEEKLY_ROUTINE",
    "UPDATE_WEEKLY_ROUTINE",
    "GET_CURRENT_DATE_TIME",
    "DELETE_EVENT",
    "DELETE_TASK"
  ].includes(action as PlannerActionProposal["action"]);

const isHabitAction = (action: ActionSubmission["action"]): action is HabitActionProposal["action"] =>
  ["GET_HABIT_PROGRESS", "CREATE_HABIT", "UPDATE_HABIT", "COMPLETE_HABIT"].includes(action as HabitActionProposal["action"]);

const isOpenApplicationSubmission = (
  submission: Record<string, unknown>
): submission is { action: "OPEN_APPLICATION"; input: { alias: string } } =>
  submission.action === "OPEN_APPLICATION" &&
  typeof submission.input === "object" &&
  submission.input !== null &&
  !Array.isArray(submission.input) &&
  Object.keys(submission.input).length === 1 &&
    typeof (submission.input as { alias?: unknown }).alias === "string";

const isRegisterCatalogApplicationSubmission = (
  submission: Record<string, unknown>
): submission is { action: "REGISTER_CATALOG_APPLICATION"; input: { catalogKey: string; alias?: string } } =>
  submission.action === "REGISTER_CATALOG_APPLICATION" &&
  isRecord(submission.input) &&
  Object.keys(submission.input).every((key) => key === "catalogKey" || key === "alias") &&
  isKnownApplicationCatalogKey(submission.input.catalogKey) &&
  (submission.input.alias === undefined || typeof submission.input.alias === "string");

const isRequestCustomApplicationRegistrationSubmission = (
  submission: Record<string, unknown>
): submission is { action: "REQUEST_CUSTOM_APPLICATION_REGISTRATION"; input: { displayName?: string } } =>
  submission.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION" &&
  isRecord(submission.input) &&
  Object.keys(submission.input).every((key) => key === "displayName") &&
  (submission.input.displayName === undefined || typeof submission.input.displayName === "string");

const isOpenWebPageSubmission = (
  submission: Record<string, unknown>
): submission is { action: "OPEN_WEB_PAGE"; input: { destination: "YOUTUBE"; browser: "CHROME" } } =>
  submission.action === "OPEN_WEB_PAGE" &&
  isRecord(submission.input) &&
  Object.keys(submission.input).length === 2 &&
  submission.input.destination === "YOUTUBE" &&
  submission.input.browser === "CHROME";

const isApprovedWebActionSubmission = (
  submission: Record<string, unknown>
): submission is
  | { action: "OPEN_APPROVED_PAGE"; input: { site: "GOOGLE" | "YOUTUBE" | "SPOTIFY" } }
  | { action: "SEARCH_APPROVED_SITE"; input: { site: "GOOGLE" | "YOUTUBE" | "SPOTIFY"; query: string } } => {
  if (!isRecord(submission.input)) return false;
  if (submission.action === "OPEN_APPROVED_PAGE") {
    return Object.keys(submission.input).length === 1 && ["GOOGLE", "YOUTUBE", "SPOTIFY"].includes(submission.input.site as string);
  }
  if (submission.action === "SEARCH_APPROVED_SITE") {
    return Object.keys(submission.input).length === 2 &&
      ["GOOGLE", "YOUTUBE", "SPOTIFY"].includes(submission.input.site as string) &&
      typeof submission.input.query === "string";
  }
  return false;
};

const isApplicationAction = (action: ActionSubmission["action"]): boolean =>
  action === "OPEN_APPLICATION" || action === "OPEN_WEB_PAGE" || action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION";

const isApprovedWebAction = (action: ActionSubmission["action"]): boolean =>
  action === "OPEN_APPROVED_PAGE" || action === "SEARCH_APPROVED_SITE";

const isWeatherAction = (action: ActionSubmission["action"]): action is WeatherActionProposal["action"] =>
  action === "GET_WEATHER";

const isWeatherActionSubmission = (
  submission: Record<string, unknown>
): submission is { action: "GET_WEATHER"; input: Record<string, never> } =>
  submission.action === "GET_WEATHER" && isRecord(submission.input) && Object.keys(submission.input).length === 0;

const isWeeklyScheduleReference = (input: Record<string, unknown>): boolean =>
  (Object.keys(input).length === 1 && input.allSchedules === true) ||
  (Object.keys(input).length === 1 && typeof input.scheduleTitle === "string" && input.scheduleTitle.trim().length > 0 && input.scheduleTitle.length <= 160);

const isWeeklyScheduleSubmission = (submission: Record<string, unknown>): boolean => {
  if (!isRecord(submission.input)) return false;
  if (submission.action === "GET_WEEKLY_SCHEDULE_DETAILS") return isWeeklyScheduleReference(submission.input);
  if (submission.action === "ANALYZE_WEEKLY_SCHEDULE") {
    const { analysis, ...reference } = submission.input;
    return ["AVAILABILITY", "BUSIEST_DAY", "OVERLAPS"].includes(analysis as string) && isWeeklyScheduleReference(reference);
  }
  if (submission.action === "GET_TODAY_AVAILABILITY") return Object.keys(submission.input).length === 0 || (Object.keys(submission.input).length === 1 && typeof submission.input.afterTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(submission.input.afterTime));
  return false;
};

const isLocalTime = (value: unknown): value is string =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const isWeeklyMutationText = (value: unknown, maximumLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;

const isWeekday = (value: unknown): boolean =>
  ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].includes(value as string);

const isWeeklyMutationSubmission = (submission: Record<string, unknown>): boolean => {
  if (!isRecord(submission.input)) return false;
  const input = submission.input;
  if (submission.action === "CREATE_WEEKLY_SCHEDULE") {
    return Object.keys(input).every((key) => ["title", "description", "color"].includes(key)) &&
      isWeeklyMutationText(input.title, 240) &&
      (input.description === undefined || isWeeklyMutationText(input.description, 4000)) &&
      (input.color === undefined || (typeof input.color === "string" && /^#[0-9a-f]{6}$/iu.test(input.color)));
  }
  if (submission.action === "UPDATE_WEEKLY_SCHEDULE") {
    const changes = [input.title, input.description, input.color].filter((value) => value !== undefined);
    return Object.keys(input).every((key) => ["scheduleTitle", "title", "description", "color"].includes(key)) &&
      isWeeklyMutationText(input.scheduleTitle, 240) && changes.length > 0 &&
      (input.title === undefined || isWeeklyMutationText(input.title, 240)) &&
      (input.description === undefined || input.description === null || isWeeklyMutationText(input.description, 4000)) &&
      (input.color === undefined || input.color === null || (typeof input.color === "string" && /^#[0-9a-f]{6}$/iu.test(input.color)));
  }
  if (submission.action === "CREATE_WEEKLY_ROUTINE") {
    return Object.keys(input).every((key) => ["scheduleTitle", "title", "weekday", "startTime", "endTime", "location", "categoryName"].includes(key)) &&
      isWeeklyMutationText(input.scheduleTitle, 240) && isWeeklyMutationText(input.title, 240) && isWeekday(input.weekday) &&
      isLocalTime(input.startTime) && isLocalTime(input.endTime) && input.endTime > input.startTime &&
      (input.location === undefined || input.location === null || isWeeklyMutationText(input.location, 500)) &&
      (input.categoryName === undefined || isWeeklyMutationText(input.categoryName, 160));
  }
  if (submission.action === "UPDATE_WEEKLY_ROUTINE") {
    const changes = [input.title, input.weekday, input.startTime, input.endTime, input.location, input.categoryName].filter((value) => value !== undefined);
    return Object.keys(input).every((key) => ["scheduleTitle", "routineTitle", "targetWeekday", "targetStartTime", "targetEndTime", "title", "weekday", "startTime", "endTime", "location", "categoryName"].includes(key)) &&
      isWeeklyMutationText(input.scheduleTitle, 240) && isWeeklyMutationText(input.routineTitle, 240) && changes.length > 0 &&
      (input.targetWeekday === undefined || isWeekday(input.targetWeekday)) &&
      (input.targetStartTime === undefined || isLocalTime(input.targetStartTime)) &&
      (input.targetEndTime === undefined || isLocalTime(input.targetEndTime)) &&
      (input.title === undefined || isWeeklyMutationText(input.title, 240)) &&
      (input.weekday === undefined || isWeekday(input.weekday)) &&
      (input.startTime === undefined || isLocalTime(input.startTime)) &&
      (input.endTime === undefined || isLocalTime(input.endTime)) &&
      (input.location === undefined || isWeeklyMutationText(input.location, 500)) &&
      (input.categoryName === undefined || isWeeklyMutationText(input.categoryName, 160));
  }
  return false;
};

const isHabitText = (value: unknown, maximumLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;

const isHabitActionSubmission = (submission: Record<string, unknown>): boolean => {
  if (!isRecord(submission.input)) return false;
  const input = submission.input;
  if (submission.action === "GET_HABIT_PROGRESS") {
    return Object.keys(input).every((key) => key === "scope" || key === "habitTitle") &&
      (input.scope === "TODAY" || input.scope === "WEEK") &&
      (input.habitTitle === undefined || isHabitText(input.habitTitle, 240));
  }
  if (submission.action === "CREATE_HABIT") {
    return Object.keys(input).every((key) => ["title", "description", "frequency", "targetCount", "categoryName", "icon"].includes(key)) &&
      isHabitText(input.title, 240) && ["DAILY", "WEEKLY"].includes(input.frequency as string) &&
      typeof input.targetCount === "number" && Number.isInteger(input.targetCount) && input.targetCount >= 1 && input.targetCount <= 7 &&
      (input.description === undefined || isHabitText(input.description, 4000)) &&
      (input.categoryName === undefined || isHabitText(input.categoryName, 160)) &&
      (input.icon === undefined || ["SPARK", "BOOK", "DUMBBELL", "HOME", "HEART", "WATER", "RUNNING", "BRAIN", "LEAF"].includes(input.icon as string));
  }
  if (submission.action === "UPDATE_HABIT") {
    const changes = [input.title, input.description, input.frequency, input.targetCount, input.categoryName, input.icon].filter((value) => value !== undefined);
    return Object.keys(input).every((key) => ["habitTitle", "title", "description", "frequency", "targetCount", "categoryName", "icon"].includes(key)) &&
      isHabitText(input.habitTitle, 240) && changes.length > 0 &&
      (input.title === undefined || isHabitText(input.title, 240)) &&
      (input.description === undefined || input.description === null || isHabitText(input.description, 4000)) &&
      (input.frequency === undefined || input.frequency === "DAILY" || input.frequency === "WEEKLY") &&
      (input.targetCount === undefined || (typeof input.targetCount === "number" && Number.isInteger(input.targetCount) && input.targetCount >= 1 && input.targetCount <= 7)) &&
      (input.categoryName === undefined || input.categoryName === null || isHabitText(input.categoryName, 160)) &&
      (input.icon === undefined || ["SPARK", "BOOK", "DUMBBELL", "HOME", "HEART", "WATER", "RUNNING", "BRAIN", "LEAF"].includes(input.icon as string));
  }
  return submission.action === "COMPLETE_HABIT" && Object.keys(input).length === 1 && isHabitText(input.habitTitle, 240);
};

const isFileAction = (action: ActionSubmission["action"]): action is FileActionProposal["action"] =>
  ["SEARCH_FILES", "CREATE_FOLDER", "RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "ORGANIZE_FILES"].includes(
    action as FileActionProposal["action"]
  );

const isFileActionSubmission = (
  submission: Record<string, unknown>
): submission is { action: FileActionProposal["action"]; input: Record<string, unknown> } =>
  isFileAction(submission.action as ActionSubmission["action"]) &&
  !isSupervisedFilesAction(submission.action as ActionSubmission["action"]) &&
  isRecord(submission.input);

const SUPERVISED_FILES_ACTIONS = [
  "SEARCH_FILES",
  "REVEAL_FOUND_FILE",
  "OPEN_FOUND_FILE",
  "CREATE_FOLDER",
  "RENAME_FOUND_ITEM",
  "MOVE_FOUND_ITEMS",
  "ORGANIZE_FOUND_ITEMS",
  "DELETE_FOUND_ITEM"
] as const;

const isSupervisedFilesAction = (action: ActionSubmission["action"]): action is SupervisedFilesActionProposal["action"] =>
  (SUPERVISED_FILES_ACTIONS as readonly string[]).includes(action);

/** Strict, closed shapes: ordinals and enum values only, and never a Main-issued preparation reference. */
const isSupervisedFilesSubmission = (
  submission: Record<string, unknown>
): submission is SupervisedFilesActionSubmission => {
  if (!isRecord(submission.input)) return false;
  const input = submission.input;
  const keysAre = (allowed: readonly string[]): boolean => Object.keys(input).every((key) => allowed.includes(key));
  if (submission.action === "SEARCH_FILES") {
    return keysAre(["query", "root", "kind"]) && typeof input.query === "string" &&
      (input.root === undefined || isSupervisedFileRoot(input.root)) &&
      (input.kind === undefined || isFileSearchKind(input.kind));
  }
  if (submission.action === "REVEAL_FOUND_FILE" || submission.action === "OPEN_FOUND_FILE") {
    return keysAre(["ordinal"]) && isFoundOrdinal(input.ordinal);
  }
  if (submission.action === "CREATE_FOLDER") {
    return keysAre(["folderName", "root", "parentOrdinal"]) && typeof input.folderName === "string" &&
      (input.root === undefined || isSupervisedFileRoot(input.root)) &&
      (input.parentOrdinal === undefined || isFoundOrdinal(input.parentOrdinal));
  }
  if (submission.action === "RENAME_FOUND_ITEM") {
    return keysAre(["ordinal", "newName"]) && isFoundOrdinal(input.ordinal) && typeof input.newName === "string";
  }
  if (submission.action === "DELETE_FOUND_ITEM") {
    return keysAre(["ordinal"]) && isFoundOrdinal(input.ordinal);
  }
  if (submission.action === "MOVE_FOUND_ITEMS") {
    return keysAre(["ordinals", "all", "destinationRoot", "destinationOrdinal"]) &&
      parseSelection(input) !== undefined &&
      (input.destinationRoot === undefined || isSupervisedFileRoot(input.destinationRoot)) &&
      (input.destinationOrdinal === undefined || isFoundOrdinal(input.destinationOrdinal)) &&
      (input.destinationRoot !== undefined || input.destinationOrdinal !== undefined);
  }
  if (submission.action === "ORGANIZE_FOUND_ITEMS") {
    return keysAre(["ordinals", "all", "folderName", "root"]) &&
      parseSelection(input) !== undefined &&
      typeof input.folderName === "string" && isSupervisedFileRoot(input.root);
  }
  return false;
};

/** History keeps only the outcome category for FILES actions; names, queries and results never reach it. */
const safeFilesHistorySummary = (outcome: ActionOutcome): string =>
  outcome.status === "SUCCEEDED"
    ? "La acción de archivos se completó."
    : outcome.status === "CANCELLED"
      ? "La acción de archivos fue cancelada."
      : "La acción de archivos no se completó.";

const isOpaqueIdentifier = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

const toAwaitingConfirmation = (pending: PendingProposal): AwaitingActionConfirmation => ({
  lifecycleState: "AWAITING_CONFIRMATION",
  actionId: pending.proposal.actionId,
  action: pending.proposal.action,
  riskLevel: pending.policy.riskLevel,
  confirmationId: pending.confirmationId,
  confirmation: pending.policy.confirmation,
  ...(pending.proposal.action === "ORGANIZE_FILES" && pending.proposal.plan
    ? { preview: pending.proposal.plan }
    : {})
});

const historyFailureOutcome = (outcome: ActionOutcome): ActionOutcome => {
  const userSummary =
    outcome.status === "SUCCEEDED"
      ? "La acción se completó, pero no se pudo registrar en el historial."
      : outcome.status === "CANCELLED"
        ? "La acción fue cancelada, pero no se pudo registrar en el historial."
        : "La acción no se completó y no se pudo registrar en el historial.";

  return {
    ...outcome,
    errorCode: ACTION_ERROR_CODES.historyNotRecorded,
    userSummary
  };
};

const getHistoryMetadata = (outcome: ActionOutcome): SafeHistoryMetadata => {
  const metadata: SafeHistoryMetadata = {
    scopeKind:
      isApplicationAction(outcome.action)
        ? "APPLICATION"
        : isApprovedWebAction(outcome.action)
          ? "WEB"
        : isWeatherAction(outcome.action)
          ? "WEATHER"
          : isHabitAction(outcome.action)
            ? "HABIT"
          : isFileAction(outcome.action) || isSupervisedFilesAction(outcome.action)
          ? "FILES"
          : "PLANNER",
    resultKind: outcome.status
  };
  if (
    isApplicationAction(outcome.action) &&
    outcome.status === "SUCCEEDED" &&
    outcome.data !== undefined &&
    "applicationName" in outcome.data &&
    typeof outcome.data.applicationName === "string"
  ) {
    metadata.applicationDisplayName = outcome.data.applicationName;
  }
  if (isSupervisedFilesAction(outcome.action)) {
    // Counts only: item names, queries and paths never reach history.
    if (outcome.status === "SUCCEEDED" && outcome.data !== undefined && "resultCount" in outcome.data && typeof outcome.data.resultCount === "number") {
      const search = outcome.data as SupervisedFileSearchData;
      metadata.itemCount = search.resultCount;
      metadata.partial = search.partial;
    }
    if (outcome.data !== undefined && "movedCount" in outcome.data && typeof outcome.data.movedCount === "number") {
      const mutation = outcome.data as SupervisedFileMutationData;
      metadata.movedCount = mutation.movedCount;
      metadata.failedCount = mutation.failedCount;
    }
  } else if (isFileAction(outcome.action) && outcome.status === "SUCCEEDED" && outcome.data !== undefined) {
    if ("items" in outcome.data && Array.isArray(outcome.data.items)) {
      metadata.itemCount = outcome.data.items.length;
      const legacySearch = outcome.data as { skippedEntryCount: number; truncated: boolean };
      metadata.skippedCount = legacySearch.skippedEntryCount;
      metadata.partial = legacySearch.truncated;
    } else if ("operation" in outcome.data) {
      metadata.itemCount = 1;
    } else if ("plannedCount" in outcome.data) {
      const organization = outcome.data as Extract<FileActionData, { plannedCount: number }>;
      metadata.plannedCount = organization.plannedCount;
      metadata.movedCount = organization.movedCount;
      metadata.skippedCount = organization.skippedCount;
      metadata.conflictCount = organization.conflictCount;
      metadata.partial = organization.partial;
      metadata.documentsCount = organization.categoryCounts.DOCUMENTS;
      metadata.imagesCount = organization.categoryCounts.IMAGES;
      metadata.audioCount = organization.categoryCounts.AUDIO;
      metadata.videosCount = organization.categoryCounts.VIDEOS;
      metadata.archivesCount = organization.categoryCounts.ARCHIVES;
      metadata.otherCount = organization.categoryCounts.OTHER;
    }
  }
  return metadata;
};

export const createActionOrchestrator = (
  overrides: Partial<ActionOrchestratorDependencies> = {}
): ActionOrchestrator => {
  const dependencies: ActionOrchestratorDependencies = {
    executor: overrides.executor ?? createActionExecutor(),
    historyService: overrides.historyService ?? createActionHistoryService(),
    generateIdentifier: overrides.generateIdentifier ?? randomUUID,
    now: overrides.now ?? (() => new Date()),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  const pendingProposals = new Map<string, PendingProposal>();

  const recordTerminalOutcome = async (outcome: ActionOutcome, startedAt: Date): Promise<ActionOutcome> => {
    try {
      const historyResult = await dependencies.historyService.recordTerminal({
        actionId: outcome.actionId,
        action: outcome.action,
        riskLevel: outcome.riskLevel,
        status: outcome.status,
        userSummary: isSupervisedFilesAction(outcome.action) ? safeFilesHistorySummary(outcome) : outcome.userSummary,
        ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
        metadata: getHistoryMetadata(outcome),
        startedAt: startedAt.toISOString(),
        finishedAt: dependencies.now().toISOString()
      });

      return historyResult.ok ? outcome : historyFailureOutcome(outcome);
    } catch {
      dependencies.logError("Action history recording threw unexpectedly.");
      return historyFailureOutcome(outcome);
    }
  };

  const execute = async (
    proposal: ExecutableActionProposal,
    policy: ActionPolicy,
    startedAt: Date,
    approvedByConfirmation = false
  ): Promise<ActionOutcome> => {
    if (policy.approval !== "DIRECT" && !approvedByConfirmation) {
      return recordTerminalOutcome({
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: policy.riskLevel,
        status: "VALIDATION_FAILED",
        errorCode: ACTION_ERROR_CODES.confirmationUnavailable,
        userSummary: messages[ACTION_ERROR_CODES.confirmationUnavailable]
      }, startedAt);
    }

    let outcome: ActionOutcome;
    try {
      const executed = await dependencies.executor.execute(proposal, policy);
      outcome = { ...executed, actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel };
    } catch {
      dependencies.logError("Action executor threw unexpectedly.");
      outcome = {
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: policy.riskLevel,
        status: "EXECUTION_FAILED",
        errorCode: ACTION_ERROR_CODES.executionUnavailable,
        userSummary: messages[ACTION_ERROR_CODES.executionUnavailable]
      };
    }

    return recordTerminalOutcome(outcome, startedAt);
  };

  const recordExpiredProposal = async (pending: PendingProposal): Promise<void> => {
    await recordTerminalOutcome(
      {
        actionId: pending.proposal.actionId,
        action: pending.proposal.action,
        riskLevel: pending.policy.riskLevel,
        status: "CANCELLED",
        userSummary: "La confirmación de la acción expiró."
      },
      pending.startedAt
    );
  };

  const orchestrator: ActionOrchestrator = {
    propose: async (submission) => {
      const policyResult = evaluateActionProposal(submission);
      if (!policyResult.ok) return policyResult;
      if (!isRecord(submission) || !hasOnlySubmissionKeys(submission) || !isActionName(submission.action)) {
        return createFailure(ACTION_ERROR_CODES.proposalInvalid);
      }

      let policy = getActionPolicy(submission.action);
      if ((submission.action === "DELETE_EVENT" || submission.action === "DELETE_TASK") && policy.approval !== "REINFORCED_CONFIRMATION_REQUIRED") {
        return createFailure(ACTION_ERROR_CODES.proposalInvalid);
      }
      if (
        !isPlannerAction(submission.action) &&
        !isHabitActionSubmission(submission) &&
        !isOpenApplicationSubmission(submission) &&
        !isRegisterCatalogApplicationSubmission(submission) &&
        !isRequestCustomApplicationRegistrationSubmission(submission) &&
        !isSupervisedFilesSubmission(submission) &&
        !isApprovedWebActionSubmission(submission) &&
        !isOpenWebPageSubmission(submission) &&
        !isWeatherActionSubmission(submission) &&
        !isWeeklyScheduleSubmission(submission) &&
        !isWeeklyMutationSubmission(submission) &&
        !isFileActionSubmission(submission)
      ) {
        return createFailure(ACTION_ERROR_CODES.proposalInvalid);
      }

      const actionId = dependencies.generateIdentifier();
      if (!isOpaqueIdentifier(actionId)) {
        dependencies.logError("Main action identifier generation failed.");
        return createFailure(ACTION_ERROR_CODES.executionUnavailable);
      }

      let proposal: ExecutableActionProposal = isOpenApplicationSubmission(submission)
        ? { actionId, action: "OPEN_APPLICATION", input: { alias: submission.input.alias } }
        : isRegisterCatalogApplicationSubmission(submission)
          ? {
              actionId,
              action: "REGISTER_CATALOG_APPLICATION",
              input: {
                catalogKey: submission.input.catalogKey,
                ...(submission.input.alias === undefined ? {} : { alias: submission.input.alias })
              }
            } as RegisterCatalogApplicationActionProposal
        : isRequestCustomApplicationRegistrationSubmission(submission)
          ? {
              actionId,
              action: "REQUEST_CUSTOM_APPLICATION_REGISTRATION",
              input: submission.input.displayName === undefined ? {} : { displayName: submission.input.displayName }
            } as RequestCustomApplicationRegistrationActionProposal
        : isSupervisedFilesSubmission(submission)
          ? ({ actionId, action: submission.action, input: submission.input } as SupervisedFilesActionProposal)
        : isApprovedWebActionSubmission(submission)
          ? submission.action === "OPEN_APPROVED_PAGE"
            ? { actionId, action: "OPEN_APPROVED_PAGE", input: { site: submission.input.site } } as ApprovedWebActionProposal
            : { actionId, action: "SEARCH_APPROVED_SITE", input: { site: submission.input.site, query: submission.input.query } } as ApprovedWebActionProposal
        : isOpenWebPageSubmission(submission)
          ? {
              actionId,
              action: "OPEN_WEB_PAGE",
              input: { destination: "YOUTUBE", browser: "CHROME" }
            } as OpenWebPageActionProposal
        : isFileActionSubmission(submission)
          ? {
              actionId,
              action: submission.action,
              input: submission.input as FileActionProposal["input"]
            } as LegacyFileActionProposal
          : isWeatherActionSubmission(submission)
            ? {
                actionId,
                action: "GET_WEATHER",
                input: {}
              } as WeatherActionProposal
          : isHabitAction(submission.action)
            ? {
                actionId,
                action: submission.action,
                input: submission.input as HabitActionProposal["input"]
              } as HabitActionProposal
          : {
              actionId,
              action: submission.action as PlannerActionProposal["action"],
              input: submission.input as never
            };
      const startedAt = dependencies.now();

      if (proposal.action === "REGISTER_CATALOG_APPLICATION") {
        let prepared;
        try {
          prepared = dependencies.executor.prepareCatalogRegistration
            ? await dependencies.executor.prepareCatalogRegistration(proposal)
            : catalogRegistrationFailure("PREPARATION_FAILED");
        } catch {
          dependencies.logError("Catalog application proposal preparation failed.");
          prepared = catalogRegistrationFailure("PREPARATION_FAILED");
        }
        if (!prepared.ok) {
          return {
            ok: true,
            data: await recordTerminalOutcome({
              actionId: proposal.actionId,
              action: proposal.action,
              riskLevel: policy.riskLevel,
              status: "VALIDATION_FAILED",
              errorCode: prepared.error.code,
              userSummary: prepared.error.userMessage
            }, startedAt)
          };
        }
        proposal = { ...proposal, input: { catalogKey: prepared.data.catalogKey, alias: prepared.data.alias } };
        policy = {
          ...policy,
          confirmation: {
            ...policy.confirmation,
            summary: `Se registrará ${prepared.data.applicationName} como “${prepared.data.alias}”.`,
            scopeSummary: "Aplicación aprobada"
          }
        };
      }

      if (proposal.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION") {
        // The native picker runs in Main; the validated selection never leaves Main and no path is returned.
        let prepared;
        try {
          prepared = dependencies.executor.prepareCustomRegistration
            ? await dependencies.executor.prepareCustomRegistration(proposal)
            : { ok: false as const, error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo realizar esa acción." } };
        } catch {
          dependencies.logError("Custom application selection preparation failed.");
          prepared = {
            ok: false as const,
            error: { code: "APPLICATION_CUSTOM_PICKER_UNAVAILABLE", userMessage: "No se pudo abrir el selector de aplicaciones." }
          };
        }
        if (!prepared.ok) {
          return {
            ok: true,
            data: await recordTerminalOutcome({
              actionId: proposal.actionId,
              action: proposal.action,
              riskLevel: policy.riskLevel,
              status: prepared.error.code === "APPLICATION_CUSTOM_REGISTRATION_CANCELLED" ? "CANCELLED" : "VALIDATION_FAILED",
              ...(prepared.error.code === "APPLICATION_CUSTOM_REGISTRATION_CANCELLED" ? {} : { errorCode: prepared.error.code }),
              userSummary: prepared.error.userMessage
            }, startedAt)
          };
        }
        proposal = { ...proposal, input: { displayName: prepared.data.displayName, selectionId: prepared.data.selectionId } };
        policy = {
          ...policy,
          confirmation: {
            ...policy.confirmation,
            summary: `Se registrará «${prepared.data.displayName}» como una aplicación elegida por ti.`,
            scopeSummary: "Aplicación elegida"
          }
        };
      }

      if (
        proposal.action === "OPEN_FOUND_FILE" ||
        proposal.action === "CREATE_FOLDER" ||
        proposal.action === "RENAME_FOUND_ITEM" ||
        proposal.action === "MOVE_FOUND_ITEMS" ||
        proposal.action === "ORGANIZE_FOUND_ITEMS" ||
        proposal.action === "DELETE_FOUND_ITEM"
      ) {
        // Selection and containment are checked now and again at confirm; the held reference stays in Main.
        let preparedFiles;
        try {
          preparedFiles = dependencies.executor.prepareFilesAction
            ? await dependencies.executor.prepareFilesAction(proposal)
            : { ok: false as const, error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo realizar esa acción." } };
        } catch {
          dependencies.logError("Supervised file proposal preparation failed.");
          preparedFiles = {
            ok: false as const,
            error: { code: "FILES_OPERATION_FAILED", userMessage: "No se pudo completar la operación con archivos." }
          };
        }
        if (!preparedFiles.ok) {
          return {
            ok: true,
            data: await recordTerminalOutcome({
              actionId: proposal.actionId,
              action: proposal.action,
              riskLevel: policy.riskLevel,
              status: preparedFiles.error.code === "FILES_OPERATION_FAILED" ? "EXECUTION_FAILED" : "VALIDATION_FAILED",
              errorCode: preparedFiles.error.code,
              userSummary: preparedFiles.error.userMessage
            }, startedAt)
          };
        }
        proposal = { ...proposal, input: preparedFiles.data.input } as SupervisedFilesActionProposal;
        policy = {
          ...policy,
          confirmation: {
            ...policy.confirmation,
            summary: preparedFiles.data.confirmationSummary,
            scopeSummary: preparedFiles.data.scopeSummary
          }
        };
      }

      if (proposal.action === "ORGANIZE_FILES") {
        let planResult;
        try {
          planResult = dependencies.executor.prepareOrganization
            ? await dependencies.executor.prepareOrganization(proposal)
            : {
                ok: false as const,
                error: {
                  code: "FILE_ORGANIZATION_UNAVAILABLE",
                  userMessage: "No se pudo analizar la carpeta autorizada."
                }
              };
        } catch {
          dependencies.logError("File organization proposal preparation failed.");
          planResult = {
            ok: false as const,
            error: {
              code: "FILE_ORGANIZATION_UNAVAILABLE",
              userMessage: "No se pudo analizar la carpeta autorizada."
            }
          };
        }
        if (!planResult.ok) {
          return {
            ok: true,
            data: await recordTerminalOutcome(
              {
                actionId: proposal.actionId,
                action: proposal.action,
                riskLevel: policy.riskLevel,
                status: "VALIDATION_FAILED",
                errorCode: planResult.error.code,
                userSummary: planResult.error.userMessage
              },
              startedAt
            )
          };
        }
        proposal = { ...proposal, plan: planResult.data };
      }

      if (!policy.confirmation.required) {
        return { ok: true, data: await execute(proposal, policy, startedAt) };
      }

      const confirmationId = dependencies.generateIdentifier();
      if (!isOpaqueIdentifier(confirmationId)) {
        dependencies.logError("Main confirmation identifier generation failed.");
        return createFailure(ACTION_ERROR_CODES.executionUnavailable);
      }

      const pending: PendingProposal = {
        proposal,
        policy,
        confirmationId,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + PENDING_PROPOSAL_LIFETIME_MS),
        state: "AWAITING_CONFIRMATION"
      };
      pendingProposals.set(confirmationId, pending);
      return { ok: true, data: toAwaitingConfirmation(pending) };
    },
    confirm: async (confirmationId) => {
      if (!isOpaqueIdentifier(confirmationId)) {
        return createFailure(ACTION_ERROR_CODES.confirmationInvalid);
      }

      const pending = pendingProposals.get(confirmationId);
      if (!pending || pending.state !== "AWAITING_CONFIRMATION" || pending.expiresAt <= dependencies.now()) {
        pendingProposals.delete(confirmationId);
        if (pending && pending.state === "AWAITING_CONFIRMATION") {
          await recordExpiredProposal(pending);
        }
        return createFailure(ACTION_ERROR_CODES.confirmationUnavailable);
      }

      pending.state = "RUNNING";
      pendingProposals.delete(confirmationId);
      return { ok: true, data: await execute(pending.proposal, pending.policy, pending.startedAt, true) };
    },
    cancel: async (confirmationId) => {
      if (!isOpaqueIdentifier(confirmationId)) {
        return createFailure(ACTION_ERROR_CODES.confirmationInvalid);
      }

      const pending = pendingProposals.get(confirmationId);
      if (!pending || pending.state !== "AWAITING_CONFIRMATION" || pending.expiresAt <= dependencies.now()) {
        pendingProposals.delete(confirmationId);
        if (pending && pending.state === "AWAITING_CONFIRMATION") {
          await recordExpiredProposal(pending);
        }
        return createFailure(ACTION_ERROR_CODES.confirmationUnavailable);
      }

      pendingProposals.delete(confirmationId);
      const outcome: ActionOutcome = {
        actionId: pending.proposal.actionId,
        action: pending.proposal.action,
        riskLevel: pending.policy.riskLevel,
        status: "CANCELLED",
        userSummary: "Se canceló la acción solicitada."
      };
      return { ok: true, data: await recordTerminalOutcome(outcome, pending.startedAt) };
    },
    confirmEventDeletion: async (eventId, confirmationId) => {
      if (!isOpaqueIdentifier(confirmationId)) return createFailure(ACTION_ERROR_CODES.confirmationInvalid);
      const pending = pendingProposals.get(confirmationId);
      if (
        !pending || pending.proposal.action !== "DELETE_EVENT" ||
        pending.proposal.input.eventId !== eventId ||
        pending.policy.approval !== "REINFORCED_CONFIRMATION_REQUIRED"
      ) return createFailure(ACTION_ERROR_CODES.confirmationUnavailable);
      return orchestrator.confirm(confirmationId);
    },
    confirmTaskDeletion: async (taskId, confirmationId) => {
      if (!isOpaqueIdentifier(confirmationId)) return createFailure(ACTION_ERROR_CODES.confirmationInvalid);
      const pending = pendingProposals.get(confirmationId);
      if (!pending || pending.proposal.action !== "DELETE_TASK" || pending.proposal.input.taskId !== taskId || pending.policy.approval !== "REINFORCED_CONFIRMATION_REQUIRED") return createFailure(ACTION_ERROR_CODES.confirmationUnavailable);
      return orchestrator.confirm(confirmationId);
    },
    cancelTaskDeletion: async (taskId, confirmationId) => {
      if (!isOpaqueIdentifier(confirmationId)) return createFailure(ACTION_ERROR_CODES.confirmationInvalid);
      const pending = pendingProposals.get(confirmationId);
      if (!pending || pending.proposal.action !== "DELETE_TASK" || pending.proposal.input.taskId !== taskId) return createFailure(ACTION_ERROR_CODES.confirmationUnavailable);
      return orchestrator.cancel(confirmationId);
    },
    cancelEventDeletion: async (eventId, confirmationId) => {
      if (!isOpaqueIdentifier(confirmationId)) return createFailure(ACTION_ERROR_CODES.confirmationInvalid);
      const pending = pendingProposals.get(confirmationId);
      if (!pending || pending.proposal.action !== "DELETE_EVENT" || pending.proposal.input.eventId !== eventId) {
        return createFailure(ACTION_ERROR_CODES.confirmationUnavailable);
      }
      return orchestrator.cancel(confirmationId);
    }
  };
  return orchestrator;
};
