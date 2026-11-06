import type { ReactNode } from "react";
import type { EventRecord, TaskRecord } from "../../../shared/planner-contracts";
import type { CalendarDayItems } from "./calendar-date-utils";
import { addLocalCalendarDays, formatCalendarDateHeading, formatEventLocalTime, localCalendarDateForEvent } from "./calendar-date-utils";

type DateViewProperties = {
  selectedDate: string;
  itemsByDay: Map<string, CalendarDayItems>;
  tasks: TaskRecord[];
  events: EventRecord[];
};

const taskMeta = (task: TaskRecord): string => `${task.priority === "HIGH" ? "Prioridad alta" : task.priority === "MEDIUM" ? "Prioridad media" : "Prioridad baja"} · ${task.status === "COMPLETED" ? "Completada" : "Pendiente"}${task.dueTime ? ` · ${task.dueTime}` : ""}`;
const eventTime = (event: EventRecord): string => `${formatEventLocalTime(event)}${event.endAt ? `–${formatEventLocalTime({ ...event, startAt: event.endAt })}` : ""}`;

const Entries = ({ items }: { items: CalendarDayItems }) => <>
  {items.events.map((event) => <article className="calendar-date-entry calendar-date-entry--event" key={event.id}><p>{eventTime(event)}</p><h3>{event.title}</h3>{event.location && <span>{event.location}</span>}</article>)}
  {items.tasks.map((task) => <article className={`calendar-date-entry calendar-date-entry--task${task.status === "COMPLETED" ? " is-completed" : ""}`} key={task.id}><p>{taskMeta(task)}</p><h3>{task.title}</h3></article>)}
</>;

export const CalendarDayView = ({ selectedDate, itemsByDay, details }: Pick<DateViewProperties, "selectedDate" | "itemsByDay"> & { details?: ReactNode }) => {
  const items = itemsByDay.get(selectedDate) ?? { tasks: [], events: [] };
  return <section aria-label="Vista diaria" className="calendar-date-view calendar-day-view">
    <header><p className="eyebrow">Día</p><h2>{formatCalendarDateHeading(selectedDate)}</h2></header>
    <div className="calendar-date-view__entries">
      {details ?? (items.events.length === 0 && items.tasks.length === 0 ? <p className="calendar-status calendar-status--empty">No hay tareas ni eventos para este día.</p> : <Entries items={items} />)}
    </div>
  </section>;
};

export const CalendarWeekView = ({ selectedDate, itemsByDay }: Pick<DateViewProperties, "selectedDate" | "itemsByDay">) => {
  const dates = Array.from({ length: 7 }, (_, index) => addLocalCalendarDays(selectedDate, index));
  return <section aria-label="Vista semanal" className="calendar-date-view calendar-week-view">
    <div className="calendar-week-view__grid">
      {dates.map((date) => {
        const items = itemsByDay.get(date) ?? { tasks: [], events: [] };
        return <section className="calendar-week-day" key={date}><header><p>{new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "")}</p><h3>{date.slice(-2)}</h3></header>
          <div className="calendar-week-day__events">{items.events.map((event) => <article className="calendar-week-event" key={event.id}><span>{eventTime(event)}</span>{event.title}</article>)}</div>
          <div className="calendar-week-day__tasks">{items.tasks.map((task) => <p key={task.id}>• {task.dueTime ? `${task.dueTime} · ` : ""}{task.title}</p>)}</div>
        </section>;
      })}
    </div>
  </section>;
};

export const CalendarAgendaView = ({ selectedDate, itemsByDay }: Pick<DateViewProperties, "selectedDate" | "itemsByDay">) => {
  const dates = Array.from({ length: 14 }, (_, index) => addLocalCalendarDays(selectedDate, index));
  const populated = dates.filter((date) => {
    const items = itemsByDay.get(date);
    return items && (items.tasks.length > 0 || items.events.length > 0);
  });
  return <section aria-label="Agenda" className="calendar-date-view calendar-agenda-view">
    <header><p className="eyebrow">Agenda</p><h2>Próximos 14 días</h2></header>
    {populated.length === 0 ? <p className="calendar-status calendar-status--empty">No hay tareas ni eventos próximos.</p> : populated.map((date) => <section className="calendar-agenda-day" key={date}><h3>{formatCalendarDateHeading(date)}</h3><Entries items={itemsByDay.get(date)!} /></section>)}
  </section>;
};
