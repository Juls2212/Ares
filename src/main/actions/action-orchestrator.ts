import { cancelledOutcome, failedOutcome, historySentences, outcomeIdentity } from "../../shared/outcome-kit";
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
  type MessagingActionProposal,
  type PlannerActionProposal,
  type RegisterCatalogApplicationActionProposal,
  type RequestCustomApplicationRegistrationActionProposal,
  type SafeHistoryMetadata,
  type SearchSpotifyAppActionProposal,
  type SearchSpotifyAppInput,
  type SpotifyMusicActionProposal,
  type SupervisedFilesActionProposal,
  type SupervisedFilesActionSubmission,
  type WeatherActionProposal
} from "../../shared/action-contracts";
import { createActionHistoryService, type ActionHistoryService } from "./action-history-service";
import { evaluateActionProposal, getActionPolicy } from "./action-policy";
import { createActionExecutor, type ActionExecutor } from "./action-executor";
import { isFoundOrdinal, isFileSearchKind, isSupervisedFileRoot, parseSelection } from "../files/supervised-file-validation";
import type { SupervisedFileMutationData, SupervisedFileSearchData } from "../../shared/supervised-file-contracts";
import { validateSpotifySearchQuery } from "../applications/spotify-search";
import { isKnownApplicationCatalogKey } from "../applications/known-application-catalog";
import { validateWeatherInput } from "../weather/weather-validation";
import { catalogRegistrationFailure } from "../applications/catalog-registration-failures";

import { MESSAGING_EXECUTION_FAILURE_CODES } from "../messaging/messaging-failures";
import { MAX_CONTACT_ALIASES, MAX_CONTACT_NAME_LENGTH, MAX_MESSAGE_BODY_LENGTH } from "../../shared/messaging-contracts";

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
  [ACTION_ERROR_CODES.proposalInvalid]: "No pude entender esa petición. Inténtalo de nuevo.",
  [ACTION_ERROR_CODES.confirmationInvalid]: "No pude confirmar eso. Vuelve a pedírmelo.",
  [ACTION_ERROR_CODES.confirmationUnavailable]: "La confirmación ya no está disponible.",
  [ACTION_ERROR_CODES.executionUnavailable]: "No pude hacer eso. Inténtalo de nuevo."
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
    "GET_CURRENT_DATE_TIME",
    "DELETE_EVENT",
    "DELETE_TASK"
  ].includes(action as PlannerActionProposal["action"]);

const isOpenApplicationSubmission = (
  submission: Record<string, unknown>
): submission is { action: "OPEN_APPLICATION"; input: { alias: string } } =>
  submission.action === "OPEN_APPLICATION" &&
  typeof submission.input === "object" &&
  submission.input !== null &&
  !Array.isArray(submission.input) &&
  Object.keys(submission.input).length === 1 &&
    typeof (submission.input as { alias?: unknown }).alias === "string";

const SPOTIFY_SEARCH_KIND_VALUES = ["TRACK", "ARTIST", "ALBUM", "PLAYLIST", "ANY"];

/** Strict closed shape: a plain query, a closed kind and a boolean; never a URI, a path or a Main reference. */
const isSearchSpotifyAppSubmission = (
  submission: Record<string, unknown>
): submission is { action: "SEARCH_SPOTIFY_APP"; input: SearchSpotifyAppInput } =>
  submission.action === "SEARCH_SPOTIFY_APP" &&
  isRecord(submission.input) &&
  Object.keys(submission.input).every((key) => key === "query" || key === "kind" || key === "playRequested") &&
  validateSpotifySearchQuery(submission.input.query) !== undefined &&
  (submission.input.kind === undefined || SPOTIFY_SEARCH_KIND_VALUES.includes(submission.input.kind as string)) &&
  (submission.input.playRequested === undefined || typeof submission.input.playRequested === "boolean");

/** History keeps only the outcome category for the Spotify app search; the query never reaches it. */
const spotifySearchHistorySentence = historySentences({
  succeeded: "La búsqueda en Spotify se completó.",
  failed: "La búsqueda en Spotify no se completó."
});

const SPOTIFY_MUSIC_ACTIONS = [
  "CONNECT_SPOTIFY",
  "DISCONNECT_SPOTIFY",
  "GET_SPOTIFY_STATUS",
  "PLAY_SPOTIFY_MUSIC",
  "PAUSE_SPOTIFY",
  "RESUME_SPOTIFY",
  "NEXT_SPOTIFY_TRACK",
  "PREVIOUS_SPOTIFY_TRACK",
  "SET_SPOTIFY_VOLUME",
  "WHAT_IS_PLAYING"
] as const;

const isSpotifyMusicAction = (action: ActionSubmission["action"]): boolean =>
  (SPOTIFY_MUSIC_ACTIONS as readonly string[]).includes(action);

/**
 * Strict closed shapes: most actions take no input, playing takes a plain query and a closed kind, and the
 * volume takes exactly one of an integer level or a direction. No identifier, URI or URL is a valid field.
 */
const isSpotifyMusicSubmission = (submission: Record<string, unknown>): boolean => {
  if (!isSpotifyMusicAction(submission.action as ActionSubmission["action"]) || !isRecord(submission.input)) return false;
  const input = submission.input;
  if (submission.action === "PLAY_SPOTIFY_MUSIC") {
    return Object.keys(input).every((key) => key === "query" || key === "kind") &&
      validateSpotifySearchQuery(input.query) !== undefined &&
      (input.kind === undefined || SPOTIFY_SEARCH_KIND_VALUES.includes(input.kind as string));
  }
  if (submission.action === "SET_SPOTIFY_VOLUME") {
    const keys = Object.keys(input);
    if (keys.length !== 1) return false;
    return keys[0] === "level"
      ? typeof input.level === "number" && Number.isInteger(input.level) && input.level >= 0 && input.level <= 100
      : keys[0] === "change" && (input.change === "UP" || input.change === "DOWN");
  }
  return Object.keys(input).length === 0;
};

/** History keeps only the outcome category for the Spotify actions; titles, artists and queries never reach it. */
const spotifyMusicHistorySentence = historySentences({
  succeeded: "La acción de música se completó.",
  cancelled: "La acción de música fue cancelada.",
  failed: "La acción de música no se completó."
});

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
  action === "OPEN_APPLICATION" || action === "SEARCH_SPOTIFY_APP" || action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION";

const isApprovedWebAction = (action: ActionSubmission["action"]): boolean =>
  action === "OPEN_APPROVED_PAGE" || action === "SEARCH_APPROVED_SITE";

/** The validated, normalized weather fields; a failed validation cannot reach this point. */
const weatherProposalInput = (value: unknown): WeatherActionProposal["input"] => {
  const result = validateWeatherInput(value);
  return result.ok ? result.data : {};
};

const isWeatherAction = (action: ActionSubmission["action"]): action is WeatherActionProposal["action"] =>
  action === "GET_WEATHER";

const isWeatherActionSubmission = (
  submission: Record<string, unknown>
): submission is { action: "GET_WEATHER"; input: WeatherActionProposal["input"] } =>
  submission.action === "GET_WEATHER" && validateWeatherInput(submission.input).ok;

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

const MESSAGING_ACTIONS = [
  "SAVE_CONTACT",
  "LIST_CONTACTS",
  "DELETE_CONTACT",
  "PREPARE_MESSAGE_DRAFT",
  "EDIT_MESSAGE_DRAFT",
  "DISCARD_MESSAGE_DRAFT",
  "OPEN_WHATSAPP_CHAT_WITH_DRAFT"
] as const;

const isMessagingAction = (action: ActionSubmission["action"]): action is MessagingActionProposal["action"] =>
  (MESSAGING_ACTIONS as readonly string[]).includes(action);

const isBoundedText = (value: unknown, maximumLength: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximumLength;

/**
 * Strict, closed shapes. A phone number, a contact identifier or a Main-issued reference is never a
 * valid field here: the only way a number reaches Main is the dedicated contact form channel.
 */
const isMessagingSubmission = (submission: Record<string, unknown>): boolean => {
  if (!isRecord(submission.input) || !isMessagingAction(submission.action as ActionSubmission["action"])) return false;
  const input = submission.input;
  const keysAre = (allowed: readonly string[]): boolean => Object.keys(input).every((key) => allowed.includes(key));
  switch (submission.action) {
    case "SAVE_CONTACT":
      return keysAre(["contactName", "aliases"]) && isBoundedText(input.contactName, MAX_CONTACT_NAME_LENGTH * 2) &&
        (input.aliases === undefined || (Array.isArray(input.aliases) && input.aliases.length <= MAX_CONTACT_ALIASES &&
          input.aliases.every((alias) => isBoundedText(alias, MAX_CONTACT_NAME_LENGTH * 2))));
    case "DELETE_CONTACT":
      return keysAre(["contactName"]) && isBoundedText(input.contactName, MAX_CONTACT_NAME_LENGTH * 2);
    case "LIST_CONTACTS":
    case "DISCARD_MESSAGE_DRAFT":
    case "OPEN_WHATSAPP_CHAT_WITH_DRAFT":
      return Object.keys(input).length === 0;
    case "PREPARE_MESSAGE_DRAFT":
      return Object.keys(input).length === 3 && keysAre(["recipient", "body", "channel"]) &&
        isBoundedText(input.recipient, MAX_CONTACT_NAME_LENGTH * 2) &&
        isBoundedText(input.body, MAX_MESSAGE_BODY_LENGTH * 2) && input.channel === "WHATSAPP";
    case "EDIT_MESSAGE_DRAFT":
      return Object.keys(input).length === 1 && keysAre(["body"]) && isBoundedText(input.body, MAX_MESSAGE_BODY_LENGTH * 2);
    default:
      return false;
  }
};

/** History keeps only the outcome category for MESSAGING actions; names, numbers and texts never reach it. */
const messagingHistorySentence = historySentences({
  succeeded: "La acción de mensajería se completó.",
  cancelled: "La acción de mensajería fue cancelada.",
  failed: "La acción de mensajería no se completó."
});

/** History keeps only the outcome category for FILES actions; names, queries and results never reach it. */
const filesHistorySentence = historySentences({
  succeeded: "La acción de archivos se completó.",
  cancelled: "La acción de archivos fue cancelada.",
  failed: "La acción de archivos no se completó."
});

/**
 * History keeps only a generic, fixed sentence per planner action: no titles, names, times, counts or free text.
 * The spoken and on-screen answer is not affected; only what is persisted.
 */
const PLANNER_HISTORY_SUMMARIES: Record<PlannerActionProposal["action"], string> = {
  CREATE_TASK: "Se creó una tarea.",
  UPDATE_TASK: "Se actualizó una tarea.",
  COMPLETE_TASK: "Se completó una tarea.",
  DELETE_TASK: "Se eliminó una tarea.",
  CREATE_EVENT: "Se creó un evento.",
  UPDATE_EVENT: "Se actualizó un evento.",
  DELETE_EVENT: "Se eliminó un evento.",
  CREATE_REMINDER: "Se creó un recordatorio.",
  GET_TODAY_SCHEDULE: "Se consultó la agenda de hoy.",
  GET_WEEK_SCHEDULE: "Se consultó la agenda de la semana.",
  GET_CURRENT_DATE_TIME: "Se consultó la fecha y la hora."
};

const plannerUnsuccessfulSentence = historySentences({
  succeeded: "",
  cancelled: "La acción del planificador fue cancelada.",
  failed: "La acción del planificador no se completó."
});

const safePlannerHistorySummary = (outcome: ActionOutcome): string =>
  outcome.status === "SUCCEEDED"
    ? PLANNER_HISTORY_SUMMARIES[outcome.action as PlannerActionProposal["action"]]
    : plannerUnsuccessfulSentence(outcome.status);

/** History keeps only the outcome category for the weather query; the place, coordinates and numbers never reach it. */
const weatherHistorySentence = historySentences({
  succeeded: "Se respondió una consulta del clima.",
  failed: "La consulta del clima no se completó."
});

const isOpaqueIdentifier = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

const toAwaitingConfirmation = (pending: PendingProposal): AwaitingActionConfirmation => ({
  lifecycleState: "AWAITING_CONFIRMATION",
  actionId: pending.proposal.actionId,
  action: pending.proposal.action,
  riskLevel: pending.policy.riskLevel,
  confirmationId: pending.confirmationId,
  confirmation: pending.policy.confirmation
});

const historyFailureOutcome = (outcome: ActionOutcome): ActionOutcome => {
  const userSummary =
    outcome.status === "SUCCEEDED"
      ? "Listo, pero no pude guardarlo en el historial."
      : outcome.status === "CANCELLED"
        ? "Lo cancelé, pero no pude guardarlo en el historial."
        : "No pude hacerlo y tampoco guardarlo en el historial.";

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
        : isSpotifyMusicAction(outcome.action)
          ? "MUSIC"
        : isApprovedWebAction(outcome.action)
          ? "WEB"
        : isWeatherAction(outcome.action)
          ? "WEATHER"
          : isMessagingAction(outcome.action)
          ? "MESSAGING"
          : isSupervisedFilesAction(outcome.action)
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
  if (isMessagingAction(outcome.action)) {
    // A count only: no contact name, number, alias or message text is ever written to history.
    if (outcome.status === "SUCCEEDED" && outcome.data !== undefined && "contactCount" in outcome.data && typeof outcome.data.contactCount === "number") {
      metadata.itemCount = outcome.data.contactCount;
    }
  } else if (isSupervisedFilesAction(outcome.action)) {
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
        userSummary: isSupervisedFilesAction(outcome.action)
          ? filesHistorySentence(outcome.status)
          : isMessagingAction(outcome.action)
            ? messagingHistorySentence(outcome.status)
            : outcome.action === "SEARCH_SPOTIFY_APP"
              ? spotifySearchHistorySentence(outcome.status)
              : isSpotifyMusicAction(outcome.action)
                ? spotifyMusicHistorySentence(outcome.status)
                : isWeatherAction(outcome.action)
                  ? weatherHistorySentence(outcome.status)
                  : isPlannerAction(outcome.action)
                    ? safePlannerHistorySummary(outcome)
                    : outcome.userSummary,
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
      return recordTerminalOutcome(
        failedOutcome(
          outcomeIdentity(proposal, policy),
          "VALIDATION_FAILED",
          ACTION_ERROR_CODES.confirmationUnavailable,
          messages[ACTION_ERROR_CODES.confirmationUnavailable]
        ),
        startedAt
      );
    }

    let outcome: ActionOutcome;
    try {
      const executed = await dependencies.executor.execute(proposal, policy);
      outcome = { ...executed, actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel };
    } catch {
      dependencies.logError("Action executor threw unexpectedly.");
      outcome = failedOutcome(
        outcomeIdentity(proposal, policy),
        "EXECUTION_FAILED",
        ACTION_ERROR_CODES.executionUnavailable,
        messages[ACTION_ERROR_CODES.executionUnavailable]
      );
    }

    return recordTerminalOutcome(outcome, startedAt);
  };

  const recordExpiredProposal = async (pending: PendingProposal): Promise<void> => {
    dependencies.executor.releasePrepared?.(pending.proposal);
    await recordTerminalOutcome(
      cancelledOutcome(outcomeIdentity(pending.proposal, pending.policy), "La confirmación de la acción expiró."),
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
        !isOpenApplicationSubmission(submission) &&
        !isSearchSpotifyAppSubmission(submission) &&
        !isSpotifyMusicSubmission(submission) &&
        !isRegisterCatalogApplicationSubmission(submission) &&
        !isRequestCustomApplicationRegistrationSubmission(submission) &&
        !isSupervisedFilesSubmission(submission) &&
        !isMessagingSubmission(submission) &&
        !isApprovedWebActionSubmission(submission) &&
        !isWeatherActionSubmission(submission)
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
        : isSpotifyMusicSubmission(submission)
          ? ({ actionId, action: submission.action, input: submission.input } as SpotifyMusicActionProposal)
        : isSearchSpotifyAppSubmission(submission)
          ? ({ actionId, action: "SEARCH_SPOTIFY_APP", input: submission.input } as SearchSpotifyAppActionProposal)
        : isMessagingSubmission(submission)
          ? ({ actionId, action: submission.action, input: submission.input } as MessagingActionProposal)
        : isSupervisedFilesSubmission(submission)
          ? ({ actionId, action: submission.action, input: submission.input } as SupervisedFilesActionProposal)
        : isApprovedWebActionSubmission(submission)
          ? submission.action === "OPEN_APPROVED_PAGE"
            ? { actionId, action: "OPEN_APPROVED_PAGE", input: { site: submission.input.site } } as ApprovedWebActionProposal
            : { actionId, action: "SEARCH_APPROVED_SITE", input: { site: submission.input.site, query: submission.input.query } } as ApprovedWebActionProposal
        : isWeatherActionSubmission(submission)
          ? {
              actionId,
              action: "GET_WEATHER",
              // Only the validated, normalized fields travel on; nothing else the caller sent.
              input: weatherProposalInput(submission.input)
            } as WeatherActionProposal
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
            data: await recordTerminalOutcome(
              failedOutcome(outcomeIdentity(proposal, policy), "VALIDATION_FAILED", prepared.error.code, prepared.error.userMessage),
              startedAt
            )
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
            : { ok: false as const, error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo hacer eso." } };
        } catch {
          dependencies.logError("Custom application selection preparation failed.");
          prepared = {
            ok: false as const,
            error: { code: "APPLICATION_CUSTOM_PICKER_UNAVAILABLE", userMessage: "No pude abrir el selector de aplicaciones." }
          };
        }
        if (!prepared.ok) {
          return {
            ok: true,
            data: await recordTerminalOutcome(
              prepared.error.code === "APPLICATION_CUSTOM_REGISTRATION_CANCELLED"
                ? cancelledOutcome(outcomeIdentity(proposal, policy), prepared.error.userMessage)
                : failedOutcome(outcomeIdentity(proposal, policy), "VALIDATION_FAILED", prepared.error.code, prepared.error.userMessage),
              startedAt
            )
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
            : { ok: false as const, error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo hacer eso." } };
        } catch {
          dependencies.logError("Supervised file proposal preparation failed.");
          preparedFiles = {
            ok: false as const,
            error: { code: "FILES_OPERATION_FAILED", userMessage: "No pude completar eso con tus archivos." }
          };
        }
        if (!preparedFiles.ok) {
          return {
            ok: true,
            data: await recordTerminalOutcome(
              failedOutcome(
                outcomeIdentity(proposal, policy),
                preparedFiles.error.code === "FILES_OPERATION_FAILED" ? "EXECUTION_FAILED" : "VALIDATION_FAILED",
                preparedFiles.error.code,
                preparedFiles.error.userMessage
              ),
              startedAt
            )
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

      if (proposal.action === "SAVE_CONTACT" || proposal.action === "DELETE_CONTACT" || proposal.action === "OPEN_WHATSAPP_CHAT_WITH_DRAFT") {
        // The contact form (for a new contact) or the contact lookup (for a deletion) runs in Main now; the
        // number stays in Main and only a masked label reaches the review text.
        let preparedMessaging;
        try {
          preparedMessaging = dependencies.executor.prepareMessagingAction
            ? await dependencies.executor.prepareMessagingAction(proposal)
            : { ok: false as const, error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo hacer eso." } };
        } catch {
          dependencies.logError("Messaging proposal preparation failed.");
          preparedMessaging = {
            ok: false as const,
            error: { code: "MESSAGING_OPERATION_FAILED", userMessage: "No pude completar eso con tus contactos." }
          };
        }
        if (!preparedMessaging.ok) {
          return {
            ok: true,
            data: await recordTerminalOutcome(
              preparedMessaging.error.code === "MESSAGING_FORM_CANCELLED"
                ? cancelledOutcome(outcomeIdentity(proposal, policy), preparedMessaging.error.userMessage, preparedMessaging.error.code)
                : failedOutcome(
                    outcomeIdentity(proposal, policy),
                    MESSAGING_EXECUTION_FAILURE_CODES.includes(preparedMessaging.error.code) ? "EXECUTION_FAILED" : "VALIDATION_FAILED",
                    preparedMessaging.error.code,
                    preparedMessaging.error.userMessage
                  ),
              startedAt
            )
          };
        }
        proposal = { ...proposal, input: preparedMessaging.data.input } as MessagingActionProposal;
        policy = {
          ...policy,
          confirmation: {
            ...policy.confirmation,
            summary: preparedMessaging.data.confirmationSummary,
            scopeSummary: preparedMessaging.data.scopeSummary
          }
        };
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
      dependencies.executor.releasePrepared?.(pending.proposal);
      const outcome: ActionOutcome = cancelledOutcome(
        outcomeIdentity(pending.proposal, pending.policy),
        "Se canceló la acción solicitada."
      );
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
