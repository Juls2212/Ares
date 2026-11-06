import type { AresTodayState } from "./ares-today-summary";
import { formatAresEventTime, formatAresReminderTime } from "./ares-today-summary";
import { AresMiniCalendar } from "./ares-mini-calendar";
import { LocalClock } from "./local-clock";
import type { AresHabitSummaryState } from "./ares-habit-summary";
import { HabitIconGlyph } from "../calendar/habit-icons";

type AresInformationPanelsProperties = {
  today: AresTodayState;
  habits?: AresHabitSummaryState;
};

const HabitSummary = ({ habits }: { habits?: AresHabitSummaryState }) => {
  if (!habits || habits.kind === "LOADING") return <section aria-label="Hábitos de hoy" className="today-summary-group today-habit-summary"><p className="panel-section-label">Hábitos de hoy</p><p className="panel-message">Cargando hábitos…</p></section>;
  if (habits.kind === "ERROR") return <section aria-label="Hábitos de hoy" className="today-summary-group today-habit-summary"><p className="panel-section-label">Hábitos de hoy</p><p className="panel-message">No se pudieron cargar los hábitos.</p></section>;
  if (habits.data.totalCount === 0) return <section aria-label="Hábitos de hoy" className="today-summary-group today-habit-summary"><p className="panel-section-label">Hábitos de hoy</p><p className="panel-message">No tienes hábitos activos para hoy.</p></section>;
  const progress = Math.round((habits.data.completedCount / habits.data.totalCount) * 100);
  return <section aria-label="Hábitos de hoy" className="today-summary-group today-habit-summary"><p className="panel-section-label">Hábitos de hoy</p><p className="today-progress-value"><strong>{habits.data.completedCount}</strong> de {habits.data.totalCount} completados</p><div aria-label={`${habits.data.completedCount} de ${habits.data.totalCount} hábitos completados`} aria-valuemax={habits.data.totalCount} aria-valuemin={0} aria-valuenow={habits.data.completedCount} className="today-progress-bar" role="progressbar"><span style={{ width: `${progress}%` }} /></div>{habits.data.pending.length > 0 && <ul className="today-habit-summary__pending">{habits.data.pending.map((item) => <li key={item.habit.id}><HabitIconGlyph icon={item.habit.icon} /><span>{item.habit.title}</span></li>)}</ul>}</section>;
};

const TodaySummary = ({ today, habits }: AresInformationPanelsProperties) => {
  if (today.kind === "LOADING") return <div className="today-summary-groups"><p className="panel-message">Cargando resumen de hoy…</p><HabitSummary habits={habits} /></div>;
  if (today.kind === "ERROR") return <div className="today-summary-groups"><p className="panel-message">No se pudo cargar el resumen.</p><HabitSummary habits={habits} /></div>;

  const totalTasks = today.data.pendingTasks + today.data.completedTasks;
  const completedPercentage = totalTasks === 0 ? 0 : Math.round((today.data.completedTasks / totalTasks) * 100);
  const reminderTime = today.data.nextReminder && formatAresReminderTime(today.data.nextReminder);

  return <div className="today-summary-groups">
    <section className="today-summary-group" aria-label="Progreso de hoy">
      <p className="panel-section-label">Progreso de hoy</p>
      {totalTasks === 0
        ? <p className="panel-message">No tienes tareas para hoy.</p>
        : <>
          <p className="today-progress-value"><strong>{today.data.completedTasks}</strong> de {totalTasks} completadas</p>
          <div aria-label={`${today.data.completedTasks} de ${totalTasks} tareas completadas`} aria-valuemax={totalTasks} aria-valuemin={0} aria-valuenow={today.data.completedTasks} className="today-progress-bar" role="progressbar">
            <span style={{ width: `${completedPercentage}%` }} />
          </div>
        </>}
    </section>
    <section className="today-summary-group" aria-label="Prioridad actual">
      <p className="panel-section-label">Prioridad actual</p>
      {today.data.currentHighPriorityTask
        ? <p className="priority-task-title">{today.data.currentHighPriorityTask.title}</p>
        : <p className="panel-message">No tienes tareas de prioridad alta pendientes.</p>}
    </section>
    <section className="today-summary-group" aria-label="Próximo recordatorio">
      <p className="panel-section-label">Próximo recordatorio</p>
      {today.data.nextReminder
        ? <p className="next-reminder"><span>{today.data.nextReminder.title}</span>{reminderTime && <time dateTime={today.data.nextReminder.remindAt}>{reminderTime}</time>}</p>
        : <p className="panel-message">No tienes recordatorios próximos.</p>}
    </section>
    <HabitSummary habits={habits} />
  </div>;
};

const UpcomingEvents = ({ today }: AresInformationPanelsProperties) => {
  if (today.kind === "LOADING") return <p className="panel-message">Cargando eventos…</p>;
  if (today.kind === "ERROR") return <p className="panel-message">No se pudieron cargar los eventos.</p>;
  if (today.data.upcomingEvents.length === 0) return <p className="panel-message">No tienes eventos próximos.</p>;

  return <ol className="upcoming-events">
    {today.data.upcomingEvents.map((event) => {
      const time = formatAresEventTime(event);
      return <li key={event.id}>
        {time && <time dateTime={event.startAt}>{time}</time>}
        <span>{event.title}</span>
      </li>;
    })}
  </ol>;
};

export const AresTodaySummaryPanel = ({ today, habits }: AresInformationPanelsProperties) => (
  <aside className="support-panel support-panel--left">
    <p className="eyebrow">Resumen de hoy</p>
    <p className="support-note support-note--product">Ares es tu centro personal para organizar tareas y eventos.</p>
    <TodaySummary habits={habits} today={today} />
  </aside>
);

export const AresUpcomingEventsPanel = ({ today }: AresInformationPanelsProperties) => (
  <aside className="support-panel support-panel--right">
    <p className="eyebrow">Próximos eventos</p>
    <UpcomingEvents today={today} />
    <LocalClock />
    <AresMiniCalendar />
  </aside>
);

export const AresInformationPanels = ({ today, habits }: AresInformationPanelsProperties) => <>
  <AresTodaySummaryPanel habits={habits} today={today} />
  <AresUpcomingEventsPanel today={today} />
</>;
