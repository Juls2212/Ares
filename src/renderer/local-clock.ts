export const formatLocalClock = (date: Date): string => new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
}).format(date);
