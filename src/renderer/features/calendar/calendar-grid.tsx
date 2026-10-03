import type { CalendarDay, CalendarDayItems } from "./calendar-date-utils";
import { CALENDAR_WEEKDAY_LABELS, formatEventLocalTime } from "./calendar-date-utils";

export const CALENDAR_DAY_ENTRY_LIMIT = 3;

type CalendarDayEntry = {
  id: string;
  kind: "EVENT" | "TASK";
  label: string;
  isCompleted?: boolean;
};

export const calendarDayEntries = (items: CalendarDayItems): CalendarDayEntry[] => [
  ...items.events.map((event) => ({
    id: event.id,
    kind: "EVENT" as const,
    label: `${formatEventLocalTime(event)} · ${event.title}`
  })),
  ...items.tasks.map((task) => ({
    id: task.id,
    kind: "TASK" as const,
    label: `${task.dueTime ? `${task.dueTime} · ` : ""}${task.title}`,
    isCompleted: task.status === "COMPLETED"
  }))
];

type CalendarGridProperties = {
  days: CalendarDay[];
  selectedDate: string;
  todayDate: string;
  itemsByDay: Map<string, CalendarDayItems>;
  onSelectDate: (isoDate: string) => void;
};

export const CalendarGrid = ({ days, selectedDate, todayDate, itemsByDay, onSelectDate }: CalendarGridProperties) => <>
  <div aria-hidden="true" className="calendar-weekdays">{CALENDAR_WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}</div>
  <div className="calendar-grid" role="grid">
    {days.map((day) => {
      const items = itemsByDay.get(day.isoDate) ?? { tasks: [], events: [] };
      const entries = calendarDayEntries(items);
      const visibleEntries = entries.slice(0, CALENDAR_DAY_ENTRY_LIMIT);
      const overflowCount = entries.length - visibleEntries.length;
      const itemSummary = `${items.events.length} eventos y ${items.tasks.length} tareas`;
      return <button
        aria-label={`${day.isoDate}: ${itemSummary}`}
        aria-current={day.isoDate === todayDate ? "date" : undefined}
        aria-selected={selectedDate === day.isoDate}
        className={`calendar-day${day.isCurrentMonth ? "" : " calendar-day--outside"}${entries.length > 0 ? " calendar-day--has-items" : ""}${selectedDate === day.isoDate ? " is-selected" : ""}${day.isoDate === todayDate ? " is-today" : ""}`}
        key={day.isoDate}
        onClick={() => onSelectDate(day.isoDate)}
        role="gridcell"
        type="button"
      >
        <span className="calendar-day__number">{day.date.getDate()}</span>
        <span className="calendar-day__entries">
          {visibleEntries.map((entry) => <span className={`calendar-day-entry calendar-day-entry--${entry.kind.toLowerCase()}${entry.isCompleted ? " is-completed" : ""}`} key={`${entry.kind}-${entry.id}`}>
            <span aria-hidden="true" className="calendar-day-entry__marker">{entry.kind === "EVENT" ? "E" : "T"}</span>
            <span>{entry.label}</span>
          </span>)}
          {overflowCount > 0 && <span aria-label={`${overflowCount} elementos más. Selecciona el día para verlos.`} className="calendar-day-entry calendar-day-entry--overflow">+{overflowCount} más</span>}
        </span>
      </button>;
    })}
  </div>
</>;
