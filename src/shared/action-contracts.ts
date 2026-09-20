import type { OperationResult } from "./contracts";
import type {
  CompleteTaskInput,
  CreateEventInput,
  CreateReminderInput,
  CreateTaskInput,
  GetTodayScheduleInput,
  GetWeekScheduleInput,
  PlannerMutationData,
  ReminderRecord,
  TaskRecord,
  TodayScheduleData,
  UpdateEventInput,
  UpdateTaskInput,
  WeekScheduleData,
  EventRecord
} from "./planner-contracts";
import type {
  CreateFolderInput,
  FileSearchData,
  FileSearchInput,
  FileOrganizationExecutionData,
  FileOrganizationPlan,
  MoveFileInput,
  OrganizeFilesInput,
  RenameFileInput,
  RenameFolderInput,
  SafeFileMutationRecord
} from "./file-contracts";

export const ACTION_NAMES = [
  "OPEN_APPLICATION",
  "CREATE_FOLDER",
  "RENAME_FILE",
  "RENAME_FOLDER",
  "MOVE_FILE",
  "SEARCH_FILES",
  "ORGANIZE_FILES",
  "CREATE_TASK",
  "UPDATE_TASK",
  "COMPLETE_TASK",
  "CREATE_EVENT",
  "UPDATE_EVENT",
  "CREATE_REMINDER",
  "GET_TODAY_SCHEDULE",
  "GET_WEEK_SCHEDULE"
] as const;

export const ACTION_RISK_LEVELS = [1, 2, 3] as const;
export const ACTION_LIFECYCLE_STATES = [
  "PROPOSED",
  "AWAITING_CONFIRMATION",
  "APPROVED",
  "RUNNING"
] as const;
export const TERMINAL_ACTION_STATUSES = [
  "SUCCEEDED",
  "CANCELLED",
  "VALIDATION_FAILED",
  "EXECUTION_FAILED",
  "DEPENDENCY_SKIPPED"
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];
export type ActionRiskLevel = (typeof ACTION_RISK_LEVELS)[number];
export type ActionLifecycleState = (typeof ACTION_LIFECYCLE_STATES)[number];
export type TerminalActionStatus = (typeof TERMINAL_ACTION_STATUSES)[number];
export type ActionAvailability = "IMPLEMENTED" | "DEFERRED" | "UNSUPPORTED";
export type IsoDateTime = string;

type ActionProposalBase = {
  actionId: string;
  dependsOn?: string[];
};

export type PlannerActionProposal =
  | (ActionProposalBase & { action: "CREATE_TASK"; input: CreateTaskInput })
  | (ActionProposalBase & { action: "UPDATE_TASK"; input: UpdateTaskInput })
  | (ActionProposalBase & { action: "COMPLETE_TASK"; input: CompleteTaskInput })
  | (ActionProposalBase & { action: "CREATE_EVENT"; input: CreateEventInput })
  | (ActionProposalBase & { action: "UPDATE_EVENT"; input: UpdateEventInput })
  | (ActionProposalBase & { action: "CREATE_REMINDER"; input: CreateReminderInput })
  | (ActionProposalBase & { action: "GET_TODAY_SCHEDULE"; input: GetTodayScheduleInput })
  | (ActionProposalBase & { action: "GET_WEEK_SCHEDULE"; input: GetWeekScheduleInput });

export type OpenApplicationInput = {
  alias: string;
};

export type OpenApplicationActionProposal = ActionProposalBase & {
  action: "OPEN_APPLICATION";
  input: OpenApplicationInput;
};

export type FileActionProposal =
  | (ActionProposalBase & { action: "SEARCH_FILES"; input: FileSearchInput })
  | (ActionProposalBase & { action: "CREATE_FOLDER"; input: CreateFolderInput })
  | (ActionProposalBase & { action: "RENAME_FILE"; input: RenameFileInput })
  | (ActionProposalBase & { action: "RENAME_FOLDER"; input: RenameFolderInput })
  | (ActionProposalBase & { action: "MOVE_FILE"; input: MoveFileInput })
  | (ActionProposalBase & {
      action: "ORGANIZE_FILES";
      input: OrganizeFilesInput;
      /** Generated only in Electron Main before a Level 2 proposal is stored. */
      plan?: FileOrganizationPlan;
    });

export type ExecutableActionProposal =
  | PlannerActionProposal
  | OpenApplicationActionProposal
  | FileActionProposal;

export type DeferredActionName = Exclude<ActionName, ExecutableActionProposal["action"]>;

export type DeferredActionProposal = ActionProposalBase & {
  action: DeferredActionName;
  input?: never;
};

export type ActionProposal = ExecutableActionProposal | DeferredActionProposal;

export type PlannerActionSubmission =
  | { action: "CREATE_TASK"; input: CreateTaskInput }
  | { action: "UPDATE_TASK"; input: UpdateTaskInput }
  | { action: "COMPLETE_TASK"; input: CompleteTaskInput }
  | { action: "CREATE_EVENT"; input: CreateEventInput }
  | { action: "UPDATE_EVENT"; input: UpdateEventInput }
  | { action: "CREATE_REMINDER"; input: CreateReminderInput }
  | { action: "GET_TODAY_SCHEDULE"; input: GetTodayScheduleInput }
  | { action: "GET_WEEK_SCHEDULE"; input: GetWeekScheduleInput };

export type OpenApplicationActionSubmission = {
  action: "OPEN_APPLICATION";
  input: OpenApplicationInput;
};

export type FileActionSubmission =
  | { action: "SEARCH_FILES"; input: FileSearchInput }
  | { action: "CREATE_FOLDER"; input: CreateFolderInput }
  | { action: "RENAME_FILE"; input: RenameFileInput }
  | { action: "RENAME_FOLDER"; input: RenameFolderInput }
  | { action: "MOVE_FILE"; input: MoveFileInput }
  | { action: "ORGANIZE_FILES"; input: OrganizeFilesInput };

export type DeferredActionSubmission = {
  action: DeferredActionName;
};

/** External submissions never include the Main-generated action identifier. */
export type ActionSubmission =
  | PlannerActionSubmission
  | OpenApplicationActionSubmission
  | FileActionSubmission
  | DeferredActionSubmission;

export type ActionConfirmationRequirement = {
  required: boolean;
  summary: string;
  affectedItemCount: number | null;
  scopeSummary: string;
};

export type ActionConfirmationDecision = {
  confirmationId: string;
  decision: "APPROVE" | "CANCEL";
};

export const ACTION_ERROR_CODES = {
  unknown: "ACTION_UNKNOWN",
  unsupported: "ACTION_UNSUPPORTED",
  deferred: "ACTION_DEFERRED",
  proposalInvalid: "ACTION_PROPOSAL_INVALID",
  historyInvalid: "ACTION_HISTORY_INVALID",
  historyUnavailable: "ACTION_HISTORY_UNAVAILABLE",
  confirmationInvalid: "ACTION_CONFIRMATION_INVALID",
  confirmationUnavailable: "ACTION_CONFIRMATION_UNAVAILABLE",
  executionUnavailable: "ACTION_EXECUTION_UNAVAILABLE",
  historyNotRecorded: "ACTION_HISTORY_NOT_RECORDED",
  ipcUnavailable: "ACTION_IPC_UNAVAILABLE"
} as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[keyof typeof ACTION_ERROR_CODES];

export type SafeActionValue = string | number | boolean | null;
export type SafeActionData = Record<string, SafeActionValue>;
export interface SafeHistoryMetadata {
  [key: string]: SafeActionValue | SafeHistoryMetadata;
}

export type PlannerActionData =
  | PlannerMutationData<TaskRecord>
  | PlannerMutationData<EventRecord>
  | PlannerMutationData<ReminderRecord>
  | TodayScheduleData
  | WeekScheduleData;

export type OpenApplicationActionData = {
  applicationName: string;
};

export type FileActionData =
  | FileSearchData
  | SafeFileMutationRecord
  | FileOrganizationExecutionData;

export type ActionData = PlannerActionData | OpenApplicationActionData | FileActionData;

export type ActionOutcome = {
  actionId: string;
  action: ActionName;
  riskLevel: ActionRiskLevel;
  status: TerminalActionStatus;
  data?: ActionData;
  errorCode?: ActionErrorCode | string;
  userSummary: string;
};

export type AwaitingActionConfirmation = {
  lifecycleState: "AWAITING_CONFIRMATION";
  actionId: string;
  action: ActionName;
  riskLevel: ActionRiskLevel;
  confirmationId: string;
  confirmation: ActionConfirmationRequirement;
  /** Present only for a Main-generated organization proposal preview. */
  preview?: FileOrganizationPlan;
};

export type ActionLifecycleResult = ActionOutcome | AwaitingActionConfirmation;

export type ActionPolicy = {
  action: ActionName;
  riskLevel: ActionRiskLevel;
  availability: ActionAvailability;
  confirmation: ActionConfirmationRequirement;
};

export type ActionHistoryRecord = {
  id: string;
  actionId: string;
  action: ActionName;
  riskLevel: ActionRiskLevel;
  status: TerminalActionStatus;
  userSummary: string;
  errorCode: string | null;
  metadata: SafeHistoryMetadata | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
};

export type RecordActionHistoryInput = {
  actionId?: string;
  action: ActionName;
  riskLevel: ActionRiskLevel;
  status: TerminalActionStatus;
  userSummary: string;
  errorCode?: string;
  metadata?: unknown;
  startedAt: IsoDateTime;
  finishedAt?: IsoDateTime;
};

export type ActionHistoryListInput = {
  actionId?: string;
  actions?: ActionName[];
  statuses?: TerminalActionStatus[];
  riskLevels?: ActionRiskLevel[];
  startedAtFrom?: IsoDateTime;
  startedAtTo?: IsoDateTime;
  limit?: number;
};

export type ActionOperationResult<T> = OperationResult<T>;

export type ActionApi = {
  propose: (submission: ActionSubmission) => Promise<ActionOperationResult<ActionLifecycleResult>>;
  confirm: (confirmationId: string) => Promise<ActionOperationResult<ActionOutcome>>;
  cancel: (confirmationId: string) => Promise<ActionOperationResult<ActionOutcome>>;
  history: {
    list: (
      input: ActionHistoryListInput
    ) => Promise<ActionOperationResult<{ items: ActionHistoryRecord[]; total: number }>>;
  };
};
