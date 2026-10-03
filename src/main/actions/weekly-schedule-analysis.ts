import type {
  AnalyzeWeeklyScheduleInput,
  GetTodayAvailabilityInput,
  GetWeeklyScheduleDetailsInput,
  WeeklyScheduleAnalysisKind,
  WeeklyScheduleReferenceInput
} from "../../shared/action-contracts";
import type { PlannerOperationResult, TodayScheduleData, Weekday, WeeklyRoutineRecord, WeeklyScheduleRecord } from "../../shared/planner-contracts";
import type { PlannerService } from "../planner/planner-service";

const MAX_ITEMS = 3;
const DAY_START = 6 * 60;
const DAY_END = 22 * 60;
const WEEKDAYS: readonly { value: Weekday; label: string }[] = [
  { value: "MONDAY", label: "lunes" }, { value: "TUESDAY", label: "martes" }, { value: "WEDNESDAY", label: "miércoles" },
  { value: "THURSDAY", label: "jueves" }, { value: "FRIDAY", label: "viernes" }, { value: "SATURDAY", label: "sábado" }, { value: "SUNDAY", label: "domingo" }
];

type Interval = { start: number; end: number };
type AnalysisData = { summary: string };
export type WeeklyScheduleReferenceResolution =
  | { state: "RESOLVED"; title: string }
  | { state: "MISSING" | "AMBIGUOUS" | "UNAVAILABLE" };

const normalizeTitle = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es-CO");
const toMinutes = (value: string): number => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
const formatMinutes = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const formatDuration = (minutes: number): string => minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hora" : "horas"}` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
const weekdayLabel = (weekday: Weekday): string => WEEKDAYS.find((day) => day.value === weekday)?.label ?? "";

const mergeIntervals = (intervals: Interval[]): Interval[] => {
  const merged: Interval[] = [];
  for (const interval of [...intervals].sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
};

const freeIntervals = (routines: WeeklyRoutineRecord[], weekday: Weekday, start = DAY_START, end = DAY_END): Interval[] => {
  const occupied = mergeIntervals(routines.filter((routine) => routine.weekday === weekday).map((routine) => ({ start: Math.max(start, toMinutes(routine.startTime)), end: Math.min(end, toMinutes(routine.endTime)) })).filter((interval) => interval.end > interval.start));
  const result: Interval[] = [];
  let cursor = start;
  for (const interval of [...occupied, { start: end, end }]) {
    if (interval.start > cursor) result.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  return result;
};

const busiestDay = (routines: WeeklyRoutineRecord[]): { weekday: Weekday; minutes: number } => {
  const totals = new Map<Weekday, number>(WEEKDAYS.map((day) => [day.value, 0]));
  for (const routine of routines) totals.set(routine.weekday, (totals.get(routine.weekday) ?? 0) + toMinutes(routine.endTime) - toMinutes(routine.startTime));
  let result = { weekday: WEEKDAYS[0].value, minutes: 0 };
  for (const day of WEEKDAYS) { const minutes = totals.get(day.value) ?? 0; if (minutes > result.minutes) result = { weekday: day.value, minutes }; }
  return result;
};

const conflicts = (routines: WeeklyRoutineRecord[]): { weekday: Weekday; first: WeeklyRoutineRecord; second: WeeklyRoutineRecord }[] => {
  const found: { weekday: Weekday; first: WeeklyRoutineRecord; second: WeeklyRoutineRecord }[] = [];
  for (const day of WEEKDAYS) {
    const entries = routines.filter((routine) => routine.weekday === day.value).sort((left, right) => left.startTime.localeCompare(right.startTime));
    for (let index = 0; index < entries.length; index += 1) for (let following = index + 1; following < entries.length; following += 1) {
      if (toMinutes(entries[following].startTime) >= toMinutes(entries[index].endTime)) break;
      found.push({ weekday: day.value, first: entries[index], second: entries[following] });
    }
  }
  return found;
};

const error = (code: string, userMessage: string): PlannerOperationResult<AnalysisData> => ({ ok: false, error: { code, userMessage } });
const success = (summary: string): PlannerOperationResult<AnalysisData> => ({ ok: true, data: { summary } });

export const createWeeklyScheduleReferenceResolver = (
  getPlannerService: () => Pick<PlannerService, "listWeeklySchedules">
) => async (title: string): Promise<WeeklyScheduleReferenceResolution> => {
  try {
    const result = await getPlannerService().listWeeklySchedules({});
    if (!result.ok) return { state: "UNAVAILABLE" };
    const matches = result.data.items.filter((schedule) => normalizeTitle(schedule.title) === normalizeTitle(title));
    if (matches.length === 0) return { state: "MISSING" };
    if (matches.length > 1) return { state: "AMBIGUOUS" };
    return { state: "RESOLVED", title: matches[0].title };
  } catch { return { state: "UNAVAILABLE" }; }
};

export type WeeklyScheduleAnalysisService = {
  getDetails: (input: GetWeeklyScheduleDetailsInput) => Promise<PlannerOperationResult<AnalysisData>>;
  analyze: (input: AnalyzeWeeklyScheduleInput) => Promise<PlannerOperationResult<AnalysisData>>;
  getTodayAvailability: (input: GetTodayAvailabilityInput) => Promise<PlannerOperationResult<AnalysisData>>;
};

type Dependencies = { plannerService: Pick<PlannerService, "listWeeklySchedules" | "listWeeklyRoutines" | "getTodaySchedule">; timeZone: () => string };

export const createWeeklyScheduleAnalysisService = (overrides: Partial<Dependencies> = {}): WeeklyScheduleAnalysisService => {
  const dependencies = overrides as Dependencies;
  const resolveSchedules = async (input: WeeklyScheduleReferenceInput): Promise<WeeklyScheduleRecord[] | PlannerOperationResult<AnalysisData>> => {
    const result = await dependencies.plannerService.listWeeklySchedules({});
    if (!result.ok) return error(result.error.code, "No se pudieron consultar los horarios semanales.");
    if ("allSchedules" in input) return result.data.items;
    const matches = result.data.items.filter((schedule) => normalizeTitle(schedule.title) === normalizeTitle(input.scheduleTitle));
    if (matches.length === 0) return error("PLANNER_NOT_FOUND", "No encontré ese horario. Indica el nombre exacto de uno de tus horarios.");
    if (matches.length > 1) return error("PLANNER_CONFLICT", "Encontré varios horarios con ese nombre. Indica un nombre más específico.");
    return matches;
  };
  const routinesFor = async (schedule: WeeklyScheduleRecord): Promise<WeeklyRoutineRecord[] | PlannerOperationResult<AnalysisData>> => {
    const result = await dependencies.plannerService.listWeeklyRoutines({ weeklyScheduleId: schedule.id });
    return result.ok ? result.data.items : error(result.error.code, "No se pudieron consultar los bloques de ese horario.");
  };
  const describeSchedule = (schedule: WeeklyScheduleRecord, routines: WeeklyRoutineRecord[]): string => {
    if (routines.length === 0) return `En «${schedule.title}» no tienes bloques semanales.`;
    const busiest = busiestDay(routines);
    const total = routines.reduce((sum, routine) => sum + toMinutes(routine.endTime) - toMinutes(routine.startTime), 0);
    const shown = routines.slice(0, MAX_ITEMS).map((routine) => `${weekdayLabel(routine.weekday)} ${routine.startTime}–${routine.endTime}: ${routine.title}`).join("; ");
    const remaining = routines.length - Math.min(routines.length, MAX_ITEMS);
    return `En «${schedule.title}» tienes ${routines.length} bloques y ${formatDuration(total)} programadas. El día más ocupado es el ${weekdayLabel(busiest.weekday)}, con ${formatDuration(busiest.minutes)}. Bloques: ${shown}.${remaining > 0 ? ` Además, hay ${remaining} ${remaining === 1 ? "bloque más" : "bloques más"}.` : ""}`;
  };
  const analyzeSchedule = (schedule: WeeklyScheduleRecord, routines: WeeklyRoutineRecord[], analysis: WeeklyScheduleAnalysisKind): string => {
    if (routines.length === 0) return `En «${schedule.title}» no tienes bloques semanales para analizar.`;
    if (analysis === "BUSIEST_DAY") { const result = busiestDay(routines); return `En «${schedule.title}», el día más ocupado es el ${weekdayLabel(result.weekday)}, con ${formatDuration(result.minutes)} programadas.`; }
    if (analysis === "OVERLAPS") {
      const found = conflicts(routines);
      if (found.length === 0) return `No encontré cruces entre los bloques de «${schedule.title}».`;
      const shown = found.slice(0, MAX_ITEMS).map((conflict) => `${weekdayLabel(conflict.weekday)}: ${conflict.first.title} (${conflict.first.startTime}–${conflict.first.endTime}) y ${conflict.second.title} (${conflict.second.startTime}–${conflict.second.endTime})`).join("; ");
      return `Encontré ${found.length} ${found.length === 1 ? "cruce" : "cruces"} en «${schedule.title}»: ${shown}.${found.length > MAX_ITEMS ? ` Hay ${found.length - MAX_ITEMS} más.` : ""}`;
    }
    const periods = WEEKDAYS.flatMap((day) => freeIntervals(routines, day.value).map((interval) => ({ weekday: day.value, ...interval }))).sort((left, right) => right.end - right.start - (left.end - left.start));
    if (periods.length === 0) return `No encontré espacios libres entre las 06:00 y las 22:00 en «${schedule.title}».`;
    const shown = periods.slice(0, MAX_ITEMS).map((period) => `${weekdayLabel(period.weekday)} de ${formatMinutes(period.start)} a ${formatMinutes(period.end)}`).join("; ");
    return `En «${schedule.title}» tienes espacios libres estimados: ${shown}.${periods.length > MAX_ITEMS ? ` Hay ${periods.length - MAX_ITEMS} más.` : ""}`;
  };
  return {
    getDetails: async (input) => {
      try {
        const schedules = await resolveSchedules(input); if (!Array.isArray(schedules)) return schedules;
        if (schedules.length === 0) return success("No tienes horarios semanales creados.");
        const selected = schedules.slice(0, MAX_ITEMS); const descriptions: string[] = [];
        for (const schedule of selected) { const routines = await routinesFor(schedule); if (!Array.isArray(routines)) return routines; descriptions.push(describeSchedule(schedule, routines)); }
        return success(descriptions.join(" ") + (schedules.length > MAX_ITEMS ? ` Además, tienes ${schedules.length - MAX_ITEMS} horarios más.` : ""));
      } catch { return error("PLANNER_DATABASE_UNAVAILABLE", "No se pudieron consultar los horarios semanales."); }
    },
    analyze: async (input) => {
      try {
        const schedules = await resolveSchedules(input); if (!Array.isArray(schedules)) return schedules;
        if (schedules.length === 0) return success("No tienes horarios semanales creados.");
        const descriptions: string[] = [];
        for (const schedule of schedules.slice(0, MAX_ITEMS)) { const routines = await routinesFor(schedule); if (!Array.isArray(routines)) return routines; descriptions.push(analyzeSchedule(schedule, routines, input.analysis)); }
        return success(descriptions.join(" ") + (schedules.length > MAX_ITEMS ? ` Además, hay ${schedules.length - MAX_ITEMS} horarios más.` : ""));
      } catch { return error("PLANNER_DATABASE_UNAVAILABLE", "No se pudieron analizar los horarios semanales."); }
    },
    getTodayAvailability: async (input) => {
      try {
        const result = await dependencies.plannerService.getTodaySchedule({ includeCompletedTasks: true });
        if (!result.ok) return error(result.error.code, "No se pudo consultar la agenda de hoy.");
        const start = input.afterTime ? toMinutes(input.afterTime) : DAY_START;
        const eventIntervals = result.data.events.flatMap((event) => {
          if (!event.endAt) return [];
          const startAt = localMinutes(event.startAt, dependencies.timeZone()); const endAt = localMinutes(event.endAt, dependencies.timeZone());
          return startAt === undefined || endAt === undefined ? [] : [{ start: Math.max(start, startAt), end: Math.min(DAY_END, endAt), event }];
        }).filter((entry) => entry.end > entry.start);
        const occupied = mergeIntervals(eventIntervals.map(({ start, end }) => ({ start, end })));
        const free = freeFromIntervals(occupied, start, DAY_END);
        const eventText = eventIntervals.slice(0, MAX_ITEMS).map(({ event }) => `${event.title} de ${formatLocalTime(event.startAt, dependencies.timeZone())} a ${formatLocalTime(event.endAt!, dependencies.timeZone())}`).join("; ");
        const deadlineText = result.data.tasks.filter((task) => task.dueTime && toMinutes(task.dueTime) >= start).slice(0, MAX_ITEMS).map((task) => `${task.title} vence a las ${task.dueTime}`).join("; ");
        const freeText = free.slice(0, MAX_ITEMS).map((interval) => `${formatMinutes(interval.start)}–${formatMinutes(interval.end)}`).join("; ");
        return success(`Para hoy${input.afterTime ? ` después de las ${input.afterTime}` : ""}:${eventText ? ` eventos: ${eventText}.` : " no tienes eventos con duración registrada."}${deadlineText ? ` Plazos: ${deadlineText}.` : ""}${freeText ? ` Espacios libres estimados: ${freeText}.` : " No encontré espacios libres estimados en ese rango."}`);
      } catch { return error("PLANNER_DATABASE_UNAVAILABLE", "No se pudo consultar la disponibilidad de hoy."); }
    }
  };
};

const freeFromIntervals = (intervals: Interval[], start: number, end: number): Interval[] => {
  const result: Interval[] = []; let cursor = start;
  for (const interval of [...intervals, { start: end, end }]) { if (interval.start > cursor) result.push({ start: cursor, end: interval.start }); cursor = Math.max(cursor, interval.end); }
  return result;
};

const formatLocalTime = (value: string, timeZone: string): string => new Intl.DateTimeFormat("es-CO", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
const localMinutes = (value: string, timeZone: string): number | undefined => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value); const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : undefined;
};
