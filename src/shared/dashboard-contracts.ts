import type { OperationResult } from "./contracts";
import type { ActionHistoryRecord } from "./action-contracts";
import type {
  EventRecord,
  IsoCalendarDate,
  IsoDateTime,
  ReminderRecord,
  TaskRecord
} from "./planner-contracts";

/** Every dashboard collection is bounded to this fixed number of safe records. */
export const DASHBOARD_SECTION_LIMIT = 5;

export type DashboardTodaySchedule = {
  localDate: IsoCalendarDate;
  tasks: TaskRecord[];
  events: EventRecord[];
  reminders: ReminderRecord[];
};

export type DashboardTodaySummary = {
  today: DashboardTodaySchedule;
  pendingTasks: TaskRecord[];
  upcomingEvents: EventRecord[];
  upcomingReminders: ReminderRecord[];
  recentActivity: ActionHistoryRecord[];
  generatedAt: IsoDateTime;
};

export const DASHBOARD_ERROR_CODES = {
  unavailable: "DASHBOARD_UNAVAILABLE",
  ipcUnavailable: "DASHBOARD_IPC_UNAVAILABLE"
} as const;

export type DashboardErrorCode =
  (typeof DASHBOARD_ERROR_CODES)[keyof typeof DASHBOARD_ERROR_CODES];

export type DashboardOperationResult<T> = OperationResult<T>;

export type DashboardApi = {
  getTodaySummary: () => Promise<DashboardOperationResult<DashboardTodaySummary>>;
};
