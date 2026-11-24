import type { TodayScheduleData } from "../../shared/planner-contracts";
import { spokenAt } from "../../shared/spanish-time";

/**
 * The words of an agenda answer. They contain the person's own titles, so they exist only for the spoken and on-screen
 * response: the persisted history row keeps one fixed sentence and never receives this text.
 */
export const SPOKEN_AGENDA_ITEMS = 5;
export const DISPLAYED_AGENDA_ITEMS = 12;
export const MAX_AGENDA_TITLE_CHARACTERS = 60;

export type AgendaTexts = { display: string; spoken: string };

type AgendaItem = { minutes: number | undefined; text: string };

const localTime = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));

const localDate = (instant: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

const toMinutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const cleanTitle = (title: string): string => {
  const single = title.replace(/\s+/gu, " ").trim();
  return single.length > MAX_AGENDA_TITLE_CHARACTERS ? `${single.slice(0, MAX_AGENDA_TITLE_CHARACTERS - 1).trimEnd()}…` : single;
};

/** «Hoy», «Mañana», «Pasado mañana», or «El viernes 14 de marzo» for a day further away. */
export const dayLabel = (day: string, now: Date, timeZone: string): string => {
  const today = localDate(now, timeZone);
  const difference = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (difference === 0) return "Hoy";
  if (difference === 1) return "Mañana";
  if (difference === 2) return "Pasado mañana";
  const text = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
  return `El ${text.replace(",", "")}`;
};

const buildItems = (schedule: TodayScheduleData, timeZone: string): AgendaItem[] => {
  const items: AgendaItem[] = [];
  for (const event of schedule.events) {
    const time = localTime(event.startAt, timeZone);
    items.push({ minutes: toMinutes(time), text: `${spokenAt(time)}, ${cleanTitle(event.title)}` });
  }
  for (const task of schedule.tasks) {
    const time = task.dueTime ? task.dueTime.slice(0, 5) : undefined;
    items.push(time
      ? { minutes: toMinutes(time), text: `${spokenAt(time)}, la tarea ${cleanTitle(task.title)}` }
      : { minutes: undefined, text: `la tarea ${cleanTitle(task.title)}` });
  }
  for (const reminder of schedule.reminders) {
    const time = localTime(reminder.remindAt, timeZone);
    items.push({ minutes: toMinutes(time), text: `un recordatorio ${spokenAt(time)}, ${cleanTitle(reminder.title)}` });
  }
  // Timed items first, in order; items without a time follow.
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (left.item.minutes ?? Number.POSITIVE_INFINITY) - (right.item.minutes ?? Number.POSITIVE_INFINITY) || left.index - right.index)
    .map(({ item }) => item);
};

const sentenceFor = (day: string, items: AgendaItem[], limit: number): string => {
  const shown = items.slice(0, limit).map((item) => item.text);
  const rest = items.length - shown.length;
  if (rest > 0) shown.push(`${rest} más`);
  const list = shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join("; ")}; y ${shown[shown.length - 1]}`;
  const count = items.length === 1 ? "una cosa" : `${items.length} cosas`;
  return `${day} tienes ${count}: ${list}.`;
};

/** The on-screen text (up to 12 items) and the spoken text (up to 5, then «y N más») for one day. */
export const describeSchedule = (schedule: TodayScheduleData, now: Date, timeZone: string): AgendaTexts => {
  const day = dayLabel(schedule.localDate, now, timeZone);
  const items = buildItems(schedule, timeZone);
  if (items.length === 0) {
    const empty = `${day} no tienes nada programado.`;
    return { display: empty, spoken: empty };
  }
  return { display: sentenceFor(day, items, DISPLAYED_AGENDA_ITEMS), spoken: sentenceFor(day, items, SPOKEN_AGENDA_ITEMS) };
};
