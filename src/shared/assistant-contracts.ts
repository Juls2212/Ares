import type { ActionSubmission } from "./action-contracts";
import type { OperationResult } from "./contracts";
import type { SafeFileReference } from "./file-contracts";

export type AssistantInterpretInput = { instruction: string };
/** Renderer-facing input. Main maps this to the interpreter-only instruction contract. */
export type AssistantInterpretRequest = { text: string };
export type AssistantInterpretationState = "READY" | "NEEDS_CLARIFICATION" | "REJECTED" | "UNAVAILABLE";
export type AssistantClarification = { question: string };
export type AssistantActionDraft = ActionSubmission;

export type AssistantInterpretation = {
  state: AssistantInterpretationState;
  summary: string;
  drafts: AssistantActionDraft[];
  clarifications: AssistantClarification[];
  errorCode?: AssistantErrorCode;
};

/**
 * Trusted Main-only reference data. It is supplied by future Main composition,
 * never accepted from a renderer, and is not an execution authority.
 */
export type AssistantInterpretationReference = {
  now: string;
  timeZone: string;
  knownApplicationAliases?: string[];
  knownFileReferences?: SafeFileReference[];
};

export const ASSISTANT_ERROR_CODES = {
  unavailable: "ASSISTANT_UNAVAILABLE",
  configuration: "ASSISTANT_CONFIGURATION_UNAVAILABLE",
  authentication: "ASSISTANT_AUTHENTICATION_UNAVAILABLE",
  modelAccess: "ASSISTANT_MODEL_ACCESS_UNAVAILABLE",
  timeout: "ASSISTANT_TIMEOUT",
  rateLimited: "ASSISTANT_RATE_LIMITED",
  provider: "ASSISTANT_PROVIDER_UNAVAILABLE",
  malformed: "ASSISTANT_MALFORMED_OUTPUT",
  rejected: "ASSISTANT_REJECTED",
  busy: "ASSISTANT_BUSY",
  ipcUnavailable: "ASSISTANT_IPC_UNAVAILABLE"
} as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES];
export type AssistantOperationResult<T> = OperationResult<T>;

export type AssistantApi = {
  interpret: (
    input: AssistantInterpretRequest
  ) => Promise<AssistantOperationResult<AssistantInterpretation>>;
};
