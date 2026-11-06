import {
  PLANNER_ERROR_CODES,
  type PlannerOperationResult
} from "../../shared/planner-contracts";
import type {
  ActionOutcome,
  ActionPolicy,
  CreateWeeklyRoutineActionInput,
  CreateWeeklyScheduleActionInput,
  PlannerActionData,
  PlannerActionProposal,
  TerminalActionStatus,
  UpdateWeeklyRoutineActionInput,
  UpdateWeeklyScheduleActionInput
} from "../../shared/action-contracts";
import { getPlannerService } from "../planner/planner-composition";
import type { PlannerService } from "../planner/planner-service";
import type { EventRecord, TaskPriority, TaskRecord, TaskStatus, TodayScheduleData } from "../../shared/planner-contracts";
import { createWeeklyScheduleAnalysisService, type WeeklyScheduleAnalysisService } from "./weekly-schedule-analysis";
import { createWeeklyScheduleMutationReferences, type WeeklyScheduleMutationReferences } from "./weekly-schedule-mutation-references";

const MAX_TODAY_SCHEDULE_ITEMS_PER_KIND = 3;

export type PlannerActionExecutor = {
  execute: (proposal: PlannerActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type PlannerActionExecutorDependencies = {
  plannerService?: PlannerService;
  now: () => Date;
  timeZone: () => string;
  logError: (message: string) => void;
};

const successSummaries: Record<PlannerActionProposal["action"], string> = {
  CREATE_TASK: "Se creó la tarea.",
  UPDATE_TASK: "Se actualizó la tarea.",
  COMPLETE_TASK: "Se completó la tarea.",
  CREATE_EVENT: "Se creó el evento.",
  UPDATE_EVENT: "Se actualizó el evento.",
  CREATE_REMINDER: "Se creó el recordatorio.",
  GET_TODAY_SCHEDULE: "Se consultó la agenda de hoy.",
  GET_WEEK_SCHEDULE: "Se consultó la agenda de la semana.",
  GET_WEEKLY_SCHEDULE_DETAILS: "Se consultó el horario semanal.",
  ANALYZE_WEEKLY_SCHEDULE: "Se analizó el horario semanal.",
  GET_TODAY_AVAILABILITY: "Se consultó la disponibilidad de hoy.",
  CREATE_WEEKLY_SCHEDULE: "Se creó el horario semanal.",
  UPDATE_WEEKLY_SCHEDULE: "Se actualizó el horario semanal.",
  CREATE_WEEKLY_ROUTINE: "Se creó el bloque semanal.",
  UPDATE_WEEKLY_ROUTINE: "Se actualizó el bloque semanal.",
  GET_CURRENT_DATE_TIME: "Se consultó la fecha y hora actuales.",
  DELETE_EVENT: "Se eliminó el evento.",
  DELETE_TASK: "Se eliminó la tarea."
};

const failureStatus = (errorCode: string): TerminalActionStatus =>
  errorCode === PLANNER_ERROR_CODES.databaseUnavailable
    ? "EXECUTION_FAILED"
    : "VALIDATION_FAILED";

const priorityLabels: Record<TaskPriority, string> = {
  LOW: "prioridad baja",
  MEDIUM: "prioridad media",
  HIGH: "prioridad alta"
};

const statusLabels: Record<TaskStatus, string> = {
  PENDING: "pendiente",
  IN_PROGRESS: "en progreso",
  COMPLETED: "completada"
};

const formatLocalTime = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat("es-CO", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(instant));

const describeTask = (task: TaskRecord): string => {
  const dueTime = task.dueTime ? `, a las ${task.dueTime}` : "";
  return `${task.title} (${priorityLabels[task.priority]}, ${statusLabels[task.status]}${dueTime})`;
};

const describeEvent = (event: EventRecord, timeZone: string): string =>
  `${event.title} a las ${formatLocalTime(event.startAt, timeZone)}`;

export const describeTodaySchedule = (schedule: TodayScheduleData, timeZone: string): string => {
  if (schedule.tasks.length === 0 && schedule.events.length === 0) {
    return "Hoy no tienes tareas ni eventos.";
  }

  const displayedTasks = schedule.tasks.slice(0, MAX_TODAY_SCHEDULE_ITEMS_PER_KIND);
  const displayedEvents = schedule.events.slice(0, MAX_TODAY_SCHEDULE_ITEMS_PER_KIND);
  const sections: string[] = [];
  if (displayedTasks.length > 0) {
    sections.push(`Tareas: ${displayedTasks.map(describeTask).join("; ")}.`);
  }
  if (displayedEvents.length > 0) {
    sections.push(`Eventos: ${displayedEvents.map((event) => describeEvent(event, timeZone)).join("; ")}.`);
  }
  const remaining = schedule.tasks.length - displayedTasks.length + schedule.events.length - displayedEvents.length;
  const remainingText =
    remaining > 0 ? ` Además, tienes ${remaining} ${remaining === 1 ? "elemento más" : "elementos más"}.` : "";
  return `Para hoy: ${sections.join(" ")}${remainingText}`;
};

export const describeCurrentDateTime = (now: Date, timeZone: string): string => {
  const date = new Intl.DateTimeFormat("es-CO", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(now);
  const time = new Intl.DateTimeFormat("es-CO", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(now);
  return `Hoy es ${date}. Son las ${time}.`;
};

const toOutcome = <T extends PlannerActionData>(
  proposal: PlannerActionProposal,
  policy: ActionPolicy,
  result: PlannerOperationResult<T>,
  timeZone: string
): ActionOutcome => {
  if (result.ok) {
    return {
      actionId: proposal.actionId,
      action: proposal.action,
      riskLevel: policy.riskLevel,
      status: "SUCCEEDED",
      data: result.data,
      userSummary:
        proposal.action === "GET_TODAY_SCHEDULE"
          ? describeTodaySchedule(result.data as TodayScheduleData, timeZone)
          : successSummaries[proposal.action]
    };
  }

  return {
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: failureStatus(result.error.code),
    errorCode: result.error.code,
    userSummary: result.error.userMessage
  };
};

const toAnalysisOutcome = (
  proposal: Extract<PlannerActionProposal, { action: "GET_WEEKLY_SCHEDULE_DETAILS" | "ANALYZE_WEEKLY_SCHEDULE" | "GET_TODAY_AVAILABILITY" }>,
  policy: ActionPolicy,
  result: Awaited<ReturnType<WeeklyScheduleAnalysisService["getDetails"]>>
): ActionOutcome => result.ok
  ? { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: result.data.summary }
  : { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: failureStatus(result.error.code), errorCode: result.error.code, userSummary: result.error.userMessage };

const weekdayLabels = {
  MONDAY: "lunes", TUESDAY: "martes", WEDNESDAY: "miércoles", THURSDAY: "jueves", FRIDAY: "viernes", SATURDAY: "sábado", SUNDAY: "domingo"
} as const;

const toWeeklyMutationOutcome = (
  proposal: Extract<PlannerActionProposal, { action: "CREATE_WEEKLY_SCHEDULE" | "UPDATE_WEEKLY_SCHEDULE" | "CREATE_WEEKLY_ROUTINE" | "UPDATE_WEEKLY_ROUTINE" }>,
  policy: ActionPolicy,
  result: { ok: true; data: { record: { title: string; weekday?: keyof typeof weekdayLabels; startTime?: string; endTime?: string } } } | { ok: false; error: { code: string; userMessage: string } },
  scheduleTitle?: string
): ActionOutcome => {
  if (!result.ok) {
    return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: failureStatus(result.error.code), errorCode: result.error.code, userSummary: result.error.userMessage };
  }
  const record = result.data.record;
  const summary = proposal.action === "CREATE_WEEKLY_SCHEDULE"
    ? `Listo, creé el horario «${record.title}».`
    : proposal.action === "UPDATE_WEEKLY_SCHEDULE"
      ? `Listo, actualicé el horario «${record.title}».`
      : proposal.action === "CREATE_WEEKLY_ROUTINE"
        ? `Listo, agregué «${record.title}» el ${weekdayLabels[record.weekday!]} de ${record.startTime} a ${record.endTime} en «${scheduleTitle}».`
        : `Listo, actualicé «${record.title}» el ${weekdayLabels[record.weekday!]} de ${record.startTime} a ${record.endTime} en «${scheduleTitle}».`;
  return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: summary };
};

export const createPlannerActionExecutor = (
  overrides: Partial<PlannerActionExecutorDependencies> = {}
): PlannerActionExecutor => {
  const dependencies: PlannerActionExecutorDependencies = {
    plannerService: overrides.plannerService,
    now: overrides.now ?? (() => new Date()),
    timeZone: overrides.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let plannerService = dependencies.plannerService;
  let weeklyScheduleAnalysisService: WeeklyScheduleAnalysisService | undefined;
  let weeklyScheduleMutationReferences: WeeklyScheduleMutationReferences | undefined;
  const getService = (): PlannerService => {
    plannerService ??= getPlannerService();
    return plannerService;
  };
  const getWeeklyScheduleAnalysisService = (): WeeklyScheduleAnalysisService => {
    weeklyScheduleAnalysisService ??= createWeeklyScheduleAnalysisService({ plannerService: getService(), timeZone: dependencies.timeZone });
    return weeklyScheduleAnalysisService;
  };
  const getWeeklyScheduleMutationReferences = (): WeeklyScheduleMutationReferences => {
    weeklyScheduleMutationReferences ??= createWeeklyScheduleMutationReferences(getService);
    return weeklyScheduleMutationReferences;
  };
  const weeklyReferenceFailure = (
    proposal: Extract<PlannerActionProposal, { action: "CREATE_WEEKLY_SCHEDULE" | "UPDATE_WEEKLY_SCHEDULE" | "CREATE_WEEKLY_ROUTINE" | "UPDATE_WEEKLY_ROUTINE" }>,
    policy: ActionPolicy,
    state: "MISSING" | "AMBIGUOUS" | "UNAVAILABLE",
    kind: "schedule" | "routine" | "category"
  ): ActionOutcome => {
    const messages = {
      schedule: state === "MISSING" ? "No encontré ese horario semanal." : state === "AMBIGUOUS" ? "Encontré varios horarios con ese nombre. Indica uno más específico." : "No se pudieron consultar los horarios semanales.",
      routine: state === "MISSING" ? "No encontré ese bloque semanal." : state === "AMBIGUOUS" ? "Encontré varios bloques que coinciden. Indica el día u horario exacto." : "No se pudieron consultar los bloques semanales.",
      category: state === "MISSING" ? "No encontré esa categoría." : state === "AMBIGUOUS" ? "Encontré varias categorías con ese nombre. Indica una más específica." : "No se pudieron consultar las categorías."
    } as const;
    return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: state === "UNAVAILABLE" ? "EXECUTION_FAILED" : "VALIDATION_FAILED", errorCode: state === "UNAVAILABLE" ? "PLANNER_DATABASE_UNAVAILABLE" : "PLANNER_NOT_FOUND", userSummary: messages[kind] };
  };
  const executeWeeklyMutation = async (
    proposal: Extract<PlannerActionProposal, { action: "CREATE_WEEKLY_SCHEDULE" | "UPDATE_WEEKLY_SCHEDULE" | "CREATE_WEEKLY_ROUTINE" | "UPDATE_WEEKLY_ROUTINE" }>,
    policy: ActionPolicy
  ): Promise<ActionOutcome> => {
    const service = getService();
    const references = getWeeklyScheduleMutationReferences();
    if (proposal.action === "CREATE_WEEKLY_SCHEDULE") {
      const input = proposal.input as CreateWeeklyScheduleActionInput;
      const existing = await references.resolveSchedule(input.title);
      if (existing.state === "RESOLVED") {
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "VALIDATION_FAILED",
          errorCode: "PLANNER_WEEKLY_SCHEDULE_TITLE_DUPLICATE",
          userSummary: "Ya existe un horario con ese nombre. Indica otro nombre."
        };
      }
      if (existing.state === "UNAVAILABLE") return weeklyReferenceFailure(proposal, policy, "UNAVAILABLE", "schedule");
      return toWeeklyMutationOutcome(proposal, policy, await service.createWeeklySchedule(input) as never);
    }
    const schedule = await references.resolveSchedule(proposal.input.scheduleTitle);
    if (schedule.state !== "RESOLVED") return weeklyReferenceFailure(proposal, policy, schedule.state, "schedule");
    if (proposal.action === "UPDATE_WEEKLY_SCHEDULE") {
      const { scheduleTitle: _scheduleTitle, ...input } = proposal.input as UpdateWeeklyScheduleActionInput;
      if (input.title !== undefined) {
        const replacement = await references.resolveSchedule(input.title);
        if (replacement.state === "RESOLVED" && replacement.schedule.id !== schedule.schedule.id) {
          return {
            actionId: proposal.actionId,
            action: proposal.action,
            riskLevel: policy.riskLevel,
            status: "VALIDATION_FAILED",
            errorCode: "PLANNER_WEEKLY_SCHEDULE_TITLE_DUPLICATE",
            userSummary: "Ya existe un horario con ese nombre. Indica otro nombre."
          };
        }
        if (replacement.state === "UNAVAILABLE") return weeklyReferenceFailure(proposal, policy, "UNAVAILABLE", "schedule");
      }
      return toWeeklyMutationOutcome(proposal, policy, await service.updateWeeklySchedule({ ...input, weeklyScheduleId: schedule.schedule.id }) as never);
    }
    const categoryName = proposal.input.categoryName;
    const category = categoryName ? await references.resolveCategory(categoryName) : undefined;
    if (category && category.state !== "RESOLVED") return weeklyReferenceFailure(proposal, policy, category.state, "category");
    if (proposal.action === "CREATE_WEEKLY_ROUTINE") {
      const { scheduleTitle: _scheduleTitle, categoryName: _categoryName, ...input } = proposal.input as CreateWeeklyRoutineActionInput;
      return toWeeklyMutationOutcome(proposal, policy, await service.createWeeklyRoutine({ ...input, weeklyScheduleId: schedule.schedule.id, ...(category ? { categoryId: category.category.id } : {}) }) as never, schedule.schedule.title);
    }
    const update = proposal.input as UpdateWeeklyRoutineActionInput;
    const routine = await references.resolveRoutine({ scheduleTitle: schedule.schedule.title, routineTitle: update.routineTitle, weekday: update.targetWeekday, startTime: update.targetStartTime, endTime: update.targetEndTime });
    if (routine.state !== "RESOLVED") return weeklyReferenceFailure(proposal, policy, routine.state, "routine");
    const { scheduleTitle: _scheduleTitle, routineTitle: _routineTitle, targetWeekday: _targetWeekday, targetStartTime: _targetStartTime, targetEndTime: _targetEndTime, categoryName: _categoryName, ...input } = update;
    return toWeeklyMutationOutcome(proposal, policy, await service.updateWeeklyRoutine({ ...input, routineId: routine.routine.id, weeklyScheduleId: schedule.schedule.id, ...(category ? { categoryId: category.category.id } : {}) }) as never, schedule.schedule.title);
  };

  return {
    execute: async (proposal, policy) => {
      try {
        switch (proposal.action) {
          case "CREATE_TASK":
            return toOutcome(proposal, policy, await getService().createTask(proposal.input), dependencies.timeZone());
          case "UPDATE_TASK":
            return toOutcome(proposal, policy, await getService().updateTask(proposal.input), dependencies.timeZone());
          case "COMPLETE_TASK":
            return toOutcome(proposal, policy, await getService().completeTask(proposal.input), dependencies.timeZone());
          case "CREATE_EVENT":
            return toOutcome(proposal, policy, await getService().createEvent(proposal.input), dependencies.timeZone());
          case "UPDATE_EVENT":
            return toOutcome(proposal, policy, await getService().updateEvent(proposal.input), dependencies.timeZone());
          case "CREATE_REMINDER":
            return toOutcome(proposal, policy, await getService().createReminder(proposal.input), dependencies.timeZone());
          case "GET_TODAY_SCHEDULE":
            return toOutcome(proposal, policy, await getService().getTodaySchedule(proposal.input), dependencies.timeZone());
          case "GET_WEEK_SCHEDULE":
            return toOutcome(proposal, policy, await getService().getWeekSchedule(proposal.input), dependencies.timeZone());
          case "GET_WEEKLY_SCHEDULE_DETAILS":
            return toAnalysisOutcome(proposal, policy, await getWeeklyScheduleAnalysisService().getDetails(proposal.input));
          case "ANALYZE_WEEKLY_SCHEDULE":
            return toAnalysisOutcome(proposal, policy, await getWeeklyScheduleAnalysisService().analyze(proposal.input));
          case "GET_TODAY_AVAILABILITY":
            return toAnalysisOutcome(proposal, policy, await getWeeklyScheduleAnalysisService().getTodayAvailability(proposal.input));
          case "CREATE_WEEKLY_SCHEDULE":
          case "UPDATE_WEEKLY_SCHEDULE":
          case "CREATE_WEEKLY_ROUTINE":
          case "UPDATE_WEEKLY_ROUTINE":
            return executeWeeklyMutation(proposal, policy);
          case "GET_CURRENT_DATE_TIME":
            return {
              actionId: proposal.actionId,
              action: proposal.action,
              riskLevel: policy.riskLevel,
              status: "SUCCEEDED",
              data: {},
              userSummary: describeCurrentDateTime(dependencies.now(), dependencies.timeZone())
            };
          case "DELETE_EVENT":
            return toOutcome(proposal, policy, await getService().deleteEvent(proposal.input), dependencies.timeZone());
          case "DELETE_TASK":
            return toOutcome(proposal, policy, await getService().deleteTask(proposal.input), dependencies.timeZone());
        }
      } catch {
        dependencies.logError("Planner action execution failed.");
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "EXECUTION_FAILED",
          errorCode: "ACTION_EXECUTION_UNAVAILABLE",
          userSummary: "No se pudo completar la acción solicitada."
        };
      }
    }
  };
};
