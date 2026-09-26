import { useEffect, useMemo, useRef, useState } from "react";
import type { EventRecord } from "../../shared/planner-contracts";

import { CalendarDayDetails, canDeleteLoadedCalendarEvents, resolveSelectedCalendarEvent } from "../features/calendar/calendar-day-details";
import { loadCalendarData, type CalendarLoadData } from "../features/calendar/calendar-data";
import { CalendarEventDeleteDialog } from "../features/calendar/calendar-event-delete-dialog";
import { CalendarEventEditDialog } from "../features/calendar/calendar-event-edit-dialog";
import { saveCalendarEventEdit } from "../features/calendar/calendar-event-editing";
import {
  cancelCalendarEventDeletion,
  confirmCalendarEventDeletion,
  requestCalendarEventDeletion
} from "../features/calendar/calendar-event-deletion";
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
  const [reloadVersion, setReloadVersion] = useState(0);
  const [eventToDelete, setEventToDelete] = useState<EventRecord | null>(null);
  const [eventToEdit, setEventToEdit] = useState<EventRecord | null>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreEditFocus = useRef(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const taskActionBusy = useRef(false);
  const [deletionConfirmationId, setDeletionConfirmationId] = useState<string | null>(null);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [isCancellingDeletion, setIsCancellingDeletion] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const deletionInFlight = useRef(false);
  const deletionTrigger = useRef<HTMLButtonElement | null>(null);
  const focusRail = useRef<HTMLElement | null>(null);
  const focusAfterClosing = useRef<"trigger" | "rail" | null>(null);

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
  }, [displayedMonth, reloadVersion]);

  useEffect(() => {
    if (eventToDelete || !focusAfterClosing.current) return;
    const target = focusAfterClosing.current === "trigger" && deletionTrigger.current?.isConnected
      ? deletionTrigger.current
      : focusRail.current;
    target?.focus();
    focusAfterClosing.current = null;
  }, [eventToDelete]);

  useEffect(() => {
    if (eventToEdit || !restoreEditFocus.current) return;
    (editTrigger.current?.isConnected ? editTrigger.current : focusRail.current)?.focus();
    restoreEditFocus.current = false;
  }, [eventToEdit]);

  useEffect(() => {
    const clearOutsideSelection = (click: MouseEvent): void => {
      if (eventToEdit || eventToDelete || deletionInFlight.current || taskActionBusy.current) return;
      const list = focusRail.current?.querySelector(".calendar-event-list");
      if (click.target instanceof Node && !list?.contains(click.target)) { setSelectedEventId(null); setSelectedTaskId(null); }
    };
    document.addEventListener("click", clearOutsideSelection);
    return () => document.removeEventListener("click", clearOutsideSelection);
  }, [eventToEdit, eventToDelete]);

  const days = useMemo(() => createMonthGrid(displayedMonth), [displayedMonth]);
  const itemsByDay = useMemo(
    () => groupCalendarRecordsByDay(calendarData.tasks, calendarData.events),
    [calendarData.events, calendarData.tasks]
  );
  const selectedItems = itemsByDay.get(selectedDate) ?? { tasks: [], events: [] };
  const eventActionsAvailable = canDeleteLoadedCalendarEvents(isLoading, calendarData.eventError) && !calendarData.taskError;
  useEffect(() => {
    if (!isLoading && (!eventActionsAvailable || !resolveSelectedCalendarEvent(selectedItems, selectedEventId))) setSelectedEventId(null);
  }, [isLoading, eventActionsAvailable, selectedItems, selectedEventId]);
  useEffect(() => {
    if (!isLoading && (!eventActionsAvailable || !selectedItems.tasks.some((task) => task.id === selectedTaskId))) setSelectedTaskId(null);
  }, [isLoading, eventActionsAvailable, selectedItems, selectedTaskId]);
  useEffect(() => { setSelectedEventId(null); setSelectedTaskId(null); }, [selectedDate]);
  const hasRecords = calendarData.tasks.length > 0 || calendarData.events.length > 0;
  const todayDate = toLocalCalendarDate(new Date());

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

  const requestEventDeletion = async (event: EventRecord, trigger: HTMLButtonElement): Promise<void> => {
    if (deletionInFlight.current) return;
    deletionInFlight.current = true;
    deletionTrigger.current = trigger;
    setDeletionError(null);
    const result = await requestCalendarEventDeletion(window.ares?.planner, event.id);
    deletionInFlight.current = false;
    if (!result.ready) {
      setDeletionError(result.message);
      return;
    }
    setDeletionConfirmationId(result.confirmationId);
    setEventToDelete(event);
  };

  const cancelEventDeletion = async (): Promise<void> => {
    if (!eventToDelete || !deletionConfirmationId || deletionInFlight.current) return;
    deletionInFlight.current = true;
    setIsCancellingDeletion(true);
    const cancelled = await cancelCalendarEventDeletion(window.ares?.planner, eventToDelete.id, deletionConfirmationId);
    deletionInFlight.current = false;
    setIsCancellingDeletion(false);
    if (!cancelled) {
      setDeletionError("No se pudo cancelar la confirmación. Inténtalo de nuevo.");
      return;
    }
    focusAfterClosing.current = "trigger";
    setDeletionError(null);
    setDeletionConfirmationId(null);
    setEventToDelete(null);
  };

  const confirmEventDeletion = async (): Promise<void> => {
    if (!eventToDelete || !deletionConfirmationId || deletionInFlight.current) return;
    deletionInFlight.current = true;
    setIsDeletingEvent(true);
    setDeletionError(null);
    const outcome = await confirmCalendarEventDeletion(window.ares?.planner, eventToDelete.id, deletionConfirmationId);
    deletionInFlight.current = false;
    setIsDeletingEvent(false);
    if (!outcome.deleted) {
      focusAfterClosing.current = "trigger";
      setDeletionConfirmationId(null);
      setEventToDelete(null);
      setDeletionError(outcome.message);
      return;
    }
    focusAfterClosing.current = "rail";
    setSelectedEventId((current) => current === eventToDelete.id ? null : current);
    setDeletionConfirmationId(null);
    setEventToDelete(null);
    setReloadVersion((version) => version + 1);
  };

  return <section aria-label="Calendario" className="calendar-shell">
    <header className="calendar-header">
      <div className="calendar-header__identity">
        <p className="eyebrow">Planificación</p>
        <h1>{formatCalendarMonth(displayedMonth)}</h1>
      </div>
      <div aria-label="Navegación del calendario" className="calendar-controls">
        <button className="calendar-controls__previous" onClick={() => showMonth(new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1))} type="button">Mes anterior</button>
        <button className="calendar-controls__today" onClick={showToday} type="button">Hoy</button>
        <button className="calendar-controls__next" onClick={() => showMonth(nextMonthStartFor(displayedMonth))} type="button">Mes siguiente</button>
      </div>
    </header>

    <div className="calendar-console">
      <div className="calendar-notices">
        {deletionError && !eventToDelete && <p className="calendar-status calendar-status--error" role="alert">{deletionError}</p>}
        {isLoading && <p className="calendar-status calendar-status--loading" role="status">Cargando calendario...</p>}
        {calendarData.taskError && <p className="calendar-status calendar-status--error">{calendarData.taskError}</p>}
        {calendarData.eventError && <p className="calendar-status calendar-status--error">{calendarData.eventError}</p>}
        {!isLoading && !hasRecords && !calendarData.taskError && !calendarData.eventError && <p className="calendar-status calendar-status--empty">No hay tareas ni eventos para este mes.</p>}
      </div>
      <div className="calendar-surface">
        <CalendarGrid days={days} itemsByDay={itemsByDay} key={toLocalCalendarDate(displayedMonth)} onSelectDate={setSelectedDate} selectedDate={selectedDate} todayDate={todayDate} />
      </div>
      <aside className="calendar-focus-rail" ref={focusRail} tabIndex={-1}>
        <CalendarDayDetails
          isoDate={selectedDate}
          items={selectedItems}
          selectedEventId={eventActionsAvailable ? selectedEventId : null}
          onSelectEvent={eventActionsAvailable ? (id) => { setSelectedTaskId(null); setSelectedEventId(id); } : undefined}
          selectedTaskId={eventActionsAvailable ? selectedTaskId : null}
          onSelectTask={eventActionsAvailable ? (id) => { setSelectedEventId(null); setSelectedTaskId(id); } : undefined}
          onTaskRefresh={() => setReloadVersion((version) => version + 1)}
          onTaskDeleted={() => { setSelectedTaskId(null); focusRail.current?.focus(); }}
          onTaskBusyChange={(busy) => { taskActionBusy.current = busy; }}
          onRequestEventEdit={eventActionsAvailable ? (event, trigger) => {
            if (deletionInFlight.current || eventToDelete) return;
            editTrigger.current = trigger;
            setEventToEdit(event);
          } : undefined}
          onRequestEventDeletion={eventActionsAvailable ? requestEventDeletion : undefined}
        />
      </aside>
    </div>
    {eventToEdit && <CalendarEventEditDialog
      event={eventToEdit}
      onCancel={() => { restoreEditFocus.current = true; setEventToEdit(null); }}
      onSave={async (values) => {
        const outcome = await saveCalendarEventEdit(window.ares?.planner, eventToEdit, values);
        if (outcome.saved) {
          restoreEditFocus.current = true;
          setEventToEdit(null);
          setReloadVersion((version) => version + 1);
        }
        return outcome;
      }}
    />}
    {eventToDelete && <CalendarEventDeleteDialog
      error={deletionError}
      event={eventToDelete}
      isDeleting={isDeletingEvent}
      isCancelling={isCancellingDeletion}
      onCancel={() => { void cancelEventDeletion(); }}
      onConfirm={() => { void confirmEventDeletion(); }}
    />}
  </section>;
};
