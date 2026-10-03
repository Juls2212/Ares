import type { TodayScheduleData, WeeklyRoutineRecord } from "../../../shared/planner-contracts";
import type { WeeklyRoutineTimeBounds } from "./weekly-routine-utils";
import {
  findLargestWeeklyFreePeriod,
  formatWeeklyEventTime,
  formatWeeklyScheduleDuration,
  formatWeeklyScheduleHour,
  formatWeeklyTaskStatus,
  summarizeWeeklySchedule,
  type WeeklyScheduleTodayState,
  weekdayLabel
} from "./weekly-schedule-context";

type WeeklyScheduleContextSidebarProperties = {
  today: WeeklyScheduleTodayState;
  routines: WeeklyRoutineRecord[];
  visibleBounds: WeeklyRoutineTimeBounds;
};

const TodayItems = ({ data }: { data: TodayScheduleData }) => {
  const tasks = data.tasks.slice(0, 3);
  const events = data.events.slice(0, 3);
  if (tasks.length === 0 && events.length === 0) return <p className="weekly-context__empty">No hay tareas ni eventos para hoy.</p>;
  return <ul className="weekly-context__list">
    {tasks.map((task) => <li key={task.id}><span>Tarea · {formatWeeklyTaskStatus(task.status)}{task.dueTime ? ` · ${task.dueTime}` : ""}</span><strong>{task.title}</strong></li>)}
    {events.map((event) => {
      const time = formatWeeklyEventTime(event.startAt);
      return <li key={event.id}><span>Evento{time ? ` · ${time}` : ""}</span><strong>{event.title}</strong></li>;
    })}
  </ul>;
};

export const WeeklyScheduleContextSidebar = ({ today, routines, visibleBounds }: WeeklyScheduleContextSidebarProperties) => {
  const summary = summarizeWeeklySchedule(routines);
  const availability = findLargestWeeklyFreePeriod(routines, visibleBounds);

  return <aside aria-label="Contexto del horario" className="weekly-schedule-context">
    <section className="weekly-context-section" aria-label="Hoy">
      <h3>Hoy</h3>
      {today.kind === "LOADING" && <p className="weekly-context__empty" role="status">Cargando lo de hoy…</p>}
      {today.kind === "ERROR" && <p className="weekly-context__empty" role="status">No se pudo cargar lo de hoy.</p>}
      {today.kind === "READY" && <TodayItems data={today.data} />}
    </section>
    <section className="weekly-context-section" aria-label="Resumen del horario">
      <h3>Resumen del horario</h3>
      {!summary ? <p className="weekly-context__empty">No hay bloques en este horario.</p> : <dl className="weekly-context__summary"><div><dt>Bloques</dt><dd>{summary.blockCount}</dd></div><div><dt>Horas programadas</dt><dd>{formatWeeklyScheduleDuration(summary.totalMinutes)}</dd></div><div><dt>Mayor carga</dt><dd>{weekdayLabel(summary.busiestWeekday)}</dd></div></dl>}
    </section>
    <section className="weekly-context-section" aria-label="Disponibilidad">
      <h3>Disponibilidad</h3>
      {!availability ? <p className="weekly-context__empty">Añade bloques para estimar el tiempo libre.</p> : <><p className="weekly-context__availability">Tiempo libre estimado</p><p className="weekly-context__free-period"><strong>{weekdayLabel(availability.weekday)}</strong> · {formatWeeklyScheduleHour(availability.start)}–{formatWeeklyScheduleHour(availability.end)} · {formatWeeklyScheduleDuration(availability.durationMinutes)}</p></>}
    </section>
  </aside>;
};
