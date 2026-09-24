import { randomUUID } from "node:crypto";
import {
  ACTION_ERROR_CODES,
  ACTION_NAMES,
  type ActionLifecycleResult,
  type ActionOperationResult,
  type ActionOutcome,
  type ActionPolicy,
  type ActionSubmission,
  type AwaitingActionConfirmation,
  type ExecutableActionProposal,
  type FileActionProposal,
  type FileActionData,
  type OpenWebPageActionProposal,
  type PlannerActionProposal,
  type SafeHistoryMetadata
} from "../../shared/action-contracts";
import { createActionHistoryService, type ActionHistoryService } from "./action-history-service";
import { evaluateActionProposal, getActionPolicy } from "./action-policy";
import { createActionExecutor, type ActionExecutor } from "./action-executor";

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
    "GET_WEEK_SCHEDULE"
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

const isOpenWebPageSubmission = (
  submission: Record<string, unknown>
): submission is { action: "OPEN_WEB_PAGE"; input: { destination: "YOUTUBE"; browser: "CHROME" } } =>
  submission.action === "OPEN_WEB_PAGE" &&
  isRecord(submission.input) &&
  Object.keys(submission.input).length === 2 &&
  submission.input.destination === "YOUTUBE" &&
  submission.input.browser === "CHROME";

const isApplicationAction = (action: ActionSubmission["action"]): boolean =>
  action === "OPEN_APPLICATION" || action === "OPEN_WEB_PAGE";

const isFileAction = (action: ActionSubmission["action"]): action is FileActionProposal["action"] =>
  ["SEARCH_FILES", "CREATE_FOLDER", "RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "ORGANIZE_FILES"].includes(
    action as FileActionProposal["action"]
  );

const isFileActionSubmission = (
  submission: Record<string, unknown>
): submission is { action: FileActionProposal["action"]; input: Record<string, unknown> } =>
  isFileAction(submission.action as ActionSubmission["action"]) &&
  isRecord(submission.input);

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
        : isFileAction(outcome.action)
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
  if (isFileAction(outcome.action) && outcome.status === "SUCCEEDED" && outcome.data !== undefined) {
    if ("items" in outcome.data && Array.isArray(outcome.data.items)) {
      metadata.itemCount = outcome.data.items.length;
      metadata.skippedCount = outcome.data.skippedEntryCount;
      metadata.partial = outcome.data.truncated;
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
        userSummary: outcome.userSummary,
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
    startedAt: Date
  ): Promise<ActionOutcome> => {
    let outcome: ActionOutcome;
    try {
      outcome = await dependencies.executor.execute(proposal, policy);
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

  return {
    propose: async (submission) => {
      const policyResult = evaluateActionProposal(submission);
      if (!policyResult.ok) return policyResult;
      if (!isRecord(submission) || !hasOnlySubmissionKeys(submission) || !isActionName(submission.action)) {
        return createFailure(ACTION_ERROR_CODES.proposalInvalid);
      }

      const policy = getActionPolicy(submission.action);
      if (
        !isPlannerAction(submission.action) &&
        !isOpenApplicationSubmission(submission) &&
        !isOpenWebPageSubmission(submission) &&
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
            } as FileActionProposal
          : {
              actionId,
              action: submission.action as PlannerActionProposal["action"],
              input: submission.input as never
            };
      const startedAt = dependencies.now();

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
      return { ok: true, data: await execute(pending.proposal, pending.policy, pending.startedAt) };
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
    }
  };
};
