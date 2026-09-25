import type { CalendarDay, CalendarDayItems } from "./calendar-date-utils";
import { CALENDAR_WEEKDAY_LABELS } from "./calendar-date-utils";

type CalendarGridProperties = {
  days: CalendarDay[];
  selectedDate: string;
  itemsByDay: Map<string, CalendarDayItems>;
  onSelectDate: (isoDate: string) => void;
};

export const CalendarGrid = ({ days, selectedDate, itemsByDay, onSelectDate }: CalendarGridProperties) => <>
  <div aria-hidden="true" className="calendar-weekdays">{CALENDAR_WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}</div>
  <div className="calendar-grid" role="grid">
    {days.map((day) => {
      const items = itemsByDay.get(day.isoDate) ?? { tasks: [], events: [] };
      const itemSummary = `${items.events.length} eventos y ${items.tasks.length} tareas`;
      return <button
        aria-label={`${day.isoDate}: ${itemSummary}`}
        aria-selected={selectedDate === day.isoDate}
        className={`calendar-day${day.isCurrentMonth ? "" : " calendar-day--outside"}${selectedDate === day.isoDate ? " is-selected" : ""}`}
        key={day.isoDate}
        onClick={() => onSelectDate(day.isoDate)}
        role="gridcell"
        type="button"
      >
        <span className="calendar-day__number">{day.date.getDate()}</span>
        <span className="calendar-day__markers">
          {items.events.length > 0 && <span aria-label={`${items.events.length} eventos`} className="calendar-marker calendar-marker--event">E {items.events.length}</span>}
          {items.tasks.length > 0 && <span aria-label={`${items.tasks.length} tareas`} className="calendar-marker calendar-marker--task">T {items.tasks.length}</span>}
        </span>
      </button>;
    })}
  </div>
</>;
