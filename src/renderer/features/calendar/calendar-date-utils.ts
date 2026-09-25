import type { EventRecord, TaskRecord } from "../../../shared/planner-contracts";

export type CalendarDay = {
  date: Date;
  isoDate: string;
  isCurrentMonth: boolean;
};

export type CalendarDayItems = {
  events: EventRecord[];
  tasks: TaskRecord[];
};

export const CALENDAR_WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

const pad = (value: number): string => value.toString().padStart(2, "0");

export const toLocalCalendarDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const toLocalDateTimeWithOffset = (date: Date): string => {
  const timezoneOffset = -date.getTimezoneOffset();
  const offsetHours = pad(Math.floor(Math.abs(timezoneOffset) / 60));
  const offsetMinutes = pad(Math.abs(timezoneOffset) % 60);
  const offsetSign = timezoneOffset >= 0 ? "+" : "-";
  return `${toLocalCalendarDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offsetSign}${offsetHours}:${offsetMinutes}`;
};

export const monthStartFor = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

export const nextMonthStartFor = (monthStart: Date): Date =>
  new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

export const firstSelectedDateForMonth = (monthStart: Date, today: Date): string =>
  today.getFullYear() === monthStart.getFullYear() && today.getMonth() === monthStart.getMonth()
    ? toLocalCalendarDate(today)
    : toLocalCalendarDate(monthStart);

export const createMonthGrid = (monthStart: Date): CalendarDay[] => {
  const mondayFirstOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - mondayFirstOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    return {
      date,
      isoDate: toLocalCalendarDate(date),
      isCurrentMonth: date.getMonth() === monthStart.getMonth()
    };
  });
};

export const localCalendarDateForEvent = (event: EventRecord): string =>
  toLocalCalendarDate(new Date(event.startAt));

const compareTasks = (left: TaskRecord, right: TaskRecord): number =>
  (left.dueTime ?? "99:99").localeCompare(right.dueTime ?? "99:99") || left.title.localeCompare(right.title);

const compareEvents = (left: EventRecord, right: EventRecord): number =>
  left.startAt.localeCompare(right.startAt) || left.title.localeCompare(right.title);

export const groupCalendarRecordsByDay = (
  tasks: TaskRecord[],
  events: EventRecord[]
): Map<string, CalendarDayItems> => {
  const grouped = new Map<string, CalendarDayItems>();
  const ensureDay = (isoDate: string): CalendarDayItems => {
    const existing = grouped.get(isoDate);
    if (existing) return existing;
    const created = { tasks: [], events: [] };
    grouped.set(isoDate, created);
    return created;
  };

  for (const task of tasks) {
    if (!task.dueDate) continue;
    ensureDay(task.dueDate).tasks.push(task);
  }
  for (const event of events) ensureDay(localCalendarDateForEvent(event)).events.push(event);
  for (const items of grouped.values()) {
    items.tasks.sort(compareTasks);
    items.events.sort(compareEvents);
  }
  return grouped;
};

export const formatCalendarMonth = (monthStart: Date): string =>
  new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(monthStart);

export const formatCalendarDay = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(year, month - 1, day));
};

export const formatEventLocalTime = (event: EventRecord): string =>
  new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.startAt));
