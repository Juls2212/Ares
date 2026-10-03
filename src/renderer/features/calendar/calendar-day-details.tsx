import type { EventRecord } from "../../../shared/planner-contracts";
import type { CalendarDayItems } from "./calendar-date-utils";
import { formatCalendarDay, formatEventLocalTime } from "./calendar-date-utils";
import { CalendarTaskActions } from "./calendar-task-actions";

type CalendarDayDetailsProperties = {
  isoDate: string;
  items: CalendarDayItems;
  selectedEventId?: string | null;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  onTaskRefresh?: () => void;
  onTaskDeleted?: () => void;
  onTaskBusyChange?: (busy: boolean) => void;
  onSelectEvent?: (eventId: string) => void;
  onRequestEventEdit?: (event: EventRecord, trigger: HTMLButtonElement) => void;
  onRequestEventDeletion?: (event: EventRecord, trigger: HTMLButtonElement) => void;
};

export const canDeleteLoadedCalendarEvents = (isLoading: boolean, eventError?: string): boolean =>
  !isLoading && !eventError;

export const resolveSelectedCalendarEvent = (items: CalendarDayItems, selectedEventId?: string | null): EventRecord | undefined =>
  items.events.find((event) => event.id === selectedEventId);

export const CalendarDayDetails = ({ isoDate, items, selectedEventId, selectedTaskId, onSelectTask, onTaskRefresh, onTaskDeleted, onTaskBusyChange, onSelectEvent, onRequestEventEdit, onRequestEventDeletion }: CalendarDayDetailsProperties) => {
  const selectedEvent = resolveSelectedCalendarEvent(items, selectedEventId);
  return <section aria-live="polite" className="calendar-day-details">
  <p className="eyebrow">Día seleccionado</p>
  <h2>{formatCalendarDay(isoDate)}</h2>
  {items.events.length === 0 && items.tasks.length === 0 && <p className="calendar-empty-day">No hay tareas ni eventos para este día.</p>}
  <div className="calendar-event-list">
  {items.events.length > 0 && <section className="calendar-details-group" aria-label="Eventos">
    <h3>Eventos</h3>
    {items.events.map((event) => <div className="calendar-detail-item calendar-detail-item--event" key={event.id}>
    <span>Evento</span>
    {onSelectEvent
      ? <button aria-pressed={selectedEvent?.id === event.id} className={`calendar-event-select${selectedEvent?.id === event.id ? " is-selected" : ""}`} onClick={() => onSelectEvent(event.id)} type="button">{formatEventLocalTime(event)} · {event.title}</button>
      : <p>{formatEventLocalTime(event)} · {event.title}</p>}
    {selectedEvent?.id === event.id && onSelectEvent && <div className="calendar-event-actions">
      {onRequestEventEdit && <button aria-label={`Editar evento: ${event.title}`} className="calendar-event-edit-trigger" onClick={(clickEvent) => onRequestEventEdit(event, clickEvent.currentTarget)} type="button">Editar</button>}
      {onRequestEventDeletion && <button aria-label={`Eliminar evento: ${event.title}`} className="calendar-event-delete-trigger" onClick={(clickEvent) => onRequestEventDeletion(event, clickEvent.currentTarget)} type="button">Eliminar</button>}
    </div>}
    </div>)}
  </section>}
  {items.tasks.length > 0 && <section className="calendar-details-group" aria-label="Tareas">
    <h3>Tareas</h3>
    {items.tasks.map((task) => <div className="calendar-detail-item calendar-detail-item--task" key={task.id}>
    <span>Tarea{task.status === "COMPLETED" ? " · Completada" : ""}</span>
    {onSelectTask ? <button type="button" aria-pressed={selectedTaskId === task.id} className={`calendar-event-select${selectedTaskId === task.id ? " is-selected" : ""}`} onClick={() => onSelectTask(task.id)}>{task.dueTime ? `${task.dueTime} · ` : ""}{task.title}</button>
      : <p>{task.dueTime ? `${task.dueTime} · ` : ""}{task.title}</p>}
    {selectedTaskId === task.id && onSelectTask && onTaskRefresh && onTaskDeleted && onTaskBusyChange && <CalendarTaskActions task={task} onRefresh={onTaskRefresh} onDeleted={onTaskDeleted} onBusyChange={onTaskBusyChange} />}
    </div>)}
  </section>}
  </div>
</section>;
};
