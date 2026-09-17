import type { OperationResult } from "./contracts";

export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const REMINDER_STATUSES = ["PENDING", "TRIGGERED", "CANCELLED"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export type IsoCalendarDate = string;
export type IsoLocalTime = string;
export type IsoDateTime = string;

export type CategoryRecord = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  dueDate: IsoCalendarDate | null;
  dueTime: IsoLocalTime | null;
  priority: TaskPriority;
  status: TaskStatus;
  categoryId: string | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type EventRecord = {
  id: string;
  title: string;
  description: string | null;
  startAt: IsoDateTime;
  endAt: IsoDateTime | null;
  categoryId: string | null;
  location: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type ReminderRecord = {
  id: string;
  title: string;
  remindAt: IsoDateTime;
  taskId: string | null;
  eventId: string | null;
  status: ReminderStatus;
  deliveredAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type CreateCategoryInput = {
  name: string;
  color?: string;
  icon?: string;
};

export type UpdateCategoryInput = {
  categoryId: string;
  name?: string;
  color?: string | null;
  icon?: string | null;
};

export type CategoryListInput = Record<string, never>;

export type CreateTaskInput = {
  title: string;
  description?: string;
  dueDate?: IsoCalendarDate;
  dueTime?: IsoLocalTime;
  priority?: TaskPriority;
  status?: TaskStatus;
  categoryId?: string;
  completedAt?: IsoDateTime;
};

export type UpdateTaskInput = {
  taskId: string;
  title?: string;
  description?: string | null;
  dueDate?: IsoCalendarDate | null;
  dueTime?: IsoLocalTime | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  categoryId?: string | null;
  completedAt?: IsoDateTime | null;
};

export type CompleteTaskInput = {
  taskId: string;
  completedAt: IsoDateTime;
};

export type TaskListInput = {
  statuses?: TaskStatus[];
  categoryId?: string;
  dueDateFrom?: IsoCalendarDate;
  dueDateTo?: IsoCalendarDate;
  includeCompleted?: boolean;
};

export type CreateEventInput = {
  title: string;
  description?: string;
  startAt: IsoDateTime;
  endAt?: IsoDateTime;
  categoryId?: string;
  location?: string;
};

export type UpdateEventInput = {
  eventId: string;
  title?: string;
  description?: string | null;
  startAt?: IsoDateTime;
  endAt?: IsoDateTime | null;
  categoryId?: string | null;
  location?: string | null;
};

export type EventListInput = {
  categoryId?: string;
  startAt?: IsoDateTime;
  endAt?: IsoDateTime;
};

export type CreateReminderInput = {
  title: string;
  remindAt: IsoDateTime;
  taskId?: string;
  eventId?: string;
  status?: ReminderStatus;
  deliveredAt?: IsoDateTime;
};

export type ReminderListInput = {
  statuses?: ReminderStatus[];
  taskId?: string;
  eventId?: string;
  remindAtFrom?: IsoDateTime;
  remindAtTo?: IsoDateTime;
};

export type GetTodayScheduleInput = {
  includeCompletedTasks?: boolean;
};

export type GetWeekScheduleInput = {
  weekStart?: IsoCalendarDate;
  includeCompletedTasks?: boolean;
};

export type PlannerListData<T> = {
  items: T[];
  total: number;
};

export type PlannerMutationData<T> = {
  record: T;
};

export type TodayScheduleData = {
  localDate: IsoCalendarDate;
  tasks: TaskRecord[];
  events: EventRecord[];
  reminders: ReminderRecord[];
};

export type WeekScheduleData = {
  weekStart: IsoCalendarDate;
  weekEnd: IsoCalendarDate;
  tasks: TaskRecord[];
  events: EventRecord[];
  reminders: ReminderRecord[];
};

export type PlannerApi = {
  categories: {
    create: (input: CreateCategoryInput) => Promise<PlannerOperationResult<PlannerMutationData<CategoryRecord>>>;
    list: (input: CategoryListInput) => Promise<PlannerOperationResult<PlannerListData<CategoryRecord>>>;
    update: (input: UpdateCategoryInput) => Promise<PlannerOperationResult<PlannerMutationData<CategoryRecord>>>;
  };
  tasks: {
    create: (input: CreateTaskInput) => Promise<PlannerOperationResult<PlannerMutationData<TaskRecord>>>;
    list: (input: TaskListInput) => Promise<PlannerOperationResult<PlannerListData<TaskRecord>>>;
    update: (input: UpdateTaskInput) => Promise<PlannerOperationResult<PlannerMutationData<TaskRecord>>>;
    complete: (input: CompleteTaskInput) => Promise<PlannerOperationResult<PlannerMutationData<TaskRecord>>>;
  };
  events: {
    create: (input: CreateEventInput) => Promise<PlannerOperationResult<PlannerMutationData<EventRecord>>>;
    list: (input: EventListInput) => Promise<PlannerOperationResult<PlannerListData<EventRecord>>>;
    update: (input: UpdateEventInput) => Promise<PlannerOperationResult<PlannerMutationData<EventRecord>>>;
  };
  reminders: {
    create: (input: CreateReminderInput) => Promise<PlannerOperationResult<PlannerMutationData<ReminderRecord>>>;
    list: (input: ReminderListInput) => Promise<PlannerOperationResult<PlannerListData<ReminderRecord>>>;
  };
  schedule: {
    getToday: (input: GetTodayScheduleInput) => Promise<PlannerOperationResult<TodayScheduleData>>;
    getWeek: (input: GetWeekScheduleInput) => Promise<PlannerOperationResult<WeekScheduleData>>;
  };
};

export const PLANNER_ERROR_CODES = {
  inputInvalid: "PLANNER_INPUT_INVALID",
  unknownField: "PLANNER_UNKNOWN_FIELD",
  requiredFieldMissing: "PLANNER_REQUIRED_FIELD_MISSING",
  fieldTypeInvalid: "PLANNER_FIELD_TYPE_INVALID",
  textInvalid: "PLANNER_TEXT_INVALID",
  textTooLong: "PLANNER_TEXT_TOO_LONG",
  identifierInvalid: "PLANNER_IDENTIFIER_INVALID",
  colorInvalid: "PLANNER_COLOR_INVALID",
  enumInvalid: "PLANNER_ENUM_INVALID",
  dateInvalid: "PLANNER_DATE_INVALID",
  timeInvalid: "PLANNER_TIME_INVALID",
  dateTimeInvalid: "PLANNER_DATE_TIME_INVALID",
  taskDueTimeRequiresDate: "PLANNER_TASK_DUE_TIME_REQUIRES_DATE",
  taskCompletionStateInvalid: "PLANNER_TASK_COMPLETION_STATE_INVALID",
  eventTimeRangeInvalid: "PLANNER_EVENT_TIME_RANGE_INVALID",
  reminderAssociationInvalid: "PLANNER_REMINDER_ASSOCIATION_INVALID",
  reminderDeliveryStateInvalid: "PLANNER_REMINDER_DELIVERY_STATE_INVALID",
  updateEmpty: "PLANNER_UPDATE_EMPTY",
  notFound: "PLANNER_NOT_FOUND",
  referenceNotFound: "PLANNER_REFERENCE_NOT_FOUND",
  conflict: "PLANNER_CONFLICT",
  databaseUnavailable: "PLANNER_DATABASE_UNAVAILABLE",
  taskAlreadyCompleted: "PLANNER_TASK_ALREADY_COMPLETED",
  ipcUnavailable: "PLANNER_IPC_UNAVAILABLE"
} as const;

export type PlannerErrorCode =
  (typeof PLANNER_ERROR_CODES)[keyof typeof PLANNER_ERROR_CODES];

export type PlannerOperationResult<T> = OperationResult<T>;
