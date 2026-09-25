import type { ActionSubmission } from "./action-contracts";
import type { OperationResult } from "./contracts";
import type { SafeFileReference } from "./file-contracts";

export type AssistantInterpretInput = { instruction: string };
/** Renderer-facing input. Main maps this to the interpreter-only instruction contract. */
export type AssistantInterpretRequest = { text: string };
export type AssistantInterpretationState = "READY" | "NEEDS_CLARIFICATION" | "REJECTED" | "UNAVAILABLE";
export type AssistantClarification = { question: string };
export type AssistantActionDraft = ActionSubmission;

export const ASSISTANT_CURRENT_CONTEXT_TOKEN = "$CURRENT_CONTEXT" as const;

export type AssistantContextKind =
  | "TASK"
  | "EVENT"
  | "REMINDER"
  | "FILE"
  | "FOLDER"
  | "APPLICATION";

export type AssistantContextSelection =
  | { section: "PLANNER"; kind: "TASK" | "EVENT" | "REMINDER"; id: string }
  | { section: "FILES"; kind: "FILE" | "FOLDER"; reference: SafeFileReference }
  | { section: "APPLICATIONS"; kind: "APPLICATION"; alias: string };

export type AssistantContextSetInput = { selection: AssistantContextSelection };

export type AssistantContextData = {
  status: "SET" | "CLEARED";
  kind?: AssistantContextKind;
};

/** Provider-safe view. It intentionally excludes identifiers and references. */
export type AssistantCurrentContext = {
  token: typeof ASSISTANT_CURRENT_CONTEXT_TOKEN;
  kind: AssistantContextKind;
  label: string;
};

/** Main-only trusted catalog context; it contains no executable target or database identifier. */
export type TrustedApplicationReference = {
  displayName: string;
  alias: string;
};

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
  knownApplications?: TrustedApplicationReference[];
  knownFileReferences?: SafeFileReference[];
  currentContext?: AssistantCurrentContext;
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
  ipcUnavailable: "ASSISTANT_IPC_UNAVAILABLE",
  contextInvalid: "ASSISTANT_CONTEXT_INVALID",
  contextUnavailable: "ASSISTANT_CONTEXT_UNAVAILABLE"
} as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES];
export type AssistantOperationResult<T> = OperationResult<T>;

export type AssistantApi = {
  interpret: (
    input: AssistantInterpretRequest
  ) => Promise<AssistantOperationResult<AssistantInterpretation>>;
  context: {
    set: (
      input: AssistantContextSetInput
    ) => Promise<AssistantOperationResult<AssistantContextData>>;
    clear: () => Promise<AssistantOperationResult<AssistantContextData>>;
  };
};
