import type { EventRecord, PlannerApi, UpdateEventInput } from "../../../shared/planner-contracts";

export type CalendarEventEditValues = { title: string; description: string; startAt: string; endAt: string; location: string };
export const localEventEditTime = (instant: string): string => {
  const date = new Date(instant);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
export const eventEditValues = (event: EventRecord): CalendarEventEditValues => ({
  title: event.title, description: event.description ?? "", startAt: localEventEditTime(event.startAt),
  endAt: event.endAt ? localEventEditTime(event.endAt) : "", location: event.location ?? ""
});
const resolveTime = (value: string, original: string | null): string | null => {
  if (original && value === localEventEditTime(original)) return original;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && localEventEditTime(date.toISOString()) === value ? date.toISOString() : null;
};
export const saveCalendarEventEdit = async (planner: PlannerApi | undefined, event: EventRecord, values: CalendarEventEditValues): Promise<{ saved: boolean; message?: string }> => {
  const startAt = resolveTime(values.startAt, event.startAt);
  const endAt = values.endAt ? resolveTime(values.endAt, event.endAt) : null;
  if (!values.title.trim()) return { saved: false, message: "Escribe un título para el evento." };
  if (!startAt || (values.endAt && !endAt)) return { saved: false, message: "Revisa la fecha y la hora del evento." };
  if (endAt && new Date(endAt) <= new Date(startAt)) return { saved: false, message: "El fin debe ser posterior al inicio." };
  const input: UpdateEventInput = { eventId: event.id, title: values.title, description: values.description || null, startAt, endAt, location: values.location || null };
  try {
    if (!planner) return { saved: false, message: "No se pudo guardar el evento. Inténtalo de nuevo." };
    const result = await planner.events.update(input);
    if (result.ok) return { saved: true };
    return { saved: false, message: result.error.code === "PLANNER_NOT_FOUND" ? "El evento ya no está disponible. Actualiza el calendario." : "No se pudo guardar el evento. Revisa los campos e inténtalo de nuevo." };
  } catch {
    return { saved: false, message: "No se pudo guardar el evento. Inténtalo de nuevo." };
  }
};
