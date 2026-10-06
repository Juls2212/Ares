import type { PlannerApi, TaskRecord, EventRecord } from "../../../shared/planner-contracts";
import { addLocalCalendarDays, localDateFromIso, nextMonthStartFor, toLocalCalendarDate, toLocalDateTimeWithOffset } from "./calendar-date-utils";

export type CalendarLoadData = {
  tasks: TaskRecord[];
  events: EventRecord[];
  taskError?: string;
  eventError?: string;
};

const unavailableTasksMessage = "No se pudieron cargar las tareas del calendario.";
const unavailableEventsMessage = "No se pudieron cargar los eventos del calendario.";

const listTasks = async (planner: PlannerApi, monthStart: Date): Promise<TaskRecord[] | undefined> => {
  const monthEnd = new Date(nextMonthStartFor(monthStart).getTime() - 1);
  const result = await planner.tasks.list({
    dueDateFrom: toLocalCalendarDate(monthStart),
    dueDateTo: toLocalCalendarDate(monthEnd),
    includeCompleted: true
  });
  return result.ok ? result.data.items : undefined;
};

const listEvents = async (planner: PlannerApi, monthStart: Date): Promise<EventRecord[] | undefined> => {
  const result = await planner.events.list({
    startAt: toLocalDateTimeWithOffset(monthStart),
    endAt: toLocalDateTimeWithOffset(nextMonthStartFor(monthStart))
  });
  return result.ok ? result.data.items : undefined;
};

/** Loads the two approved read-only planner sources independently for partial calendar rendering. */
export const loadCalendarData = async (planner: PlannerApi | undefined, monthStart: Date): Promise<CalendarLoadData> => {
  if (!planner) return { tasks: [], events: [], taskError: unavailableTasksMessage, eventError: unavailableEventsMessage };

  const [tasksResult, eventsResult] = await Promise.allSettled([
    listTasks(planner, monthStart),
    listEvents(planner, monthStart)
  ]);

  return {
    tasks: tasksResult.status === "fulfilled" && tasksResult.value ? tasksResult.value : [],
    events: eventsResult.status === "fulfilled" && eventsResult.value ? eventsResult.value : [],
    ...(tasksResult.status === "fulfilled" && tasksResult.value !== undefined ? {} : { taskError: unavailableTasksMessage }),
    ...(eventsResult.status === "fulfilled" && eventsResult.value !== undefined ? {} : { eventError: unavailableEventsMessage })
  };
};

/** Loads a bounded local-calendar range through the existing explicit task and event list APIs. */
export const loadCalendarRangeData = async (
  planner: PlannerApi | undefined,
  startDate: string,
  dayCount: number
): Promise<CalendarLoadData> => {
  if (!planner || !Number.isInteger(dayCount) || dayCount < 1 || dayCount > 42) {
    return { tasks: [], events: [], taskError: unavailableTasksMessage, eventError: unavailableEventsMessage };
  }
  const rangeStart = localDateFromIso(startDate);
  const endDate = addLocalCalendarDays(startDate, dayCount - 1);
  const exclusiveEnd = localDateFromIso(addLocalCalendarDays(startDate, dayCount));
  const [tasksResult, eventsResult] = await Promise.allSettled([
    planner.tasks.list({ dueDateFrom: startDate, dueDateTo: endDate, includeCompleted: true }),
    planner.events.list({ startAt: toLocalDateTimeWithOffset(rangeStart), endAt: toLocalDateTimeWithOffset(exclusiveEnd) })
  ]);
  return {
    tasks: tasksResult.status === "fulfilled" && tasksResult.value.ok ? tasksResult.value.data.items : [],
    events: eventsResult.status === "fulfilled" && eventsResult.value.ok ? eventsResult.value.data.items : [],
    ...(tasksResult.status === "fulfilled" && tasksResult.value.ok ? {} : { taskError: unavailableTasksMessage }),
    ...(eventsResult.status === "fulfilled" && eventsResult.value.ok ? {} : { eventError: unavailableEventsMessage })
  };
};
