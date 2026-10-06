import type { OperationResult } from "./contracts";
import type {
  CompleteTaskInput,
  CreateEventInput,
  CreateReminderInput,
  CreateTaskInput,
  CreateWeeklyRoutineInput,
  CreateWeeklyScheduleInput,
  GetTodayScheduleInput,
  GetWeekScheduleInput,
  DeleteEventInput,
  DeleteTaskInput,
  DeleteEventData,
  PlannerMutationData,
  ReminderRecord,
  TaskRecord,
  TodayScheduleData,
  UpdateEventInput,
  UpdateTaskInput,
  UpdateWeeklyRoutineInput,
  UpdateWeeklyScheduleInput,
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
import type {
  CreateHabitInput,
  UpdateHabitInput
} from "./habit-contracts";

export const ACTION_NAMES = [
  "OPEN_APPLICATION",
  "OPEN_WEB_PAGE",
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
  "GET_WEEK_SCHEDULE",
  "GET_WEEKLY_SCHEDULE_DETAILS",
  "ANALYZE_WEEKLY_SCHEDULE",
  "GET_TODAY_AVAILABILITY",
  "CREATE_WEEKLY_SCHEDULE",
  "UPDATE_WEEKLY_SCHEDULE",
  "CREATE_WEEKLY_ROUTINE",
  "UPDATE_WEEKLY_ROUTINE",
  "GET_CURRENT_DATE_TIME",
  "GET_WEATHER",
  "GET_HABIT_PROGRESS",
  "CREATE_HABIT",
  "UPDATE_HABIT",
  "COMPLETE_HABIT",
  "DELETE_EVENT",
  "DELETE_TASK"
] as const;

/** Policy-only kinds are not executable submissions until a typed Main adapter exists. */
export const ACTION_KINDS = [
  ...ACTION_NAMES,
  "OPEN_REGISTERED_APPLICATION",
  "OPEN_REGISTERED_PAGE",
  "MOVE_FOLDER",
  "UPDATE_REGISTERED_APPLICATION",
  "UPDATE_REGISTERED_PAGE",
  "DELETE_FILE",
  "DELETE_FOLDER"
] as const;

export const ACTION_APPROVAL_CLASSES = [
  "DIRECT",
  "CONFIRMATION_REQUIRED",
  "REINFORCED_CONFIRMATION_REQUIRED"
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
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionApprovalClass = (typeof ACTION_APPROVAL_CLASSES)[number];
export type ActionRiskLevel = (typeof ACTION_RISK_LEVELS)[number];
export type ActionLifecycleState = (typeof ACTION_LIFECYCLE_STATES)[number];
export type TerminalActionStatus = (typeof TERMINAL_ACTION_STATUSES)[number];
export type ActionAvailability = "IMPLEMENTED" | "DEFERRED" | "UNSUPPORTED";
export type IsoDateTime = string;

/** This Main-owned read-only action accepts no caller-provided temporal data. */
export type GetCurrentDateTimeInput = Record<string, never>;

/** The verified result is expressed only through the controlled user summary. */
export type CurrentDateTimeData = Record<string, never>;

/** The initial weather action is fixed to the Main-owned Pasto configuration. */
export type GetWeatherInput = Record<string, never>;

/** Human-readable habit references are resolved by Main immediately before use. */
export type GetHabitProgressInput = { scope: "TODAY" | "WEEK"; habitTitle?: string };
export type CreateHabitActionInput = Omit<CreateHabitInput, "categoryId"> & { categoryName?: string };
export type UpdateHabitActionInput = Omit<UpdateHabitInput, "habitId" | "categoryId"> & {
  habitTitle: string;
  categoryName?: string | null;
};
export type CompleteHabitActionInput = { habitTitle: string };

export type WeeklyScheduleReferenceInput =
  | { scheduleTitle: string }
  | { allSchedules: true };

export const WEEKLY_SCHEDULE_ANALYSIS_KINDS = ["AVAILABILITY", "BUSIEST_DAY", "OVERLAPS"] as const;
export type WeeklyScheduleAnalysisKind = (typeof WEEKLY_SCHEDULE_ANALYSIS_KINDS)[number];

export type GetWeeklyScheduleDetailsInput = WeeklyScheduleReferenceInput;
export type AnalyzeWeeklyScheduleInput = WeeklyScheduleReferenceInput & { analysis: WeeklyScheduleAnalysisKind };
export type GetTodayAvailabilityInput = { afterTime?: string };

/** Human-readable references remain in drafts; Main resolves identifiers only at dispatch. */
export type CreateWeeklyScheduleActionInput = CreateWeeklyScheduleInput;
export type UpdateWeeklyScheduleActionInput = Omit<UpdateWeeklyScheduleInput, "weeklyScheduleId"> & {
  scheduleTitle: string;
};
export type CreateWeeklyRoutineActionInput = Omit<CreateWeeklyRoutineInput, "weeklyScheduleId" | "categoryId"> & {
  scheduleTitle: string;
  categoryName?: string;
};
export type UpdateWeeklyRoutineActionInput = Omit<UpdateWeeklyRoutineInput, "routineId" | "weeklyScheduleId" | "categoryId"> & {
  scheduleTitle: string;
  routineTitle: string;
  targetWeekday?: import("./planner-contracts").Weekday;
  targetStartTime?: string;
  targetEndTime?: string;
  categoryName?: string;
};

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
  | (ActionProposalBase & { action: "GET_WEEK_SCHEDULE"; input: GetWeekScheduleInput })
  | (ActionProposalBase & { action: "GET_WEEKLY_SCHEDULE_DETAILS"; input: GetWeeklyScheduleDetailsInput })
  | (ActionProposalBase & { action: "ANALYZE_WEEKLY_SCHEDULE"; input: AnalyzeWeeklyScheduleInput })
  | (ActionProposalBase & { action: "GET_TODAY_AVAILABILITY"; input: GetTodayAvailabilityInput })
  | (ActionProposalBase & { action: "CREATE_WEEKLY_SCHEDULE"; input: CreateWeeklyScheduleActionInput })
  | (ActionProposalBase & { action: "UPDATE_WEEKLY_SCHEDULE"; input: UpdateWeeklyScheduleActionInput })
  | (ActionProposalBase & { action: "CREATE_WEEKLY_ROUTINE"; input: CreateWeeklyRoutineActionInput })
  | (ActionProposalBase & { action: "UPDATE_WEEKLY_ROUTINE"; input: UpdateWeeklyRoutineActionInput })
  | (ActionProposalBase & { action: "GET_CURRENT_DATE_TIME"; input: GetCurrentDateTimeInput })
  | (ActionProposalBase & { action: "DELETE_EVENT"; input: DeleteEventInput })
  | (ActionProposalBase & { action: "DELETE_TASK"; input: DeleteTaskInput });

export type HabitActionProposal =
  | (ActionProposalBase & { action: "GET_HABIT_PROGRESS"; input: GetHabitProgressInput })
  | (ActionProposalBase & { action: "CREATE_HABIT"; input: CreateHabitActionInput })
  | (ActionProposalBase & { action: "UPDATE_HABIT"; input: UpdateHabitActionInput })
  | (ActionProposalBase & { action: "COMPLETE_HABIT"; input: CompleteHabitActionInput });

export type OpenApplicationInput = {
  alias: string;
};

export type WeatherActionProposal = ActionProposalBase & {
  action: "GET_WEATHER";
  input: GetWeatherInput;
};

/** A fixed Main-owned website identifier, never a caller-provided URL. */
export const WEB_DESTINATIONS = ["YOUTUBE"] as const;
export const WEB_BROWSERS = ["CHROME"] as const;
export type WebDestination = (typeof WEB_DESTINATIONS)[number];
export type WebBrowser = (typeof WEB_BROWSERS)[number];

export type OpenWebPageInput = {
  destination: WebDestination;
  browser: WebBrowser;
};

export type OpenApplicationActionProposal = ActionProposalBase & {
  action: "OPEN_APPLICATION";
  input: OpenApplicationInput;
};

export type OpenWebPageActionProposal = ActionProposalBase & {
  action: "OPEN_WEB_PAGE";
  input: OpenWebPageInput;
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
  | HabitActionProposal
  | WeatherActionProposal
  | OpenApplicationActionProposal
  | OpenWebPageActionProposal
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
  | { action: "GET_WEEK_SCHEDULE"; input: GetWeekScheduleInput }
  | { action: "GET_WEEKLY_SCHEDULE_DETAILS"; input: GetWeeklyScheduleDetailsInput }
  | { action: "ANALYZE_WEEKLY_SCHEDULE"; input: AnalyzeWeeklyScheduleInput }
  | { action: "GET_TODAY_AVAILABILITY"; input: GetTodayAvailabilityInput }
  | { action: "CREATE_WEEKLY_SCHEDULE"; input: CreateWeeklyScheduleActionInput }
  | { action: "UPDATE_WEEKLY_SCHEDULE"; input: UpdateWeeklyScheduleActionInput }
  | { action: "CREATE_WEEKLY_ROUTINE"; input: CreateWeeklyRoutineActionInput }
  | { action: "UPDATE_WEEKLY_ROUTINE"; input: UpdateWeeklyRoutineActionInput }
  | { action: "GET_CURRENT_DATE_TIME"; input: GetCurrentDateTimeInput }
  | { action: "DELETE_EVENT"; input: DeleteEventInput }
  | { action: "DELETE_TASK"; input: DeleteTaskInput };

export type HabitActionSubmission =
  | { action: "GET_HABIT_PROGRESS"; input: GetHabitProgressInput }
  | { action: "CREATE_HABIT"; input: CreateHabitActionInput }
  | { action: "UPDATE_HABIT"; input: UpdateHabitActionInput }
  | { action: "COMPLETE_HABIT"; input: CompleteHabitActionInput };

export type WeatherActionSubmission = {
  action: "GET_WEATHER";
  input: GetWeatherInput;
};

export type OpenApplicationActionSubmission = {
  action: "OPEN_APPLICATION";
  input: OpenApplicationInput;
};

export type OpenWebPageActionSubmission = {
  action: "OPEN_WEB_PAGE";
  input: OpenWebPageInput;
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
  | HabitActionSubmission
  | WeatherActionSubmission
  | OpenApplicationActionSubmission
  | OpenWebPageActionSubmission
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
  | WeekScheduleData
  | Record<string, never>
  | CurrentDateTimeData
  | DeleteEventData;

export type OpenApplicationActionData = {
  applicationName: string;
};

export type OpenWebPageActionData = {
  applicationName: string;
  destination: WebDestination;
};

export type FileActionData =
  | FileSearchData
  | SafeFileMutationRecord
  | FileOrganizationExecutionData;

export type ActionData = PlannerActionData | OpenApplicationActionData | OpenWebPageActionData | FileActionData;

export type ActionOutcome = {
  spokenResponse?: import("./speech-contracts").SpokenResponse;
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
  /** A Main-issued, window-bound reference for optional speech playback. */
  spokenResponse?: import("./speech-contracts").SpokenResponse;
};

export type ActionLifecycleResult = ActionOutcome | AwaitingActionConfirmation;

export type ActionPolicy = {
  action: ActionKind;
  approval: ActionApprovalClass;
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
