import type { PlannerApi, TaskRecord, EventRecord } from "../../../shared/planner-contracts";
import { nextMonthStartFor, toLocalCalendarDate, toLocalDateTimeWithOffset } from "./calendar-date-utils";

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
