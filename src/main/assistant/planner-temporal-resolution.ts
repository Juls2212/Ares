type UnknownRecord = Record<string, unknown>;

export type PlannerTemporalAction = "CREATE_TASK" | "CREATE_EVENT" | "CREATE_REMINDER";

export type PlannerTemporalResolutionReason =
  | "DATE_REQUIRED"
  | "TIME_REQUIRED"
  | "DATE_INVALID"
  | "TIME_INVALID"
  | "DATE_PAST"
  | "INSTANT_PAST"
  | "WEEKDAY_AMBIGUOUS"
  | "LOCAL_TIME_AMBIGUOUS"
  | "TIME_RANGE_INVALID";

export type PlannerTemporalResolution =
  | { ok: true; input: UnknownRecord }
  | { ok: false; reason: PlannerTemporalResolutionReason };

export type PlannerTemporalResolverDependencies = {
  now: () => Date;
  timeZone: () => string;
};

type CalendarDate = { year: number; month: number; day: number };
type LocalDateTime = CalendarDate & { hour: number; minute: number };

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pad = (value: number): string => value.toString().padStart(2, "0");

const formatDate = ({ year, month, day }: CalendarDate): string =>
  `${year.toString().padStart(4, "0")}-${pad(month)}-${pad(day)}`;

const normalizeSpanish = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

const parseCalendarDate = (value: string): CalendarDate | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
    ? { year, month, day }
    : undefined;
};

const addCalendarDays = (date: CalendarDate, days: number): CalendarDate => {
  const candidate = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: candidate.getUTCFullYear(),
    month: candidate.getUTCMonth() + 1,
    day: candidate.getUTCDate()
  };
};

const compareCalendarDates = (left: CalendarDate, right: CalendarDate): number =>
  formatDate(left).localeCompare(formatDate(right));

const weekdayByName: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6
};

const formatParts = (instant: Date, timeZone: string): LocalDateTime => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  const valueFor = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: valueFor("year"),
    month: valueFor("month"),
    day: valueFor("day"),
    hour: valueFor("hour"),
    minute: valueFor("minute")
  };
};

const sameLocalDateTime = (left: LocalDateTime, right: LocalDateTime): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute;

const offsetAt = (instant: Date, timeZone: string): number => {
  const parts = formatParts(instant, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - instant.getTime();
};

const resolveLocalInstant = (local: LocalDateTime, timeZone: string): Date | undefined => {
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const offsetSamples = [
    offsetAt(new Date(localAsUtc - 43_200_000), timeZone),
    offsetAt(new Date(localAsUtc), timeZone),
    offsetAt(new Date(localAsUtc + 43_200_000), timeZone)
  ];
  const candidates = [...new Set(offsetSamples)]
    .map((offset) => new Date(localAsUtc - offset))
    .filter((candidate) => sameLocalDateTime(formatParts(candidate, timeZone), local));
  return candidates.length === 1 ? candidates[0] : undefined;
};

const parseLocalTime = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  const clock = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? `${pad(hour)}:${pad(minute)}` : undefined;
  }
  const meridiem = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(normalized);
  if (!meridiem) return undefined;
  const originalHour = Number(meridiem[1]);
  const minute = meridiem[2] === undefined ? 0 : Number(meridiem[2]);
  if (originalHour < 1 || originalHour > 12 || minute > 59) return undefined;
  const hour = originalHour % 12 + (meridiem[3] === "pm" ? 12 : 0);
  return `${pad(hour)}:${pad(minute)}`;
};

const isExplicitDateTime = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  !Number.isNaN(Date.parse(value));

/**
 * Resolves only planner creation dates/times against a trusted Main-process
 * clock and IANA zone. It accepts no renderer-supplied clock or zone.
 */
export const createPlannerTemporalResolver = (dependencies: PlannerTemporalResolverDependencies) => {
  const resolveDate = (
    value: unknown,
    today: CalendarDate
  ): { ok: true; date: CalendarDate } | { ok: false; reason: PlannerTemporalResolutionReason } => {
    if (typeof value !== "string") return { ok: false, reason: "DATE_INVALID" };
    const normalized = normalizeSpanish(value).replace(/^el\s+/, "");
    const explicit = parseCalendarDate(normalized);
    if (explicit) {
      return compareCalendarDates(explicit, today) < 0
        ? { ok: false, reason: "DATE_PAST" }
        : { ok: true, date: explicit };
    }
    if (normalized === "hoy") return { ok: true, date: today };
    if (normalized === "manana") return { ok: true, date: addCalendarDays(today, 1) };
    const targetWeekday = weekdayByName[normalized];
    if (targetWeekday === undefined) return { ok: false, reason: "DATE_INVALID" };
    const currentWeekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    const daysAhead = (targetWeekday - currentWeekday + 7) % 7;
    return daysAhead === 0
      ? { ok: false, reason: "WEEKDAY_AMBIGUOUS" }
      : { ok: true, date: addCalendarDays(today, daysAhead) };
  };

  const resolveTaskInput = (
    input: UnknownRecord,
    now: Date,
    today: CalendarDate
  ): PlannerTemporalResolution => {
    if (input.dueDate === undefined && input.dueTime === undefined) return { ok: true, input };
    if (input.dueDate === undefined) return { ok: false, reason: "DATE_REQUIRED" };
    const date = resolveDate(input.dueDate, today);
    if (!date.ok) return date;
    const resolved: UnknownRecord = { ...input, dueDate: formatDate(date.date) };
    if (input.dueTime === undefined) return { ok: true, input: resolved };
    const time = parseLocalTime(input.dueTime);
    if (!time) return { ok: false, reason: "TIME_INVALID" };
    const [hour, minute] = time.split(":").map(Number);
    const nowLocal = formatParts(now, dependencies.timeZone());
    if (compareCalendarDates(date.date, today) === 0 && (hour < nowLocal.hour || (hour === nowLocal.hour && minute <= nowLocal.minute))) {
      return { ok: false, reason: "INSTANT_PAST" };
    }
    return { ok: true, input: { ...resolved, dueTime: time } };
  };

  const resolveInstantInput = (
    input: UnknownRecord,
    action: "CREATE_EVENT" | "CREATE_REMINDER",
    now: Date,
    today: CalendarDate
  ): PlannerTemporalResolution => {
    const instantKey = action === "CREATE_EVENT" ? "startAt" : "remindAt";
    const dateValue = input.date;
    const startTimeValue = action === "CREATE_EVENT" ? input.startTime ?? input.time : input.time;
    const endTimeValue = action === "CREATE_EVENT" ? input.endTime : undefined;
    const hasTemporalPair = dateValue !== undefined || startTimeValue !== undefined || endTimeValue !== undefined;
    if (!hasTemporalPair) {
      if (!isExplicitDateTime(input[instantKey])) return { ok: false, reason: "DATE_REQUIRED" };
      return Date.parse(input[instantKey]) <= now.getTime()
        ? { ok: false, reason: "INSTANT_PAST" }
        : { ok: true, input };
    }
    if (input[instantKey] !== undefined || (action === "CREATE_EVENT" && input.endAt !== undefined)) {
      return { ok: false, reason: "DATE_INVALID" };
    }
    if (dateValue === undefined) return { ok: false, reason: "DATE_REQUIRED" };
    if (startTimeValue === undefined) return { ok: false, reason: "TIME_REQUIRED" };
    if (action === "CREATE_EVENT" && input.startTime !== undefined && input.time !== undefined) {
      return { ok: false, reason: "TIME_INVALID" };
    }
    const date = resolveDate(dateValue, today);
    if (!date.ok) return date;
    const time = parseLocalTime(startTimeValue);
    if (!time) return { ok: false, reason: "TIME_INVALID" };
    const [hour, minute] = time.split(":").map(Number);
    const instant = resolveLocalInstant({ ...date.date, hour, minute }, dependencies.timeZone());
    if (!instant) return { ok: false, reason: "LOCAL_TIME_AMBIGUOUS" };
    if (instant.getTime() <= now.getTime()) return { ok: false, reason: "INSTANT_PAST" };
    const { date: _date, time: _time, startTime: _startTime, endTime: _endTime, ...remaining } = input;
    if (action === "CREATE_EVENT" && endTimeValue !== undefined) {
      const endTime = parseLocalTime(endTimeValue);
      if (!endTime) return { ok: false, reason: "TIME_INVALID" };
      const [endHour, endMinute] = endTime.split(":").map(Number);
      const endInstant = resolveLocalInstant({ ...date.date, hour: endHour, minute: endMinute }, dependencies.timeZone());
      if (!endInstant) return { ok: false, reason: "LOCAL_TIME_AMBIGUOUS" };
      if (endInstant.getTime() <= instant.getTime()) return { ok: false, reason: "TIME_RANGE_INVALID" };
      return {
        ok: true,
        input: { ...remaining, startAt: instant.toISOString(), endAt: endInstant.toISOString() }
      };
    }
    return { ok: true, input: { ...remaining, [instantKey]: instant.toISOString() } };
  };

  return {
    resolve(action: PlannerTemporalAction, input: unknown): PlannerTemporalResolution {
      if (!isRecord(input)) return { ok: false, reason: "DATE_INVALID" };
      const now = dependencies.now();
      if (Number.isNaN(now.getTime())) return { ok: false, reason: "DATE_INVALID" };
      let today: CalendarDate;
      try {
        today = formatParts(now, dependencies.timeZone());
      } catch {
        return { ok: false, reason: "DATE_INVALID" };
      }
      switch (action) {
        case "CREATE_TASK":
          return resolveTaskInput(input, now, today);
        case "CREATE_EVENT":
          return resolveInstantInput(input, action, now, today);
        case "CREATE_REMINDER":
          return resolveInstantInput(input, action, now, today);
      }
    }
  };
};
