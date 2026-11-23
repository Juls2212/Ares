import type { ActionData, ActionName, ActionOutcome, ActionRiskLevel, TerminalActionStatus } from "./action-contracts";
import type { AssistantInterpretation } from "./assistant-contracts";

/**
 * Builders for the shapes the action executors and the orchestrator hand back: a succeeded, failed or cancelled action outcome,
 * the generic history sentence persisted for an outcome, and the interpreter's clarification. They produce exactly the shapes
 * the code built by hand before, so every executor describes an outcome the same way and a field cannot be forgotten.
 *
 * An outcome never contains anything that was not passed in: the summary is the Spanish text the caller chose (a fixed
 * message from a failure taxonomy or a Main-composed sentence) and the optional data is the caller's typed payload.
 */

/** The three fields every outcome repeats from its proposal and policy. */
export type OutcomeIdentity = { actionId: string; action: ActionName; riskLevel: ActionRiskLevel };

export const outcomeIdentity = (
  proposal: { actionId: string; action: ActionName },
  policy: { riskLevel: ActionRiskLevel }
): OutcomeIdentity => ({ actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel });

/** The two statuses a failed outcome can carry. */
export type FailureOutcomeStatus = Extract<TerminalActionStatus, "VALIDATION_FAILED" | "EXECUTION_FAILED">;

type OutcomeExtras = { data?: ActionData; errorCode?: string };

/** A completed action. `data` and `errorCode` appear only when given. */
export const succeededOutcome = (identity: OutcomeIdentity, userSummary: string, extras: OutcomeExtras = {}): ActionOutcome => ({
  ...identity,
  status: "SUCCEEDED",
  ...(extras.data === undefined ? {} : { data: extras.data }),
  ...(extras.errorCode === undefined ? {} : { errorCode: extras.errorCode }),
  userSummary
});

/** An action that did not complete: `VALIDATION_FAILED` for what the person asked for, `EXECUTION_FAILED` for the system. */
export const failedOutcome = (
  identity: OutcomeIdentity,
  status: FailureOutcomeStatus,
  errorCode: string,
  userSummary: string,
  data?: ActionData
): ActionOutcome => ({
  ...identity,
  status,
  ...(data === undefined ? {} : { data }),
  errorCode,
  userSummary
});

/** An action the person (or an expiry) cancelled. */
export const cancelledOutcome = (identity: OutcomeIdentity, userSummary: string, errorCode?: string): ActionOutcome => ({
  ...identity,
  status: "CANCELLED",
  ...(errorCode === undefined ? {} : { errorCode }),
  userSummary
});

/**
 * The generic sentence persisted to history for a domain: one fixed sentence per outcome category and nothing from the
 * outcome itself. Without a `cancelled` sentence a cancelled outcome uses the `failed` one.
 */
export const historySentences = (sentences: { succeeded: string; failed: string; cancelled?: string }) =>
  (status: TerminalActionStatus): string =>
    status === "SUCCEEDED" ? sentences.succeeded : status === "CANCELLED" ? (sentences.cancelled ?? sentences.failed) : sentences.failed;

/** The interpreter's «I need one more detail» result: no drafts, one question. The summary defaults to the question itself. */
export const clarificationInterpretation = (question: string, summary: string = question): AssistantInterpretation => ({
  state: "NEEDS_CLARIFICATION",
  summary,
  drafts: [],
  clarifications: [{ question }]
});
