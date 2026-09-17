import {
  PLANNER_ERROR_CODES,
  REMINDER_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CategoryListInput,
  type CompleteTaskInput,
  type CreateCategoryInput,
  type CreateEventInput,
  type CreateReminderInput,
  type CreateTaskInput,
  type EventListInput,
  type GetTodayScheduleInput,
  type GetWeekScheduleInput,
  type PlannerErrorCode,
  type PlannerOperationResult,
  type ReminderListInput,
  type ReminderStatus,
  type TaskListInput,
  type TaskPriority,
  type TaskStatus,
  type UpdateCategoryInput,
  type UpdateEventInput,
  type UpdateTaskInput
} from "../../shared/planner-contracts";

type InputObject = Record<string, unknown>;

const validationMessages: Record<PlannerErrorCode, string> = {
  PLANNER_INPUT_INVALID: "La información del planificador no es válida.",
  PLANNER_UNKNOWN_FIELD: "La solicitud contiene campos no permitidos.",
  PLANNER_REQUIRED_FIELD_MISSING: "Faltan datos requeridos del planificador.",
  PLANNER_FIELD_TYPE_INVALID: "Uno de los campos del planificador tiene un formato no válido.",
  PLANNER_TEXT_INVALID: "Uno de los textos requeridos no es válido.",
  PLANNER_TEXT_TOO_LONG: "Uno de los textos supera la longitud permitida.",
  PLANNER_IDENTIFIER_INVALID: "Uno de los identificadores no es válido.",
  PLANNER_COLOR_INVALID: "El color de la categoría no es válido.",
  PLANNER_ENUM_INVALID: "Uno de los valores seleccionados no es válido.",
  PLANNER_DATE_INVALID: "La fecha no es válida.",
  PLANNER_TIME_INVALID: "La hora no es válida.",
  PLANNER_DATE_TIME_INVALID: "La fecha y hora no son válidas.",
  PLANNER_TASK_DUE_TIME_REQUIRES_DATE: "La hora límite requiere una fecha límite.",
  PLANNER_TASK_COMPLETION_STATE_INVALID: "El estado de finalización de la tarea no es válido.",
  PLANNER_EVENT_TIME_RANGE_INVALID: "La hora de finalización debe ser posterior al inicio.",
  PLANNER_REMINDER_ASSOCIATION_INVALID: "El recordatorio no puede asociarse a una tarea y un evento al mismo tiempo.",
  PLANNER_REMINDER_DELIVERY_STATE_INVALID: "El estado de entrega del recordatorio no es válido.",
  PLANNER_UPDATE_EMPTY: "Debes indicar al menos un cambio para actualizar.",
  PLANNER_NOT_FOUND: "No se encontró el elemento solicitado.",
  PLANNER_REFERENCE_NOT_FOUND: "No se encontró una referencia relacionada del planificador.",
  PLANNER_CONFLICT: "Ya existe un elemento con esos datos.",
  PLANNER_DATABASE_UNAVAILABLE: "No se pudo acceder a los datos del planificador.",
  PLANNER_TASK_ALREADY_COMPLETED: "La tarea ya está completada.",
  PLANNER_IPC_UNAVAILABLE: "No se pudo procesar la solicitud del planificador."
};

const createFailure = <T>(code: PlannerErrorCode): PlannerOperationResult<T> => ({
  ok: false,
  error: {
    code,
    userMessage: validationMessages[code]
  }
});

const createSuccess = <T>(data: T): PlannerOperationResult<T> => ({ ok: true, data });

const stringValue = (value: string | null | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const hasOwn = (input: InputObject, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(input, key);

const validateObject = (
  input: unknown,
  allowedKeys: readonly string[]
): PlannerOperationResult<InputObject> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return createFailure(PLANNER_ERROR_CODES.inputInvalid);
  }

  const record = input as InputObject;
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    return createFailure(PLANNER_ERROR_CODES.unknownField);
  }

  return createSuccess(record);
};

const validateRequiredText = (
  input: InputObject,
  key: string,
  maximumLength: number
): PlannerOperationResult<string> => {
  const value = input[key];
  if (typeof value !== "string") {
    return createFailure(PLANNER_ERROR_CODES.requiredFieldMissing);
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return createFailure(PLANNER_ERROR_CODES.textInvalid);
  }
  if (normalizedValue.length > maximumLength) {
    return createFailure(PLANNER_ERROR_CODES.textTooLong);
  }

  return createSuccess(normalizedValue);
};

const validateOptionalText = (
  input: InputObject,
  key: string,
  maximumLength: number,
  allowNull = false
): PlannerOperationResult<string | null | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }

  const value = input[key];
  if (value === null && allowNull) {
    return createSuccess(null);
  }
  if (typeof value !== "string") {
    return createFailure(PLANNER_ERROR_CODES.fieldTypeInvalid);
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length > maximumLength) {
    return createFailure(PLANNER_ERROR_CODES.textTooLong);
  }

  return createSuccess(normalizedValue);
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const dateTimePattern = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const colorPattern = /^#[0-9A-Fa-f]{6}$/;

const isValidCalendarDate = (value: string): boolean => {
  const match = datePattern.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
};

const validateUuid = (value: unknown): PlannerOperationResult<string> => {
  if (typeof value !== "string" || !uuidPattern.test(value.trim())) {
    return createFailure(PLANNER_ERROR_CODES.identifierInvalid);
  }

  return createSuccess(value.trim());
};

const validateOptionalUuid = (
  input: InputObject,
  key: string,
  allowNull = false
): PlannerOperationResult<string | null | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }
  if (input[key] === null && allowNull) {
    return createSuccess(null);
  }
  return validateUuid(input[key]);
};

const validateCalendarDate = (value: unknown): PlannerOperationResult<string> => {
  if (typeof value !== "string" || !isValidCalendarDate(value)) {
    return createFailure(PLANNER_ERROR_CODES.dateInvalid);
  }

  return createSuccess(value);
};

const validateOptionalCalendarDate = (
  input: InputObject,
  key: string,
  allowNull = false
): PlannerOperationResult<string | null | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }
  if (input[key] === null && allowNull) {
    return createSuccess(null);
  }
  return validateCalendarDate(input[key]);
};

const validateLocalTime = (value: unknown): PlannerOperationResult<string> => {
  if (typeof value !== "string" || !timePattern.test(value)) {
    return createFailure(PLANNER_ERROR_CODES.timeInvalid);
  }

  return createSuccess(value);
};

const validateOptionalLocalTime = (
  input: InputObject,
  key: string,
  allowNull = false
): PlannerOperationResult<string | null | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }
  if (input[key] === null && allowNull) {
    return createSuccess(null);
  }
  return validateLocalTime(input[key]);
};

const validateDateTime = (value: unknown): PlannerOperationResult<string> => {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    !isValidCalendarDate(value.slice(0, 10)) ||
    Number.isNaN(Date.parse(value))
  ) {
    return createFailure(PLANNER_ERROR_CODES.dateTimeInvalid);
  }

  return createSuccess(value);
};

const validateOptionalDateTime = (
  input: InputObject,
  key: string,
  allowNull = false
): PlannerOperationResult<string | null | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }
  if (input[key] === null && allowNull) {
    return createSuccess(null);
  }
  return validateDateTime(input[key]);
};

const validateEnum = <T extends string>(
  value: unknown,
  values: readonly T[]
): PlannerOperationResult<T> => {
  if (typeof value !== "string" || !values.includes(value as T)) {
    return createFailure(PLANNER_ERROR_CODES.enumInvalid);
  }

  return createSuccess(value as T);
};

const validateOptionalEnum = <T extends string>(
  input: InputObject,
  key: string,
  values: readonly T[]
): PlannerOperationResult<T | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }
  return validateEnum(input[key], values);
};

const validateOptionalBoolean = (
  input: InputObject,
  key: string
): PlannerOperationResult<boolean | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }
  if (typeof input[key] !== "boolean") {
    return createFailure(PLANNER_ERROR_CODES.fieldTypeInvalid);
  }
  return createSuccess(input[key]);
};

const validateStatusList = <T extends string>(
  input: InputObject,
  key: string,
  values: readonly T[]
): PlannerOperationResult<T[] | undefined> => {
  if (!hasOwn(input, key)) {
    return createSuccess(undefined);
  }
  const inputValues = input[key];
  if (!Array.isArray(inputValues) || inputValues.length === 0) {
    return createFailure(PLANNER_ERROR_CODES.fieldTypeInvalid);
  }

  const validatedValues: T[] = [];
  for (const value of inputValues) {
    const result = validateEnum(value, values);
    if (!result.ok) {
      return result;
    }
    validatedValues.push(result.data);
  }

  return createSuccess(validatedValues);
};

const validateOptionalColor = (
  input: InputObject,
  allowNull = false
): PlannerOperationResult<string | null | undefined> => {
  if (!hasOwn(input, "color")) {
    return createSuccess(undefined);
  }
  if (input.color === null && allowNull) {
    return createSuccess(null);
  }
  if (typeof input.color !== "string" || !colorPattern.test(input.color.trim())) {
    return createFailure(PLANNER_ERROR_CODES.colorInvalid);
  }
  return createSuccess(input.color.trim());
};

const validateTimeRange = (
  startAt: string | undefined,
  endAt: string | null | undefined
): PlannerOperationResult<void> => {
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) {
    return createFailure(PLANNER_ERROR_CODES.eventTimeRangeInvalid);
  }
  return createSuccess(undefined);
};

const validateNoEmptyUpdate = (input: InputObject, identifierKey: string): PlannerOperationResult<void> =>
  Object.keys(input).some((key) => key !== identifierKey)
    ? createSuccess(undefined)
    : createFailure(PLANNER_ERROR_CODES.updateEmpty);

export const validateCreateCategoryInput = (
  input: unknown
): PlannerOperationResult<CreateCategoryInput> => {
  const objectResult = validateObject(input, ["name", "color", "icon"]);
  if (!objectResult.ok) return objectResult;

  const name = validateRequiredText(objectResult.data, "name", 120);
  if (!name.ok) return name;
  const color = validateOptionalColor(objectResult.data);
  if (!color.ok) return color;
  const icon = validateOptionalText(objectResult.data, "icon", 64);
  if (!icon.ok) return icon;

  return createSuccess({
    name: name.data,
    ...(stringValue(color.data) === undefined ? {} : { color: stringValue(color.data) }),
    ...(stringValue(icon.data) === undefined ? {} : { icon: stringValue(icon.data) })
  });
};

export const validateUpdateCategoryInput = (
  input: unknown
): PlannerOperationResult<UpdateCategoryInput> => {
  const objectResult = validateObject(input, ["categoryId", "name", "color", "icon"]);
  if (!objectResult.ok) return objectResult;
  const update = validateNoEmptyUpdate(objectResult.data, "categoryId");
  if (!update.ok) return update;
  const categoryId = validateUuid(objectResult.data.categoryId);
  if (!categoryId.ok) return categoryId;
  const name = hasOwn(objectResult.data, "name")
    ? validateRequiredText(objectResult.data, "name", 120)
    : createSuccess<string | undefined>(undefined);
  if (!name.ok) return name;
  const color = validateOptionalColor(objectResult.data, true);
  if (!color.ok) return color;
  const icon = validateOptionalText(objectResult.data, "icon", 64, true);
  if (!icon.ok) return icon;

  return createSuccess({
    categoryId: categoryId.data,
    ...(name.data === undefined ? {} : { name: name.data }),
    ...(color.data === undefined ? {} : { color: color.data }),
    ...(icon.data === undefined ? {} : { icon: icon.data })
  });
};

export const validateCategoryListInput = (
  input: unknown
): PlannerOperationResult<CategoryListInput> => {
  const objectResult = validateObject(input, []);
  return objectResult.ok ? createSuccess({}) : objectResult;
};

export const validateCreateTaskInput = (
  input: unknown
): PlannerOperationResult<CreateTaskInput> => {
  const objectResult = validateObject(input, [
    "title",
    "description",
    "dueDate",
    "dueTime",
    "priority",
    "status",
    "categoryId",
    "completedAt"
  ]);
  if (!objectResult.ok) return objectResult;
  const title = validateRequiredText(objectResult.data, "title", 240);
  if (!title.ok) return title;
  const description = validateOptionalText(objectResult.data, "description", 4000);
  if (!description.ok) return description;
  const dueDate = validateOptionalCalendarDate(objectResult.data, "dueDate");
  if (!dueDate.ok) return dueDate;
  const dueTime = validateOptionalLocalTime(objectResult.data, "dueTime");
  if (!dueTime.ok) return dueTime;
  if (dueTime.data !== undefined && dueDate.data === undefined) {
    return createFailure(PLANNER_ERROR_CODES.taskDueTimeRequiresDate);
  }
  const priority = validateOptionalEnum(objectResult.data, "priority", TASK_PRIORITIES);
  if (!priority.ok) return priority;
  const status = validateOptionalEnum(objectResult.data, "status", TASK_STATUSES);
  if (!status.ok) return status;
  const categoryId = validateOptionalUuid(objectResult.data, "categoryId");
  if (!categoryId.ok) return categoryId;
  const completedAt = validateOptionalDateTime(objectResult.data, "completedAt");
  if (!completedAt.ok) return completedAt;
  const normalizedStatus = status.data ?? "PENDING";
  if (
    (normalizedStatus === "COMPLETED" && completedAt.data === undefined) ||
    (normalizedStatus !== "COMPLETED" && completedAt.data !== undefined)
  ) {
    return createFailure(PLANNER_ERROR_CODES.taskCompletionStateInvalid);
  }

  return createSuccess({
    title: title.data,
    ...(stringValue(description.data) === undefined
      ? {}
      : { description: stringValue(description.data) }),
    ...(stringValue(dueDate.data) === undefined ? {} : { dueDate: stringValue(dueDate.data) }),
    ...(stringValue(dueTime.data) === undefined ? {} : { dueTime: stringValue(dueTime.data) }),
    ...(priority.data === undefined ? {} : { priority: priority.data }),
    ...(status.data === undefined ? {} : { status: status.data }),
    ...(stringValue(categoryId.data) === undefined
      ? {}
      : { categoryId: stringValue(categoryId.data) }),
    ...(stringValue(completedAt.data) === undefined
      ? {}
      : { completedAt: stringValue(completedAt.data) })
  });
};

export const validateUpdateTaskInput = (
  input: unknown
): PlannerOperationResult<UpdateTaskInput> => {
  const objectResult = validateObject(input, [
    "taskId",
    "title",
    "description",
    "dueDate",
    "dueTime",
    "priority",
    "status",
    "categoryId",
    "completedAt"
  ]);
  if (!objectResult.ok) return objectResult;
  const update = validateNoEmptyUpdate(objectResult.data, "taskId");
  if (!update.ok) return update;
  const taskId = validateUuid(objectResult.data.taskId);
  if (!taskId.ok) return taskId;
  const title = hasOwn(objectResult.data, "title")
    ? validateRequiredText(objectResult.data, "title", 240)
    : createSuccess<string | undefined>(undefined);
  if (!title.ok) return title;
  const description = validateOptionalText(objectResult.data, "description", 4000, true);
  if (!description.ok) return description;
  const dueDate = validateOptionalCalendarDate(objectResult.data, "dueDate", true);
  if (!dueDate.ok) return dueDate;
  const dueTime = validateOptionalLocalTime(objectResult.data, "dueTime", true);
  if (!dueTime.ok) return dueTime;
  if (dueDate.data === null && dueTime.data !== undefined && dueTime.data !== null) {
    return createFailure(PLANNER_ERROR_CODES.taskDueTimeRequiresDate);
  }
  const priority = validateOptionalEnum(objectResult.data, "priority", TASK_PRIORITIES);
  if (!priority.ok) return priority;
  const status = validateOptionalEnum(objectResult.data, "status", TASK_STATUSES);
  if (!status.ok) return status;
  const categoryId = validateOptionalUuid(objectResult.data, "categoryId", true);
  if (!categoryId.ok) return categoryId;
  const completedAt = validateOptionalDateTime(objectResult.data, "completedAt", true);
  if (!completedAt.ok) return completedAt;
  const hasStatus = hasOwn(objectResult.data, "status");
  const hasCompletedAt = hasOwn(objectResult.data, "completedAt");
  if (hasStatus !== hasCompletedAt) {
    return createFailure(PLANNER_ERROR_CODES.taskCompletionStateInvalid);
  }
  if (
    hasStatus &&
    ((status.data === "COMPLETED" && completedAt.data === null) ||
      (status.data !== "COMPLETED" && completedAt.data !== null))
  ) {
    return createFailure(PLANNER_ERROR_CODES.taskCompletionStateInvalid);
  }

  return createSuccess({
    taskId: taskId.data,
    ...(title.data === undefined ? {} : { title: title.data }),
    ...(description.data === undefined ? {} : { description: description.data }),
    ...(dueDate.data === undefined ? {} : { dueDate: dueDate.data }),
    ...(dueTime.data === undefined ? {} : { dueTime: dueTime.data }),
    ...(priority.data === undefined ? {} : { priority: priority.data }),
    ...(status.data === undefined ? {} : { status: status.data }),
    ...(categoryId.data === undefined ? {} : { categoryId: categoryId.data }),
    ...(completedAt.data === undefined ? {} : { completedAt: completedAt.data })
  });
};

export const validateCompleteTaskInput = (
  input: unknown
): PlannerOperationResult<CompleteTaskInput> => {
  const objectResult = validateObject(input, ["taskId", "completedAt"]);
  if (!objectResult.ok) return objectResult;
  const taskId = validateUuid(objectResult.data.taskId);
  if (!taskId.ok) return taskId;
  const completedAt = validateDateTime(objectResult.data.completedAt);
  if (!completedAt.ok) return completedAt;
  return createSuccess({ taskId: taskId.data, completedAt: completedAt.data });
};

export const validateTaskListInput = (
  input: unknown
): PlannerOperationResult<TaskListInput> => {
  const objectResult = validateObject(input, [
    "statuses",
    "categoryId",
    "dueDateFrom",
    "dueDateTo",
    "includeCompleted"
  ]);
  if (!objectResult.ok) return objectResult;
  const statuses = validateStatusList(objectResult.data, "statuses", TASK_STATUSES);
  if (!statuses.ok) return statuses;
  const categoryId = validateOptionalUuid(objectResult.data, "categoryId");
  if (!categoryId.ok) return categoryId;
  const dueDateFrom = validateOptionalCalendarDate(objectResult.data, "dueDateFrom");
  if (!dueDateFrom.ok) return dueDateFrom;
  const dueDateTo = validateOptionalCalendarDate(objectResult.data, "dueDateTo");
  if (!dueDateTo.ok) return dueDateTo;
  if (dueDateFrom.data && dueDateTo.data && dueDateFrom.data > dueDateTo.data) {
    return createFailure(PLANNER_ERROR_CODES.dateInvalid);
  }
  const includeCompleted = validateOptionalBoolean(objectResult.data, "includeCompleted");
  if (!includeCompleted.ok) return includeCompleted;

  return createSuccess({
    ...(statuses.data === undefined ? {} : { statuses: statuses.data }),
    ...(stringValue(categoryId.data) === undefined
      ? {}
      : { categoryId: stringValue(categoryId.data) }),
    ...(stringValue(dueDateFrom.data) === undefined
      ? {}
      : { dueDateFrom: stringValue(dueDateFrom.data) }),
    ...(stringValue(dueDateTo.data) === undefined
      ? {}
      : { dueDateTo: stringValue(dueDateTo.data) }),
    ...(includeCompleted.data === undefined ? {} : { includeCompleted: includeCompleted.data })
  });
};

export const validateCreateEventInput = (
  input: unknown
): PlannerOperationResult<CreateEventInput> => {
  const objectResult = validateObject(input, [
    "title",
    "description",
    "startAt",
    "endAt",
    "categoryId",
    "location"
  ]);
  if (!objectResult.ok) return objectResult;
  const title = validateRequiredText(objectResult.data, "title", 240);
  if (!title.ok) return title;
  const description = validateOptionalText(objectResult.data, "description", 4000);
  if (!description.ok) return description;
  const startAt = validateDateTime(objectResult.data.startAt);
  if (!startAt.ok) return startAt;
  const endAt = validateOptionalDateTime(objectResult.data, "endAt");
  if (!endAt.ok) return endAt;
  const timeRange = validateTimeRange(startAt.data, endAt.data);
  if (!timeRange.ok) return timeRange;
  const categoryId = validateOptionalUuid(objectResult.data, "categoryId");
  if (!categoryId.ok) return categoryId;
  const location = validateOptionalText(objectResult.data, "location", 500);
  if (!location.ok) return location;

  return createSuccess({
    title: title.data,
    startAt: startAt.data,
    ...(stringValue(description.data) === undefined
      ? {}
      : { description: stringValue(description.data) }),
    ...(stringValue(endAt.data) === undefined ? {} : { endAt: stringValue(endAt.data) }),
    ...(stringValue(categoryId.data) === undefined
      ? {}
      : { categoryId: stringValue(categoryId.data) }),
    ...(stringValue(location.data) === undefined ? {} : { location: stringValue(location.data) })
  });
};

export const validateUpdateEventInput = (
  input: unknown
): PlannerOperationResult<UpdateEventInput> => {
  const objectResult = validateObject(input, [
    "eventId",
    "title",
    "description",
    "startAt",
    "endAt",
    "categoryId",
    "location"
  ]);
  if (!objectResult.ok) return objectResult;
  const update = validateNoEmptyUpdate(objectResult.data, "eventId");
  if (!update.ok) return update;
  const eventId = validateUuid(objectResult.data.eventId);
  if (!eventId.ok) return eventId;
  const title = hasOwn(objectResult.data, "title")
    ? validateRequiredText(objectResult.data, "title", 240)
    : createSuccess<string | undefined>(undefined);
  if (!title.ok) return title;
  const description = validateOptionalText(objectResult.data, "description", 4000, true);
  if (!description.ok) return description;
  const startAt = validateOptionalDateTime(objectResult.data, "startAt");
  if (!startAt.ok) return startAt;
  const endAt = validateOptionalDateTime(objectResult.data, "endAt", true);
  if (!endAt.ok) return endAt;
  const timeRange = validateTimeRange(stringValue(startAt.data), endAt.data);
  if (!timeRange.ok) return timeRange;
  const categoryId = validateOptionalUuid(objectResult.data, "categoryId", true);
  if (!categoryId.ok) return categoryId;
  const location = validateOptionalText(objectResult.data, "location", 500, true);
  if (!location.ok) return location;

  return createSuccess({
    eventId: eventId.data,
    ...(title.data === undefined ? {} : { title: title.data }),
    ...(description.data === undefined ? {} : { description: description.data }),
    ...(stringValue(startAt.data) === undefined
      ? {}
      : { startAt: stringValue(startAt.data) }),
    ...(endAt.data === undefined ? {} : { endAt: endAt.data }),
    ...(categoryId.data === undefined ? {} : { categoryId: categoryId.data }),
    ...(location.data === undefined ? {} : { location: location.data })
  });
};

export const validateEventListInput = (
  input: unknown
): PlannerOperationResult<EventListInput> => {
  const objectResult = validateObject(input, ["categoryId", "startAt", "endAt"]);
  if (!objectResult.ok) return objectResult;
  const categoryId = validateOptionalUuid(objectResult.data, "categoryId");
  if (!categoryId.ok) return categoryId;
  const startAt = validateOptionalDateTime(objectResult.data, "startAt");
  if (!startAt.ok) return startAt;
  const endAt = validateOptionalDateTime(objectResult.data, "endAt");
  if (!endAt.ok) return endAt;
  const timeRange = validateTimeRange(stringValue(startAt.data), endAt.data);
  if (!timeRange.ok) return timeRange;
  return createSuccess({
    ...(stringValue(categoryId.data) === undefined
      ? {}
      : { categoryId: stringValue(categoryId.data) }),
    ...(stringValue(startAt.data) === undefined
      ? {}
      : { startAt: stringValue(startAt.data) }),
    ...(stringValue(endAt.data) === undefined ? {} : { endAt: stringValue(endAt.data) })
  });
};

export const validateCreateReminderInput = (
  input: unknown
): PlannerOperationResult<CreateReminderInput> => {
  const objectResult = validateObject(input, [
    "title",
    "remindAt",
    "taskId",
    "eventId",
    "status",
    "deliveredAt"
  ]);
  if (!objectResult.ok) return objectResult;
  const title = validateRequiredText(objectResult.data, "title", 240);
  if (!title.ok) return title;
  const remindAt = validateDateTime(objectResult.data.remindAt);
  if (!remindAt.ok) return remindAt;
  const taskId = validateOptionalUuid(objectResult.data, "taskId");
  if (!taskId.ok) return taskId;
  const eventId = validateOptionalUuid(objectResult.data, "eventId");
  if (!eventId.ok) return eventId;
  if (taskId.data !== undefined && eventId.data !== undefined) {
    return createFailure(PLANNER_ERROR_CODES.reminderAssociationInvalid);
  }
  const status = validateOptionalEnum(objectResult.data, "status", REMINDER_STATUSES);
  if (!status.ok) return status;
  const deliveredAt = validateOptionalDateTime(objectResult.data, "deliveredAt");
  if (!deliveredAt.ok) return deliveredAt;
  const normalizedStatus = status.data ?? "PENDING";
  if (
    (normalizedStatus === "TRIGGERED" && deliveredAt.data === undefined) ||
    (normalizedStatus !== "TRIGGERED" && deliveredAt.data !== undefined)
  ) {
    return createFailure(PLANNER_ERROR_CODES.reminderDeliveryStateInvalid);
  }

  return createSuccess({
    title: title.data,
    remindAt: remindAt.data,
    ...(stringValue(taskId.data) === undefined ? {} : { taskId: stringValue(taskId.data) }),
    ...(stringValue(eventId.data) === undefined ? {} : { eventId: stringValue(eventId.data) }),
    ...(status.data === undefined ? {} : { status: status.data }),
    ...(stringValue(deliveredAt.data) === undefined
      ? {}
      : { deliveredAt: stringValue(deliveredAt.data) })
  });
};

export const validateReminderListInput = (
  input: unknown
): PlannerOperationResult<ReminderListInput> => {
  const objectResult = validateObject(input, [
    "statuses",
    "taskId",
    "eventId",
    "remindAtFrom",
    "remindAtTo"
  ]);
  if (!objectResult.ok) return objectResult;
  const statuses = validateStatusList(objectResult.data, "statuses", REMINDER_STATUSES);
  if (!statuses.ok) return statuses;
  const taskId = validateOptionalUuid(objectResult.data, "taskId");
  if (!taskId.ok) return taskId;
  const eventId = validateOptionalUuid(objectResult.data, "eventId");
  if (!eventId.ok) return eventId;
  if (taskId.data !== undefined && eventId.data !== undefined) {
    return createFailure(PLANNER_ERROR_CODES.reminderAssociationInvalid);
  }
  const remindAtFrom = validateOptionalDateTime(objectResult.data, "remindAtFrom");
  if (!remindAtFrom.ok) return remindAtFrom;
  const remindAtTo = validateOptionalDateTime(objectResult.data, "remindAtTo");
  if (!remindAtTo.ok) return remindAtTo;
  const timeRange = validateTimeRange(
    stringValue(remindAtFrom.data),
    stringValue(remindAtTo.data)
  );
  if (!timeRange.ok) return timeRange;
  return createSuccess({
    ...(statuses.data === undefined ? {} : { statuses: statuses.data }),
    ...(stringValue(taskId.data) === undefined ? {} : { taskId: stringValue(taskId.data) }),
    ...(stringValue(eventId.data) === undefined ? {} : { eventId: stringValue(eventId.data) }),
    ...(stringValue(remindAtFrom.data) === undefined
      ? {}
      : { remindAtFrom: stringValue(remindAtFrom.data) }),
    ...(stringValue(remindAtTo.data) === undefined
      ? {}
      : { remindAtTo: stringValue(remindAtTo.data) })
  });
};

export const validateGetTodayScheduleInput = (
  input: unknown
): PlannerOperationResult<GetTodayScheduleInput> => {
  const objectResult = validateObject(input, ["includeCompletedTasks"]);
  if (!objectResult.ok) return objectResult;
  const includeCompletedTasks = validateOptionalBoolean(
    objectResult.data,
    "includeCompletedTasks"
  );
  if (!includeCompletedTasks.ok) return includeCompletedTasks;
  return createSuccess(
    includeCompletedTasks.data === undefined
      ? {}
      : { includeCompletedTasks: includeCompletedTasks.data }
  );
};

export const validateGetWeekScheduleInput = (
  input: unknown
): PlannerOperationResult<GetWeekScheduleInput> => {
  const objectResult = validateObject(input, ["weekStart", "includeCompletedTasks"]);
  if (!objectResult.ok) return objectResult;
  const weekStart = validateOptionalCalendarDate(objectResult.data, "weekStart");
  if (!weekStart.ok) return weekStart;
  const includeCompletedTasks = validateOptionalBoolean(
    objectResult.data,
    "includeCompletedTasks"
  );
  if (!includeCompletedTasks.ok) return includeCompletedTasks;
  return createSuccess({
    ...(stringValue(weekStart.data) === undefined
      ? {}
      : { weekStart: stringValue(weekStart.data) }),
    ...(includeCompletedTasks.data === undefined
      ? {}
      : { includeCompletedTasks: includeCompletedTasks.data })
  });
};
