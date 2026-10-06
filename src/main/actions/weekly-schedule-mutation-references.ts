import type { CategoryRecord, Weekday, WeeklyRoutineRecord, WeeklyScheduleRecord } from "../../shared/planner-contracts";
import type { PlannerService } from "../planner/planner-service";

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-CO");

type ResolvedSchedule = { state: "RESOLVED"; schedule: WeeklyScheduleRecord };
type ResolvedRoutine = { state: "RESOLVED"; routine: WeeklyRoutineRecord };
type ResolvedCategory = { state: "RESOLVED"; category: CategoryRecord };
type ReferenceState = { state: "MISSING" | "AMBIGUOUS" | "UNAVAILABLE" };

export type WeeklyScheduleMutationReferences = {
  resolveSchedule: (title: string) => Promise<ResolvedSchedule | ReferenceState>;
  resolveRoutine: (input: {
    scheduleTitle: string;
    routineTitle: string;
    weekday?: Weekday;
    startTime?: string;
    endTime?: string;
  }) => Promise<ResolvedRoutine | ReferenceState>;
  resolveCategory: (name: string) => Promise<ResolvedCategory | ReferenceState>;
};

type ReferencePlanner = Pick<PlannerService, "listCategories" | "listWeeklyRoutines" | "listWeeklySchedules">;

const resultState = <T>(items: T[]): { state: "RESOLVED"; item: T } | ReferenceState =>
  items.length === 1
    ? { state: "RESOLVED", item: items[0] }
    : items.length === 0
      ? { state: "MISSING" }
      : { state: "AMBIGUOUS" };

export const createWeeklyScheduleMutationReferences = (
  getPlannerService: () => ReferencePlanner
): WeeklyScheduleMutationReferences => {
  const resolveSchedule = async (title: string): Promise<ResolvedSchedule | ReferenceState> => {
    try {
      const result = await getPlannerService().listWeeklySchedules({});
      if (!result.ok) return { state: "UNAVAILABLE" };
      const selected = resultState(result.data.items.filter((schedule) => normalize(schedule.title) === normalize(title)));
      return selected.state === "RESOLVED" ? { state: "RESOLVED", schedule: selected.item } : selected;
    } catch {
      return { state: "UNAVAILABLE" };
    }
  };

  return {
    resolveSchedule,
    resolveRoutine: async (input) => {
      const schedule = await resolveSchedule(input.scheduleTitle);
      if (schedule.state !== "RESOLVED") return schedule;
      try {
        const result = await getPlannerService().listWeeklyRoutines({ weeklyScheduleId: schedule.schedule.id });
        if (!result.ok) return { state: "UNAVAILABLE" };
        const selected = resultState(result.data.items.filter((routine) =>
          normalize(routine.title) === normalize(input.routineTitle) &&
          (input.weekday === undefined || routine.weekday === input.weekday) &&
          (input.startTime === undefined || routine.startTime === input.startTime) &&
          (input.endTime === undefined || routine.endTime === input.endTime)
        ));
        return selected.state === "RESOLVED" ? { state: "RESOLVED", routine: selected.item } : selected;
      } catch {
        return { state: "UNAVAILABLE" };
      }
    },
    resolveCategory: async (name) => {
      try {
        const result = await getPlannerService().listCategories({});
        if (!result.ok) return { state: "UNAVAILABLE" };
        const selected = resultState(result.data.items.filter((category) => normalize(category.name) === normalize(name)));
        return selected.state === "RESOLVED" ? { state: "RESOLVED", category: selected.item } : selected;
      } catch {
        return { state: "UNAVAILABLE" };
      }
    }
  };
};
