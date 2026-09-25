import type { CalendarDayItems } from "./calendar-date-utils";
import { formatCalendarDay, formatEventLocalTime } from "./calendar-date-utils";

type CalendarDayDetailsProperties = {
  isoDate: string;
  items: CalendarDayItems;
};

export const CalendarDayDetails = ({ isoDate, items }: CalendarDayDetailsProperties) => <section aria-live="polite" className="calendar-day-details">
  <p className="eyebrow">Día seleccionado</p>
  <h2>{formatCalendarDay(isoDate)}</h2>
  {items.events.length === 0 && items.tasks.length === 0 && <p className="calendar-empty-day">No hay tareas ni eventos para este día.</p>}
  {items.events.map((event) => <p className="calendar-detail-item calendar-detail-item--event" key={event.id}><span>Evento</span>{formatEventLocalTime(event)} · {event.title}</p>)}
  {items.tasks.map((task) => <p className="calendar-detail-item calendar-detail-item--task" key={task.id}><span>Tarea</span>{task.dueTime ? `${task.dueTime} · ` : ""}{task.title}</p>)}
</section>;
