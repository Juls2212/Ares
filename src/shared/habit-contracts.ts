import type { OperationResult } from "./contracts";
import type { IsoCalendarDate, IsoDateTime } from "./planner-contracts";

export const HABIT_FREQUENCIES = ["DAILY", "WEEKLY"] as const;
export const HABIT_ICON_KEYS = ["SPARK", "BOOK", "DUMBBELL", "HOME", "HEART", "WATER", "RUNNING", "BRAIN", "LEAF"] as const;

export type HabitFrequency = (typeof HABIT_FREQUENCIES)[number];
export type HabitIcon = (typeof HABIT_ICON_KEYS)[number];
export const DEFAULT_HABIT_ICON: HabitIcon = "SPARK";

export type HabitRecord = {
  id: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  icon: HabitIcon;
  frequency: HabitFrequency;
  targetCount: number;
  active: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type HabitCompletionRecord = {
  id: string;
  habitId: string;
  completedOn: IsoCalendarDate;
  completedAt: IsoDateTime;
};

export type CreateHabitInput = {
  title: string;
  description?: string;
  categoryId?: string;
  icon?: HabitIcon;
  frequency: HabitFrequency;
  targetCount: number;
};

export type UpdateHabitInput = {
  habitId: string;
  title?: string;
  description?: string | null;
  categoryId?: string | null;
  icon?: HabitIcon;
  frequency?: HabitFrequency;
  targetCount?: number;
  active?: boolean;
};

export type HabitListInput = {
  includeInactive?: boolean;
};

export type CompleteHabitInput = {
  habitId: string;
  completedOn: IsoCalendarDate;
};

export type HabitDailyProgressInput = { date: IsoCalendarDate };
export type HabitWeeklyProgressInput = { weekStart: IsoCalendarDate };

export type HabitDailyProgressItem = {
  habit: HabitRecord;
  completed: boolean;
  completion: HabitCompletionRecord | null;
  currentStreak: number;
  longestStreak: number;
};

export type HabitDailyProgressData = {
  date: IsoCalendarDate;
  completed: HabitDailyProgressItem[];
  pending: HabitDailyProgressItem[];
};

export type HabitWeeklyProgressItem = {
  habit: HabitRecord;
  completionCount: number;
  targetCount: number;
  periodTargetCount: number;
  targetMet: boolean;
  currentStreak: number;
  longestStreak: number;
};

export type HabitWeeklyProgressData = {
  weekStart: IsoCalendarDate;
  weekEnd: IsoCalendarDate;
  items: HabitWeeklyProgressItem[];
};

export type HabitListData<T> = { items: T[]; total: number };
export type HabitMutationData<T> = { record: T };

export const HABIT_ERROR_CODES = {
  inputInvalid: "HABIT_INPUT_INVALID",
  unknownField: "HABIT_UNKNOWN_FIELD",
  requiredFieldMissing: "HABIT_REQUIRED_FIELD_MISSING",
  fieldTypeInvalid: "HABIT_FIELD_TYPE_INVALID",
  textInvalid: "HABIT_TEXT_INVALID",
  textTooLong: "HABIT_TEXT_TOO_LONG",
  identifierInvalid: "HABIT_IDENTIFIER_INVALID",
  enumInvalid: "HABIT_ENUM_INVALID",
  iconInvalid: "HABIT_ICON_INVALID",
  targetCountInvalid: "HABIT_TARGET_COUNT_INVALID",
  dateInvalid: "HABIT_DATE_INVALID",
  updateEmpty: "HABIT_UPDATE_EMPTY",
  notFound: "HABIT_NOT_FOUND",
  referenceNotFound: "HABIT_REFERENCE_NOT_FOUND",
  conflict: "HABIT_CONFLICT",
  databaseUnavailable: "HABIT_DATABASE_UNAVAILABLE",
  ipcUnavailable: "HABIT_IPC_UNAVAILABLE"
} as const;

export type HabitErrorCode = (typeof HABIT_ERROR_CODES)[keyof typeof HABIT_ERROR_CODES];
export type HabitOperationResult<T> = OperationResult<T>;

export type HabitsApi = {
  create: (input: CreateHabitInput) => Promise<HabitOperationResult<HabitMutationData<HabitRecord>>>;
  list: (input: HabitListInput) => Promise<HabitOperationResult<HabitListData<HabitRecord>>>;
  update: (input: UpdateHabitInput) => Promise<HabitOperationResult<HabitMutationData<HabitRecord>>>;
  complete: (input: CompleteHabitInput) => Promise<HabitOperationResult<HabitMutationData<HabitCompletionRecord>>>;
  getDailyProgress: (input: HabitDailyProgressInput) => Promise<HabitOperationResult<HabitDailyProgressData>>;
  getWeeklyProgress: (input: HabitWeeklyProgressInput) => Promise<HabitOperationResult<HabitWeeklyProgressData>>;
};
