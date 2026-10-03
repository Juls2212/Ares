import { useEffect, useState } from "react";

type ClockDependencies = {
  now: () => Date;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (handle: number) => void;
};

export const formatLocalClockTime = (date: Date): string =>
  new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);

export const formatLocalClockDate = (date: Date): string =>
  new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(date);

const localClockDisplay = (date: Date): { time: string; date: string } => ({
  time: formatLocalClockTime(date),
  date: formatLocalClockDate(date)
});

/** Refreshes a display-only renderer clock once per minute and releases its timer. */
export const createLocalClockUpdater = (
  onUpdate: (time: string) => void,
  overrides: Partial<ClockDependencies> = {}
): (() => void) => {
  const dependencies: ClockDependencies = {
    now: overrides.now ?? (() => new Date()),
    setInterval: overrides.setInterval ?? ((callback, delay) => window.setInterval(callback, delay)),
    clearInterval: overrides.clearInterval ?? ((handle) => window.clearInterval(handle))
  };
  const update = (): void => onUpdate(formatLocalClockTime(dependencies.now()));
  update();
  const handle = dependencies.setInterval(update, 60_000);
  return () => dependencies.clearInterval(handle);
};

export const LocalClock = () => {
  const [display, setDisplay] = useState(() => localClockDisplay(new Date()));

  useEffect(() => createLocalClockUpdater((time) => {
    const now = new Date();
    setDisplay({ time, date: formatLocalClockDate(now) });
  }), []);

  return <section aria-label={`Hora local: ${display.time}, ${display.date}`} className="local-clock">
    <time className="local-clock__time">{display.time}</time>
    <span aria-hidden="true" className="local-clock__separator" />
    <span className="local-clock__date">{display.date}</span>
  </section>;
};
