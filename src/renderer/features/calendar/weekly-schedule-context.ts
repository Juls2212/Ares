import type {
  PlannerApi,
  TodayScheduleData,
  Weekday,
  WeeklyRoutineRecord
} from "../../../shared/planner-contracts";
import { isValidWeeklyRoutineTimeBounds, type WeeklyRoutineTimeBounds, WEEKDAY_COLUMNS } from "./weekly-routine-utils";

export type WeeklyScheduleTodayState =
  | { kind: "LOADING" }
  | { kind: "READY"; data: TodayScheduleData }
  | { kind: "ERROR" };

export type WeeklyScheduleSummary = {
  blockCount: number;
  totalMinutes: number;
  busiestWeekday: Weekday;
};

export type WeeklyScheduleAvailability = {
  weekday: Weekday;
  start: number;
  end: number;
  durationMinutes: number;
};

type TimeInterval = { start: number; end: number };

const toMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const isValidRoutineInterval = (routine: WeeklyRoutineRecord): boolean => {
  const start = toMinutes(routine.startTime);
  const end = toMinutes(routine.endTime);
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 24 * 60 && end > start;
};

const mergeIntervals = (intervals: TimeInterval[]): TimeInterval[] => {
  const merged: TimeInterval[] = [];
  for (const interval of [...intervals].sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
};

export const loadWeeklyScheduleToday = async (
  planner: PlannerApi | undefined
): Promise<WeeklyScheduleTodayState> => {
  if (!planner) return { kind: "ERROR" };
  try {
    const result = await planner.schedule.getToday({ includeCompletedTasks: true });
    return result.ok ? { kind: "READY", data: result.data } : { kind: "ERROR" };
  } catch {
    return { kind: "ERROR" };
  }
};

export const summarizeWeeklySchedule = (routines: WeeklyRoutineRecord[]): WeeklyScheduleSummary | undefined => {
  const validRoutines = routines.filter(isValidRoutineInterval);
  if (validRoutines.length === 0) return undefined;

  const minutesByWeekday = new Map<Weekday, number>(WEEKDAY_COLUMNS.map((day) => [day.value, 0]));
  let totalMinutes = 0;
  for (const routine of validRoutines) {
    const duration = toMinutes(routine.endTime) - toMinutes(routine.startTime);
    totalMinutes += duration;
    minutesByWeekday.set(routine.weekday, (minutesByWeekday.get(routine.weekday) ?? 0) + duration);
  }

  let busiestWeekday: Weekday = "MONDAY";
  for (const { value: weekday } of WEEKDAY_COLUMNS) {
    if ((minutesByWeekday.get(weekday) ?? 0) > (minutesByWeekday.get(busiestWeekday) ?? 0)) busiestWeekday = weekday;
  }

  return { blockCount: validRoutines.length, totalMinutes, busiestWeekday };
};

export const findLargestWeeklyFreePeriod = (
  routines: WeeklyRoutineRecord[],
  bounds: WeeklyRoutineTimeBounds
): WeeklyScheduleAvailability | undefined => {
  if (!isValidWeeklyRoutineTimeBounds(bounds) || routines.filter(isValidRoutineInterval).length === 0) return undefined;

  let largestGap: WeeklyScheduleAvailability | undefined;
  for (const { value: weekday } of WEEKDAY_COLUMNS) {
    const intervals = routines
      .filter((routine) => routine.weekday === weekday && isValidRoutineInterval(routine))
      .map((routine) => ({ start: Math.max(bounds.start, toMinutes(routine.startTime)), end: Math.min(bounds.end, toMinutes(routine.endTime)) }))
      .filter((interval) => interval.end > interval.start);
    const merged = mergeIntervals(intervals);
    let cursor = bounds.start;
    const gaps = [...merged, { start: bounds.end, end: bounds.end }].map((interval) => {
      const gap = { weekday, start: cursor, end: interval.start, durationMinutes: interval.start - cursor };
      cursor = Math.max(cursor, interval.end);
      return gap;
    });
    for (const gap of gaps) {
      if (gap.durationMinutes > 0 && (!largestGap || gap.durationMinutes > largestGap.durationMinutes)) largestGap = gap;
    }
  }
  return largestGap;
};

export const formatWeeklyScheduleDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
};

export const formatWeeklyScheduleHour = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const weekdayLabel = (weekday: Weekday): string =>
  WEEKDAY_COLUMNS.find((day) => day.value === weekday)?.label ?? "";

export const formatWeeklyTaskStatus = (status: TodayScheduleData["tasks"][number]["status"]): string => {
  if (status === "COMPLETED") return "Completada";
  if (status === "IN_PROGRESS") return "En curso";
  return "Pendiente";
};

export const formatWeeklyEventTime = (startAt: string): string | undefined => {
  const value = new Date(startAt);
  if (!Number.isFinite(value.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
  } catch {
    return undefined;
  }
};
