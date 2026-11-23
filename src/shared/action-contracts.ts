import type { OperationResult } from "./contracts";
import type {
  CompleteTaskInput,
  CreateEventInput,
  CreateReminderInput,
  CreateTaskInput,
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
  WeekScheduleData,
  EventRecord
} from "./planner-contracts";
import type { ApplicationCatalogKey } from "./application-contracts";
import type {
  DeleteContactInput,
  DiscardMessageDraftInput,
  EditMessageDraftInput,
  ListContactsInput,
  MessagingActionData,
  OpenWhatsAppChatWithDraftInput,
  PrepareMessageDraftInput,
  PreparedDeleteContactInput,
  PreparedOpenWhatsAppChatInput,
  PreparedSaveContactInput,
  SaveContactInput
} from "./messaging-contracts";
import type {
  CreateSupervisedFolderInput,
  DeleteFoundItemInput,
  MoveFoundItemsInput,
  OpenFoundFileInput,
  OrganizeFoundItemsInput,
  RenameFoundItemInput,
  RevealFoundFileInput,
  SearchFilesInput,
  SupervisedFileMutationData,
  SupervisedFileSearchData
} from "./supervised-file-contracts";

export const ACTION_NAMES = [
  "OPEN_APPLICATION",
  "REGISTER_CATALOG_APPLICATION",
  "REQUEST_CUSTOM_APPLICATION_REGISTRATION",
  "OPEN_APPROVED_PAGE",
  "SEARCH_APPROVED_SITE",
  "CREATE_FOLDER",
  "SEARCH_FILES",
  "REVEAL_FOUND_FILE",
  "OPEN_FOUND_FILE",
  "RENAME_FOUND_ITEM",
  "MOVE_FOUND_ITEMS",
  "ORGANIZE_FOUND_ITEMS",
  "DELETE_FOUND_ITEM",
  "CREATE_TASK",
  "UPDATE_TASK",
  "COMPLETE_TASK",
  "CREATE_EVENT",
  "UPDATE_EVENT",
  "CREATE_REMINDER",
  "GET_TODAY_SCHEDULE",
  "GET_WEEK_SCHEDULE",
  "GET_CURRENT_DATE_TIME",
  "GET_WEATHER",
  "DELETE_EVENT",
  "DELETE_TASK",
  "SAVE_CONTACT",
  "LIST_CONTACTS",
  "DELETE_CONTACT",
  "PREPARE_MESSAGE_DRAFT",
  "EDIT_MESSAGE_DRAFT",
  "DISCARD_MESSAGE_DRAFT",
  "OPEN_WHATSAPP_CHAT_WITH_DRAFT",
  "SEARCH_SPOTIFY_APP",
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

/** Bounds of the read-only weather query: a plain place name and a small day offset, never a URL or coordinates. */
export const WEATHER_MAX_LOCATION_LENGTH = 80;
export const WEATHER_MAX_DAY_OFFSET = 6;

/**
 * Both fields are optional: without a location Main uses its configured default place, and without a day offset the
 * answer is about now and today. Anything else is rejected by a closed validator.
 */
export type GetWeatherInput = { location?: string; dayOffset?: number };

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
  | (ActionProposalBase & { action: "GET_CURRENT_DATE_TIME"; input: GetCurrentDateTimeInput })
  | (ActionProposalBase & { action: "DELETE_EVENT"; input: DeleteEventInput })
  | (ActionProposalBase & { action: "DELETE_TASK"; input: DeleteTaskInput });

/** Closed refinement of a Spotify app search; it only shapes the spoken text, never the launch target. */
export const SPOTIFY_SEARCH_KINDS = ["TRACK", "ARTIST", "ALBUM", "PLAYLIST", "ANY"] as const;
export type SpotifySearchKind = (typeof SPOTIFY_SEARCH_KINDS)[number];

/** A plain-text query only; Main composes the fixed Spotify search target and never accepts a URI. */
export type SearchSpotifyAppInput = {
  query: string;
  kind?: SpotifySearchKind;
  /** True when the person asked to play; it only adds the hint that direct playback is not available yet. */
  playRequested?: boolean;
};

/** Spotify Web API playback: a plain query and a closed kind, or a bounded volume; never an id, URI or URL. */
export type PlaySpotifyMusicInput = { query: string; kind?: SpotifySearchKind };
export type SetSpotifyVolumeInput = { level: number } | { change: "UP" | "DOWN" };
export type SpotifyEmptyInputAction =
  | "CONNECT_SPOTIFY"
  | "DISCONNECT_SPOTIFY"
  | "GET_SPOTIFY_STATUS"
  | "PAUSE_SPOTIFY"
  | "RESUME_SPOTIFY"
  | "NEXT_SPOTIFY_TRACK"
  | "PREVIOUS_SPOTIFY_TRACK"
  | "WHAT_IS_PLAYING";

export type OpenApplicationInput = {
  alias: string;
};

/** A closed catalog key and optional validated public alias; no launch target is caller supplied. */
export type RegisterCatalogApplicationInput = {
  catalogKey: ApplicationCatalogKey;
  alias?: string;
};

/** Only an optional friendly name; the executable is always chosen in a Main-owned native picker. */
export type RequestCustomApplicationRegistrationInput = {
  displayName?: string;
};

/** Main-only shape after the picker ran: the opaque selection reference never comes from a caller. */
export type PreparedCustomApplicationRegistrationInput = {
  displayName: string;
  selectionId: string;
};

/** A closed Main-owned site identifier; callers never provide a URL or domain. */
export const APPROVED_SITES = ["GOOGLE", "YOUTUBE", "SPOTIFY"] as const;
export type ApprovedSite = (typeof APPROVED_SITES)[number];

export type OpenApprovedPageInput = {
  site: ApprovedSite;
};

export type SearchApprovedSiteInput = {
  site: ApprovedSite;
  query: string;
};

export type WeatherActionProposal = ActionProposalBase & {
  action: "GET_WEATHER";
  input: GetWeatherInput;
};

export type OpenApplicationActionProposal = ActionProposalBase & {
  action: "OPEN_APPLICATION";
  input: OpenApplicationInput;
};

export type SearchSpotifyAppActionProposal = ActionProposalBase & {
  action: "SEARCH_SPOTIFY_APP";
  input: SearchSpotifyAppInput;
};

export type SpotifyMusicActionProposal =
  | (ActionProposalBase & { action: SpotifyEmptyInputAction; input: Record<string, never> })
  | (ActionProposalBase & { action: "PLAY_SPOTIFY_MUSIC"; input: PlaySpotifyMusicInput })
  | (ActionProposalBase & { action: "SET_SPOTIFY_VOLUME"; input: SetSpotifyVolumeInput });

export type RegisterCatalogApplicationActionProposal = ActionProposalBase & {
  action: "REGISTER_CATALOG_APPLICATION";
  input: RegisterCatalogApplicationInput;
};

export type RequestCustomApplicationRegistrationActionProposal = ActionProposalBase & {
  action: "REQUEST_CUSTOM_APPLICATION_REGISTRATION";
  input: RequestCustomApplicationRegistrationInput | PreparedCustomApplicationRegistrationInput;
};

export type ApprovedWebActionProposal =
  | (ActionProposalBase & { action: "OPEN_APPROVED_PAGE"; input: OpenApprovedPageInput })
  | (ActionProposalBase & { action: "SEARCH_APPROVED_SITE"; input: SearchApprovedSiteInput });

/** The supervised FILES domain: ordinals and enum values only, never a caller-supplied path. */
export type SupervisedFilesActionProposal =
  | (ActionProposalBase & { action: "SEARCH_FILES"; input: SearchFilesInput })
  | (ActionProposalBase & { action: "REVEAL_FOUND_FILE"; input: RevealFoundFileInput })
  | (ActionProposalBase & { action: "OPEN_FOUND_FILE"; input: OpenFoundFileInput })
  | (ActionProposalBase & { action: "CREATE_FOLDER"; input: CreateSupervisedFolderInput })
  | (ActionProposalBase & { action: "RENAME_FOUND_ITEM"; input: RenameFoundItemInput })
  | (ActionProposalBase & { action: "MOVE_FOUND_ITEMS"; input: MoveFoundItemsInput })
  | (ActionProposalBase & { action: "ORGANIZE_FOUND_ITEMS"; input: OrganizeFoundItemsInput })
  | (ActionProposalBase & { action: "DELETE_FOUND_ITEM"; input: DeleteFoundItemInput });

/**
 * The MESSAGING domain: contacts and local drafts only. The phone number is never part of any
 * proposal; Main holds it in a pending contact and the proposal carries only an opaque reference.
 */
export type MessagingActionProposal =
  | (ActionProposalBase & { action: "SAVE_CONTACT"; input: SaveContactInput | PreparedSaveContactInput })
  | (ActionProposalBase & { action: "LIST_CONTACTS"; input: ListContactsInput })
  | (ActionProposalBase & { action: "DELETE_CONTACT"; input: DeleteContactInput | PreparedDeleteContactInput })
  | (ActionProposalBase & { action: "PREPARE_MESSAGE_DRAFT"; input: PrepareMessageDraftInput })
  | (ActionProposalBase & { action: "EDIT_MESSAGE_DRAFT"; input: EditMessageDraftInput })
  | (ActionProposalBase & { action: "DISCARD_MESSAGE_DRAFT"; input: DiscardMessageDraftInput })
  | (ActionProposalBase & {
      action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT";
      input: OpenWhatsAppChatWithDraftInput | PreparedOpenWhatsAppChatInput;
    });

export type ExecutableActionProposal =
  | PlannerActionProposal
  | WeatherActionProposal
  | OpenApplicationActionProposal
  | SearchSpotifyAppActionProposal
  | SpotifyMusicActionProposal
  | RegisterCatalogApplicationActionProposal
  | RequestCustomApplicationRegistrationActionProposal
  | ApprovedWebActionProposal
  | SupervisedFilesActionProposal
  | MessagingActionProposal;

export type ActionProposal = ExecutableActionProposal;

export type PlannerActionSubmission =
  | { action: "CREATE_TASK"; input: CreateTaskInput }
  | { action: "UPDATE_TASK"; input: UpdateTaskInput }
  | { action: "COMPLETE_TASK"; input: CompleteTaskInput }
  | { action: "CREATE_EVENT"; input: CreateEventInput }
  | { action: "UPDATE_EVENT"; input: UpdateEventInput }
  | { action: "CREATE_REMINDER"; input: CreateReminderInput }
  | { action: "GET_TODAY_SCHEDULE"; input: GetTodayScheduleInput }
  | { action: "GET_WEEK_SCHEDULE"; input: GetWeekScheduleInput }
  | { action: "GET_CURRENT_DATE_TIME"; input: GetCurrentDateTimeInput }
  | { action: "DELETE_EVENT"; input: DeleteEventInput }
  | { action: "DELETE_TASK"; input: DeleteTaskInput };

export type WeatherActionSubmission = {
  action: "GET_WEATHER";
  input: GetWeatherInput;
};

export type OpenApplicationActionSubmission = {
  action: "OPEN_APPLICATION";
  input: OpenApplicationInput;
};

export type SearchSpotifyAppActionSubmission = {
  action: "SEARCH_SPOTIFY_APP";
  input: SearchSpotifyAppInput;
};

export type SpotifyMusicActionSubmission =
  | { action: SpotifyEmptyInputAction; input: Record<string, never> }
  | { action: "PLAY_SPOTIFY_MUSIC"; input: PlaySpotifyMusicInput }
  | { action: "SET_SPOTIFY_VOLUME"; input: SetSpotifyVolumeInput };

export type RegisterCatalogApplicationActionSubmission = {
  action: "REGISTER_CATALOG_APPLICATION";
  input: RegisterCatalogApplicationInput;
};

export type RequestCustomApplicationRegistrationActionSubmission = {
  action: "REQUEST_CUSTOM_APPLICATION_REGISTRATION";
  input: RequestCustomApplicationRegistrationInput;
};

export type ApprovedWebActionSubmission =
  | { action: "OPEN_APPROVED_PAGE"; input: OpenApprovedPageInput }
  | { action: "SEARCH_APPROVED_SITE"; input: SearchApprovedSiteInput };

export type SupervisedFilesActionSubmission =
  | { action: "SEARCH_FILES"; input: SearchFilesInput }
  | { action: "REVEAL_FOUND_FILE"; input: RevealFoundFileInput }
  | { action: "OPEN_FOUND_FILE"; input: Omit<OpenFoundFileInput, "preparedId"> }
  | { action: "CREATE_FOLDER"; input: Omit<CreateSupervisedFolderInput, "preparedId"> }
  | { action: "RENAME_FOUND_ITEM"; input: Omit<RenameFoundItemInput, "preparedId"> }
  | { action: "MOVE_FOUND_ITEMS"; input: Omit<MoveFoundItemsInput, "preparedId"> }
  | { action: "ORGANIZE_FOUND_ITEMS"; input: Omit<OrganizeFoundItemsInput, "preparedId"> }
  | { action: "DELETE_FOUND_ITEM"; input: Omit<DeleteFoundItemInput, "preparedId"> };

export type MessagingActionSubmission =
  | { action: "SAVE_CONTACT"; input: SaveContactInput }
  | { action: "LIST_CONTACTS"; input: ListContactsInput }
  | { action: "DELETE_CONTACT"; input: DeleteContactInput }
  | { action: "PREPARE_MESSAGE_DRAFT"; input: PrepareMessageDraftInput }
  | { action: "EDIT_MESSAGE_DRAFT"; input: EditMessageDraftInput }
  | { action: "DISCARD_MESSAGE_DRAFT"; input: DiscardMessageDraftInput }
  | { action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT"; input: OpenWhatsAppChatWithDraftInput };

/** External submissions never include the Main-generated action identifier. */
export type ActionSubmission =
  | PlannerActionSubmission
  | WeatherActionSubmission
  | OpenApplicationActionSubmission
  | SearchSpotifyAppActionSubmission
  | SpotifyMusicActionSubmission
  | RegisterCatalogApplicationActionSubmission
  | RequestCustomApplicationRegistrationActionSubmission
  | ApprovedWebActionSubmission
  | SupervisedFilesActionSubmission
  | MessagingActionSubmission;

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

/** Safe terminal data deliberately excludes both the query and generated URL. */
export type ApprovedWebActionData = {
  site: ApprovedSite;
  mode: "HOME" | "SEARCH";
};

export type ActionData =
  | PlannerActionData
  | OpenApplicationActionData
  | ApprovedWebActionData
  | SupervisedFileSearchData
  | SupervisedFileMutationData
  | MessagingActionData;

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
};
