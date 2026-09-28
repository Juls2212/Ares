import type { OperationResult } from "../shared/contracts";
import type { EventRecord, TodayScheduleData } from "../shared/planner-contracts";

export type PlannerPanelState<T> =
  | { kind: "LOADING" }
  | { kind: "READY"; data: T }
  | { kind: "ERROR"; userMessage: string };

export type TodaySummary = {
  pendingTasks: number;
  completedTasks: number;
  upcomingEvents: number;
};

export const getPlannerPanelState = <T>(
  result: OperationResult<T>,
  unavailableMessage: string
): PlannerPanelState<T> => result.ok
  ? { kind: "READY", data: result.data }
  : { kind: "ERROR", userMessage: unavailableMessage };

export const summarizeToday = (schedule: TodayScheduleData, now: Date): TodaySummary => ({
  pendingTasks: schedule.tasks.filter((task) => task.status !== "COMPLETED").length,
  completedTasks: schedule.tasks.filter((task) => task.status === "COMPLETED").length,
  upcomingEvents: schedule.events.filter((event) => new Date(event.startAt).getTime() >= now.getTime()).length
});

export const getUpcomingEvents = (events: readonly EventRecord[], now: Date): EventRecord[] => events
  .filter((event) => new Date(event.startAt).getTime() >= now.getTime())
  .sort((first, second) => new Date(first.startAt).getTime() - new Date(second.startAt).getTime())
  .slice(0, 3);

export const formatEventTime = (startAt: string): string => {
  const instant = new Date(startAt);
  if (Number.isNaN(instant.getTime())) return "Hora no disponible";
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(instant);
};
