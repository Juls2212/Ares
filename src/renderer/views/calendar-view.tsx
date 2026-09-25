import { useEffect, useMemo, useState } from "react";

import { CalendarDayDetails } from "../features/calendar/calendar-day-details";
import { loadCalendarData, type CalendarLoadData } from "../features/calendar/calendar-data";
import {
  createMonthGrid,
  firstSelectedDateForMonth,
  formatCalendarMonth,
  groupCalendarRecordsByDay,
  monthStartFor,
  nextMonthStartFor,
  toLocalCalendarDate
} from "../features/calendar/calendar-date-utils";
import { CalendarGrid } from "../features/calendar/calendar-grid";

const emptyCalendarData: CalendarLoadData = { tasks: [], events: [] };

export const CalendarView = () => {
  const [displayedMonth, setDisplayedMonth] = useState(() => monthStartFor(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => firstSelectedDateForMonth(monthStartFor(new Date()), new Date()));
  const [calendarData, setCalendarData] = useState<CalendarLoadData>(emptyCalendarData);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let current = true;
    setIsLoading(true);
    void loadCalendarData(window.ares?.planner, displayedMonth)
      .then((data) => {
        if (current) setCalendarData(data);
      })
      .catch(() => {
        if (current) setCalendarData({
          tasks: [],
          events: [],
          taskError: "No se pudieron cargar las tareas del calendario.",
          eventError: "No se pudieron cargar los eventos del calendario."
        });
      })
      .finally(() => {
        if (current) setIsLoading(false);
      });
    return () => { current = false; };
  }, [displayedMonth]);

  const days = useMemo(() => createMonthGrid(displayedMonth), [displayedMonth]);
  const itemsByDay = useMemo(
    () => groupCalendarRecordsByDay(calendarData.tasks, calendarData.events),
    [calendarData.events, calendarData.tasks]
  );
  const selectedItems = itemsByDay.get(selectedDate) ?? { tasks: [], events: [] };
  const hasRecords = calendarData.tasks.length > 0 || calendarData.events.length > 0;

  const showMonth = (month: Date): void => {
    const normalizedMonth = monthStartFor(month);
    setDisplayedMonth(normalizedMonth);
    setSelectedDate(firstSelectedDateForMonth(normalizedMonth, new Date()));
  };

  const showToday = (): void => {
    const today = new Date();
    setDisplayedMonth(monthStartFor(today));
    setSelectedDate(toLocalCalendarDate(today));
  };

  return <section aria-label="Calendario" className="calendar-shell">
    <header className="calendar-header">
      <div><p className="eyebrow">Planificación</p><h1>{formatCalendarMonth(displayedMonth)}</h1></div>
      <div aria-label="Navegación del calendario" className="calendar-controls">
        <button onClick={() => showMonth(new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1))} type="button">Mes anterior</button>
        <button onClick={showToday} type="button">Hoy</button>
        <button onClick={() => showMonth(nextMonthStartFor(displayedMonth))} type="button">Mes siguiente</button>
      </div>
    </header>

    {isLoading && <p className="calendar-status" role="status">Cargando calendario...</p>}
    {calendarData.taskError && <p className="calendar-status calendar-status--error">{calendarData.taskError}</p>}
    {calendarData.eventError && <p className="calendar-status calendar-status--error">{calendarData.eventError}</p>}
    {!isLoading && !hasRecords && !calendarData.taskError && !calendarData.eventError && <p className="calendar-status">No hay tareas ni eventos para este mes.</p>}

    <CalendarGrid days={days} itemsByDay={itemsByDay} onSelectDate={setSelectedDate} selectedDate={selectedDate} />
    <CalendarDayDetails isoDate={selectedDate} items={selectedItems} />
  </section>;
};
