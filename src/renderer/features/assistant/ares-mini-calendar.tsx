import { useEffect, useMemo, useState } from "react";

export const MINI_CALENDAR_WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"] as const;

export type MiniCalendarDay = {
  day: number;
  isToday: boolean;
};

const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const formatMiniCalendarMonth = (date: Date): string => {
  return new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(date);
};

export const createMiniCalendarGrid = (today: Date): Array<MiniCalendarDay | undefined> => {
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const day = index - mondayOffset + 1;
    if (day < 1 || day > daysInMonth) return undefined;
    return { day, isToday: day === today.getDate() };
  });
};

export const millisecondsUntilNextLocalDay = (now: Date): number => {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, tomorrow.getTime() - now.getTime());
};

/** Displays the local month and refreshes only after the local day changes. */
export const AresMiniCalendar = () => {
  const [today, setToday] = useState(() => startOfLocalDay(new Date()));
  const days = useMemo(() => createMiniCalendarGrid(today), [today]);
  const monthLabel = formatMiniCalendarMonth(today);

  useEffect(() => {
    const timeout = window.setTimeout(() => setToday(startOfLocalDay(new Date())), millisecondsUntilNextLocalDay(new Date()));
    return () => window.clearTimeout(timeout);
  }, [today]);

  return <section aria-label={`Calendario de ${monthLabel}`} className="ares-mini-calendar">
    <p className="ares-mini-calendar__month">{monthLabel}</p>
    <div aria-hidden="true" className="ares-mini-calendar__weekdays">
      {MINI_CALENDAR_WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
    </div>
    <div aria-label={monthLabel} className="ares-mini-calendar__grid" role="grid">
      {days.map((day, index) => day
        ? <span aria-current={day.isToday ? "date" : undefined} className={day.isToday ? "is-today" : undefined} key={index} role="gridcell">{day.day}</span>
        : <span aria-hidden="true" key={index} />)}
    </div>
  </section>;
};
