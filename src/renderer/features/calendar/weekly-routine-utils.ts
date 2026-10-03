import type { WeeklyRoutineRecord } from "../../../shared/planner-contracts";

export const WEEKDAY_COLUMNS = [
  { value: "MONDAY", label: "Lun" },
  { value: "TUESDAY", label: "Mar" },
  { value: "WEDNESDAY", label: "Mié" },
  { value: "THURSDAY", label: "Jue" },
  { value: "FRIDAY", label: "Vie" },
  { value: "SATURDAY", label: "Sáb" },
  { value: "SUNDAY", label: "Dom" }
] as const;

export type RoutinePlacement = {
  routine: WeeklyRoutineRecord;
  lane: number;
  laneCount: number;
};

export type WeeklyRoutineTimeBounds = {
  start: number;
  end: number;
};

export const DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS: WeeklyRoutineTimeBounds = {
  start: 6 * 60,
  end: 22 * 60
};

export const FULL_DAY_WEEKLY_ROUTINE_TIME_BOUNDS: WeeklyRoutineTimeBounds = {
  start: 0,
  end: 24 * 60
};

const toMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export const formatRoutineTimeRange = (routine: WeeklyRoutineRecord): string =>
  `${routine.startTime}–${routine.endTime}`;

export const weeklyRoutineTimeBounds = (routines: WeeklyRoutineRecord[]): WeeklyRoutineTimeBounds => {
  if (routines.length === 0) return DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS;
  const earliest = Math.min(...routines.map((routine) => toMinutes(routine.startTime)));
  const latest = Math.max(...routines.map((routine) => toMinutes(routine.endTime)));
  const start = Math.max(0, Math.floor(earliest / 60) * 60);
  const end = Math.min(24 * 60, Math.max(start + 4 * 60, Math.ceil(latest / 60) * 60));
  return { start, end };
};

export const weeklyRoutineHourLabels = (bounds: { start: number; end: number }): string[] => {
  const labels: string[] = [];
  for (let minute = bounds.start; minute <= bounds.end; minute += 60) {
    labels.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:00`);
  }
  return labels;
};

export const isValidWeeklyRoutineTimeBounds = (bounds: WeeklyRoutineTimeBounds): boolean =>
  Number.isInteger(bounds.start)
  && Number.isInteger(bounds.end)
  && bounds.start >= 0
  && bounds.end <= 24 * 60
  && bounds.end > bounds.start
  && bounds.start % 60 === 0
  && bounds.end % 60 === 0;

export const createRoutinePlacements = (routines: WeeklyRoutineRecord[]): RoutinePlacement[] => {
  const placements: RoutinePlacement[] = [];
  for (const { value: weekday } of WEEKDAY_COLUMNS) {
    const dayRoutines = routines
      .filter((routine) => routine.weekday === weekday)
      .sort((left, right) => toMinutes(left.startTime) - toMinutes(right.startTime));
    const lanes: number[] = [];
    const dayPlacements = dayRoutines.map((routine) => {
      const start = toMinutes(routine.startTime);
      let lane = lanes.findIndex((end) => end <= start);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(toMinutes(routine.endTime));
      } else {
        lanes[lane] = toMinutes(routine.endTime);
      }
      return { routine, lane, laneCount: 0 };
    });
    const laneCount = Math.max(1, lanes.length);
    placements.push(...dayPlacements.map((placement) => ({ ...placement, laneCount })));
  }
  return placements;
};

export const routinePosition = (
  routine: WeeklyRoutineRecord,
  bounds: WeeklyRoutineTimeBounds
): { top: string; height: string } | undefined => {
  const routineStart = toMinutes(routine.startTime);
  const routineEnd = toMinutes(routine.endTime);
  if (routineEnd <= bounds.start || routineStart >= bounds.end) return undefined;
  const range = bounds.end - bounds.start;
  const visibleStart = Math.max(routineStart, bounds.start);
  const visibleEnd = Math.min(routineEnd, bounds.end);
  return {
    top: `${((visibleStart - bounds.start) / range) * 100}%`,
    height: `${Math.max(7, ((visibleEnd - visibleStart) / range) * 100)}%`
  };
};
