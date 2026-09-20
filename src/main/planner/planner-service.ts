import {
  PLANNER_ERROR_CODES,
  type CategoryListInput,
  type CategoryRecord,
  type CompleteTaskInput,
  type CreateCategoryInput,
  type CreateEventInput,
  type CreateReminderInput,
  type CreateTaskInput,
  type EventListInput,
  type EventRecord,
  type GetTodayScheduleInput,
  type GetWeekScheduleInput,
  type PlannerErrorCode,
  type PlannerListData,
  type PlannerMutationData,
  type PlannerOperationResult,
  type ReminderListInput,
  type ReminderRecord,
  type TaskListInput,
  type TaskRecord,
  type TodayScheduleData,
  type UpdateCategoryInput,
  type UpdateEventInput,
  type UpdateTaskInput,
  type WeekScheduleData
} from "../../shared/planner-contracts";
import {
  validateCategoryListInput,
  validateCompleteTaskInput,
  validateCreateCategoryInput,
  validateCreateEventInput,
  validateCreateReminderInput,
  validateCreateTaskInput,
  validateEventListInput,
  validateGetTodayScheduleInput,
  validateGetWeekScheduleInput,
  validateReminderListInput,
  validateTaskListInput,
  validateUpdateCategoryInput,
  validateUpdateEventInput,
  validateUpdateTaskInput
} from "./planner-validation";
import {
  createPlannerRepositories,
  PlannerRepositoryError,
  type PlannerRepositories
} from "./planner-repositories";

type ScheduleBounds = {
  startAt: string;
  endAt: string;
};

export type PlannerClock = {
  getLocalDate: () => string;
  getRangeBounds: (startDate: string, days: number) => ScheduleBounds;
};

export type PlannerService = {
  createCategory: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<CategoryRecord>>>;
  listCategories: (input: unknown) => Promise<PlannerOperationResult<PlannerListData<CategoryRecord>>>;
  updateCategory: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<CategoryRecord>>>;
  createTask: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<TaskRecord>>>;
  listTasks: (input: unknown) => Promise<PlannerOperationResult<PlannerListData<TaskRecord>>>;
  updateTask: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<TaskRecord>>>;
  completeTask: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<TaskRecord>>>;
  createEvent: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<EventRecord>>>;
  listEvents: (input: unknown) => Promise<PlannerOperationResult<PlannerListData<EventRecord>>>;
  updateEvent: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<EventRecord>>>;
  createReminder: (input: unknown) => Promise<PlannerOperationResult<PlannerMutationData<ReminderRecord>>>;
  listReminders: (input: unknown) => Promise<PlannerOperationResult<PlannerListData<ReminderRecord>>>;
  getTodaySchedule: (input: unknown) => Promise<PlannerOperationResult<TodayScheduleData>>;
  getWeekSchedule: (input: unknown) => Promise<PlannerOperationResult<WeekScheduleData>>;
};

type PlannerServiceDependencies = {
  repositories: PlannerRepositories;
  clock: PlannerClock;
  logError: (message: string) => void;
};

const serviceMessages: Record<PlannerErrorCode, string> = {
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
  error: { code, userMessage: serviceMessages[code] }
});

const createSuccess = <T>(data: T): PlannerOperationResult<T> => ({ ok: true, data });

const formatLocalDate = (date: Date): string =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");

const parseCalendarDate = (date: string): Date => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const addCalendarDays = (date: string, days: number): string => {
  const value = parseCalendarDate(date);
  value.setDate(value.getDate() + days);
  return formatLocalDate(value);
};

const getMonday = (date: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addCalendarDays(date, weekday === 0 ? -6 : 1 - weekday);
};

const isMonday = (date: string): boolean => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
};

export const createDefaultPlannerClock = (): PlannerClock => ({
  getLocalDate: () => formatLocalDate(new Date()),
  getRangeBounds: (startDate, days) => {
    const start = parseCalendarDate(startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    return { startAt: start.toISOString(), endAt: end.toISOString() };
  }
});

const defaultClock = createDefaultPlannerClock();

const toListData = <T>(items: T[]): PlannerListData<T> => ({ items, total: items.length });

const isValidTaskUpdate = (target: TaskRecord, update: UpdateTaskInput): boolean => {
  const dueDate = update.dueDate === undefined ? target.dueDate : update.dueDate;
  const dueTime = update.dueTime === undefined ? target.dueTime : update.dueTime;
  return dueTime === null || dueDate !== null;
};

const isValidEventUpdate = (target: EventRecord, update: UpdateEventInput): boolean => {
  const startAt = update.startAt ?? target.startAt;
  const endAt = update.endAt === undefined ? target.endAt : update.endAt;
  return endAt === null || new Date(endAt).getTime() > new Date(startAt).getTime();
};

export const createPlannerService = (
  overrides: Partial<PlannerServiceDependencies> = {}
): PlannerService => {
  const dependencies: PlannerServiceDependencies = {
    repositories: overrides.repositories ?? createPlannerRepositories(),
    clock: overrides.clock ?? defaultClock,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };

  const mapPersistenceFailure = <T>(error: unknown): PlannerOperationResult<T> => {
    if (error instanceof PlannerRepositoryError && error.kind === "CONFLICT") {
      return createFailure(PLANNER_ERROR_CODES.conflict);
    }
    if (error instanceof PlannerRepositoryError && error.kind === "REFERENCE_NOT_FOUND") {
      return createFailure(PLANNER_ERROR_CODES.referenceNotFound);
    }

    dependencies.logError("Planner persistence operation failed.");
    return createFailure(PLANNER_ERROR_CODES.databaseUnavailable);
  };

  const verifyCategoryReference = async <T>(categoryId: string | undefined): Promise<
    PlannerOperationResult<T> | undefined
  > => {
    if (!categoryId) {
      return undefined;
    }
    const category = await dependencies.repositories.findCategoryById(categoryId);
    return category ? undefined : createFailure(PLANNER_ERROR_CODES.referenceNotFound);
  };

  return {
    createCategory: async (input) => {
      const validation = validateCreateCategoryInput(input);
      if (!validation.ok) return validation;
      try {
        return createSuccess({ record: await dependencies.repositories.createCategory(validation.data) });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    listCategories: async (input) => {
      const validation = validateCategoryListInput(input);
      if (!validation.ok) return validation;
      try {
        return createSuccess(toListData(await dependencies.repositories.listCategories(validation.data)));
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    updateCategory: async (input) => {
      const validation = validateUpdateCategoryInput(input);
      if (!validation.ok) return validation;
      try {
        const record = await dependencies.repositories.updateCategory(validation.data);
        return record
          ? createSuccess({ record })
          : createFailure(PLANNER_ERROR_CODES.notFound);
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    createTask: async (input) => {
      const validation = validateCreateTaskInput(input);
      if (!validation.ok) return validation;
      try {
        const categoryFailure = await verifyCategoryReference<PlannerMutationData<TaskRecord>>(
          validation.data.categoryId
        );
        if (categoryFailure) return categoryFailure;
        return createSuccess({ record: await dependencies.repositories.createTask(validation.data) });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    listTasks: async (input) => {
      const validation = validateTaskListInput(input);
      if (!validation.ok) return validation;
      try {
        return createSuccess(toListData(await dependencies.repositories.listTasks(validation.data)));
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    updateTask: async (input) => {
      const validation = validateUpdateTaskInput(input);
      if (!validation.ok) return validation;
      try {
        const target = await dependencies.repositories.findTaskById(validation.data.taskId);
        if (!target) return createFailure(PLANNER_ERROR_CODES.notFound);
        if (!isValidTaskUpdate(target, validation.data)) {
          return createFailure(PLANNER_ERROR_CODES.taskDueTimeRequiresDate);
        }
        const categoryFailure = await verifyCategoryReference<PlannerMutationData<TaskRecord>>(
          validation.data.categoryId ?? undefined
        );
        if (categoryFailure) return categoryFailure;
        const record = await dependencies.repositories.updateTask(validation.data);
        return record
          ? createSuccess({ record })
          : createFailure(PLANNER_ERROR_CODES.notFound);
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    completeTask: async (input) => {
      const validation = validateCompleteTaskInput(input);
      if (!validation.ok) return validation;
      try {
        const task = await dependencies.repositories.findTaskById(validation.data.taskId);
        if (!task) return createFailure(PLANNER_ERROR_CODES.notFound);
        if (task.status === "COMPLETED") {
          return createFailure(PLANNER_ERROR_CODES.taskAlreadyCompleted);
        }
        const record = await dependencies.repositories.updateTaskCompletion(
          validation.data.taskId,
          "COMPLETED",
          validation.data.completedAt
        );
        return record
          ? createSuccess({ record })
          : createFailure(PLANNER_ERROR_CODES.notFound);
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    createEvent: async (input) => {
      const validation = validateCreateEventInput(input);
      if (!validation.ok) return validation;
      try {
        const categoryFailure = await verifyCategoryReference<PlannerMutationData<EventRecord>>(
          validation.data.categoryId
        );
        if (categoryFailure) return categoryFailure;
        return createSuccess({ record: await dependencies.repositories.createEvent(validation.data) });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    listEvents: async (input) => {
      const validation = validateEventListInput(input);
      if (!validation.ok) return validation;
      try {
        return createSuccess(toListData(await dependencies.repositories.listEvents(validation.data)));
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    updateEvent: async (input) => {
      const validation = validateUpdateEventInput(input);
      if (!validation.ok) return validation;
      try {
        const target = await dependencies.repositories.findEventById(validation.data.eventId);
        if (!target) return createFailure(PLANNER_ERROR_CODES.notFound);
        if (!isValidEventUpdate(target, validation.data)) {
          return createFailure(PLANNER_ERROR_CODES.eventTimeRangeInvalid);
        }
        const categoryFailure = await verifyCategoryReference<PlannerMutationData<EventRecord>>(
          validation.data.categoryId ?? undefined
        );
        if (categoryFailure) return categoryFailure;
        const record = await dependencies.repositories.updateEvent(validation.data);
        return record
          ? createSuccess({ record })
          : createFailure(PLANNER_ERROR_CODES.notFound);
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    createReminder: async (input) => {
      const validation = validateCreateReminderInput(input);
      if (!validation.ok) return validation;
      try {
        if (validation.data.taskId && !(await dependencies.repositories.findTaskById(validation.data.taskId))) {
          return createFailure(PLANNER_ERROR_CODES.referenceNotFound);
        }
        if (validation.data.eventId && !(await dependencies.repositories.findEventById(validation.data.eventId))) {
          return createFailure(PLANNER_ERROR_CODES.referenceNotFound);
        }
        return createSuccess({ record: await dependencies.repositories.createReminder(validation.data) });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    listReminders: async (input) => {
      const validation = validateReminderListInput(input);
      if (!validation.ok) return validation;
      try {
        return createSuccess(toListData(await dependencies.repositories.listReminders(validation.data)));
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    getTodaySchedule: async (input) => {
      const validation = validateGetTodayScheduleInput(input);
      if (!validation.ok) return validation;
      try {
        const localDate = dependencies.clock.getLocalDate();
        const bounds = dependencies.clock.getRangeBounds(localDate, 1);
        const includeCompletedTasks = validation.data.includeCompletedTasks === true;
        const [tasks, events, reminders] = await Promise.all([
          dependencies.repositories.listTasks({
            dueDateFrom: localDate,
            dueDateTo: localDate,
            includeCompleted: includeCompletedTasks
          }),
          dependencies.repositories.listEvents(bounds),
          dependencies.repositories.listReminders({
            statuses: ["PENDING"],
            remindAtFrom: bounds.startAt,
            remindAtTo: bounds.endAt
          })
        ]);
        return createSuccess({ localDate, tasks, events, reminders });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    getWeekSchedule: async (input) => {
      const validation = validateGetWeekScheduleInput(input);
      if (!validation.ok) return validation;
      const weekStart = validation.data.weekStart ?? getMonday(dependencies.clock.getLocalDate());
      if (!isMonday(weekStart)) {
        return createFailure(PLANNER_ERROR_CODES.dateInvalid);
      }
      try {
        const weekEnd = addCalendarDays(weekStart, 6);
        const bounds = dependencies.clock.getRangeBounds(weekStart, 7);
        const includeCompletedTasks = validation.data.includeCompletedTasks === true;
        const [tasks, events, reminders] = await Promise.all([
          dependencies.repositories.listTasks({
            dueDateFrom: weekStart,
            dueDateTo: weekEnd,
            includeCompleted: includeCompletedTasks
          }),
          dependencies.repositories.listEvents(bounds),
          dependencies.repositories.listReminders({
            statuses: ["PENDING"],
            remindAtFrom: bounds.startAt,
            remindAtTo: bounds.endAt
          })
        ]);
        return createSuccess({ weekStart, weekEnd, tasks, events, reminders });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    }
  };
};
