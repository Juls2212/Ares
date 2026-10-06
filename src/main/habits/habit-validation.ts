import {
  HABIT_ERROR_CODES,
  HABIT_FREQUENCIES,
  HABIT_ICON_KEYS,
  DEFAULT_HABIT_ICON,
  type CompleteHabitInput,
  type CreateHabitInput,
  type HabitFrequency,
  type HabitIcon,
  type HabitListInput,
  type HabitOperationResult,
  type HabitDailyProgressInput,
  type HabitWeeklyProgressInput,
  type UpdateHabitInput
} from "../../shared/habit-contracts";

type UnknownRecord = Record<string, unknown>;

const success = <T>(data: T): HabitOperationResult<T> => ({ ok: true, data });
const failure = <T>(code: string): HabitOperationResult<T> => ({ ok: false, error: { code, userMessage: "" } });
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const hasOwn = (value: UnknownRecord, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

const validateObject = (input: unknown, allowed: readonly string[]): HabitOperationResult<UnknownRecord> => {
  if (!isRecord(input)) return failure(HABIT_ERROR_CODES.inputInvalid);
  if (Object.keys(input).some((key) => !allowed.includes(key))) return failure(HABIT_ERROR_CODES.unknownField);
  return success(input);
};

const validateRequiredText = (value: unknown, maximum: number): HabitOperationResult<string> => {
  if (typeof value !== "string") return failure(HABIT_ERROR_CODES.requiredFieldMissing);
  const normalized = value.trim();
  if (!normalized) return failure(HABIT_ERROR_CODES.textInvalid);
  if (normalized.length > maximum) return failure(HABIT_ERROR_CODES.textTooLong);
  return success(normalized);
};

const validateOptionalText = (value: UnknownRecord, key: string, maximum: number, nullable = false): HabitOperationResult<string | null | undefined> => {
  if (!hasOwn(value, key)) return success(undefined);
  if (value[key] === null && nullable) return success(null);
  if (typeof value[key] !== "string") return failure(HABIT_ERROR_CODES.fieldTypeInvalid);
  const normalized = value[key].trim();
  if (!normalized) return failure(HABIT_ERROR_CODES.textInvalid);
  if (normalized.length > maximum) return failure(HABIT_ERROR_CODES.textTooLong);
  return success(normalized);
};

const validateOptionalUuid = (value: UnknownRecord, key: string, nullable = false): HabitOperationResult<string | null | undefined> => {
  if (!hasOwn(value, key)) return success(undefined);
  if (value[key] === null && nullable) return success(null);
  return isUuid(value[key]) ? success(value[key]) : failure(HABIT_ERROR_CODES.identifierInvalid);
};

const validateFrequency = (value: unknown): HabitOperationResult<HabitFrequency> =>
  typeof value === "string" && HABIT_FREQUENCIES.includes(value as HabitFrequency)
    ? success(value as HabitFrequency)
    : failure(HABIT_ERROR_CODES.enumInvalid);

const validateIcon = (value: unknown): HabitOperationResult<HabitIcon> =>
  typeof value === "string" && HABIT_ICON_KEYS.includes(value as HabitIcon)
    ? success(value as HabitIcon)
    : failure(HABIT_ERROR_CODES.iconInvalid);

const validateTargetCount = (value: unknown): HabitOperationResult<number> =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7
    ? success(value)
    : failure(HABIT_ERROR_CODES.targetCountInvalid);

export const isFrequencyTargetConsistent = (frequency: HabitFrequency, targetCount: number): boolean =>
  (frequency === "DAILY" && targetCount === 1) || (frequency === "WEEKLY" && targetCount >= 1 && targetCount <= 7);

export const isIsoCalendarDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validateDate = (value: unknown): HabitOperationResult<string> =>
  isIsoCalendarDate(value) ? success(value) : failure(HABIT_ERROR_CODES.dateInvalid);

export const validateCreateHabitInput = (input: unknown): HabitOperationResult<CreateHabitInput> => {
  const object = validateObject(input, ["title", "description", "categoryId", "icon", "frequency", "targetCount"]);
  if (!object.ok) return object;
  const title = validateRequiredText(object.data.title, 240);
  const description = validateOptionalText(object.data, "description", 4000);
  const categoryId = validateOptionalUuid(object.data, "categoryId");
  const icon = hasOwn(object.data, "icon") ? validateIcon(object.data.icon) : success<HabitIcon>(DEFAULT_HABIT_ICON);
  const frequency = validateFrequency(object.data.frequency);
  const targetCount = validateTargetCount(object.data.targetCount);
  if (!title.ok) return title; if (!description.ok) return description; if (!categoryId.ok) return categoryId; if (!icon.ok) return icon; if (!frequency.ok) return frequency; if (!targetCount.ok) return targetCount;
  if (!isFrequencyTargetConsistent(frequency.data, targetCount.data)) return failure(HABIT_ERROR_CODES.targetCountInvalid);
  return success({ title: title.data, icon: icon.data, frequency: frequency.data, targetCount: targetCount.data, ...(typeof description.data === "string" ? { description: description.data } : {}), ...(typeof categoryId.data === "string" ? { categoryId: categoryId.data } : {}) });
};

export const validateUpdateHabitInput = (input: unknown): HabitOperationResult<UpdateHabitInput> => {
  const object = validateObject(input, ["habitId", "title", "description", "categoryId", "icon", "frequency", "targetCount", "active"]);
  if (!object.ok) return object;
  if (!Object.keys(object.data).some((key) => key !== "habitId")) return failure(HABIT_ERROR_CODES.updateEmpty);
  if (!isUuid(object.data.habitId)) return failure(HABIT_ERROR_CODES.identifierInvalid);
  const title = hasOwn(object.data, "title") ? validateRequiredText(object.data.title, 240) : success<string | undefined>(undefined);
  const description = validateOptionalText(object.data, "description", 4000, true);
  const categoryId = validateOptionalUuid(object.data, "categoryId", true);
  const icon = hasOwn(object.data, "icon") ? validateIcon(object.data.icon) : success<HabitIcon | undefined>(undefined);
  const frequency = hasOwn(object.data, "frequency") ? validateFrequency(object.data.frequency) : success<HabitFrequency | undefined>(undefined);
  const targetCount = hasOwn(object.data, "targetCount") ? validateTargetCount(object.data.targetCount) : success<number | undefined>(undefined);
  const active = hasOwn(object.data, "active") ? typeof object.data.active === "boolean" ? success(object.data.active) : failure<boolean>(HABIT_ERROR_CODES.fieldTypeInvalid) : success<boolean | undefined>(undefined);
  if (!title.ok) return title; if (!description.ok) return description; if (!categoryId.ok) return categoryId; if (!icon.ok) return icon; if (!frequency.ok) return frequency; if (!targetCount.ok) return targetCount; if (!active.ok) return active;
  return success({ habitId: object.data.habitId, ...(title.data === undefined ? {} : { title: title.data }), ...(description.data === undefined ? {} : { description: description.data }), ...(categoryId.data === undefined ? {} : { categoryId: categoryId.data }), ...(icon.data === undefined ? {} : { icon: icon.data }), ...(frequency.data === undefined ? {} : { frequency: frequency.data }), ...(targetCount.data === undefined ? {} : { targetCount: targetCount.data }), ...(active.data === undefined ? {} : { active: active.data }) });
};

export const validateHabitListInput = (input: unknown): HabitOperationResult<HabitListInput> => {
  const object = validateObject(input, ["includeInactive"]);
  if (!object.ok) return object;
  if (!hasOwn(object.data, "includeInactive")) return success({});
  return typeof object.data.includeInactive === "boolean" ? success({ includeInactive: object.data.includeInactive }) : failure(HABIT_ERROR_CODES.fieldTypeInvalid);
};

export const validateCompleteHabitInput = (input: unknown): HabitOperationResult<CompleteHabitInput> => {
  const object = validateObject(input, ["habitId", "completedOn"]);
  if (!object.ok) return object;
  if (!isUuid(object.data.habitId)) return failure(HABIT_ERROR_CODES.identifierInvalid);
  const completedOn = validateDate(object.data.completedOn);
  return completedOn.ok ? success({ habitId: object.data.habitId, completedOn: completedOn.data }) : completedOn;
};

export const validateHabitDailyProgressInput = (input: unknown): HabitOperationResult<HabitDailyProgressInput> => {
  const object = validateObject(input, ["date"]);
  if (!object.ok) return object;
  const date = validateDate(object.data.date);
  return date.ok ? success({ date: date.data }) : date;
};

export const validateHabitWeeklyProgressInput = (input: unknown): HabitOperationResult<HabitWeeklyProgressInput> => {
  const object = validateObject(input, ["weekStart"]);
  if (!object.ok) return object;
  const weekStart = validateDate(object.data.weekStart);
  if (!weekStart.ok) return weekStart;
  return new Date(`${weekStart.data}T00:00:00.000Z`).getUTCDay() === 1
    ? success({ weekStart: weekStart.data })
    : failure(HABIT_ERROR_CODES.dateInvalid);
};
