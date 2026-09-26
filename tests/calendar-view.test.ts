import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, isValidElement, Children, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EventRecord, PlannerApi, TaskRecord } from "../src/shared/planner-contracts";
import { CalendarDayDetails, canDeleteLoadedCalendarEvents, resolveSelectedCalendarEvent } from "../src/renderer/features/calendar/calendar-day-details";
import { loadCalendarData } from "../src/renderer/features/calendar/calendar-data";
import { CalendarEventDeleteDialog, handleCalendarDeleteDialogKey } from "../src/renderer/features/calendar/calendar-event-delete-dialog";
import { CalendarEventEditDialog } from "../src/renderer/features/calendar/calendar-event-edit-dialog";
import { eventEditValues, saveCalendarEventEdit } from "../src/renderer/features/calendar/calendar-event-editing";
import {
  cancelCalendarEventDeletion,
  confirmCalendarEventDeletion,
  requestCalendarEventDeletion
} from "../src/renderer/features/calendar/calendar-event-deletion";
import {
  createMonthGrid,
  firstSelectedDateForMonth,
  formatCalendarMonth,
  groupCalendarRecordsByDay,
  monthStartFor,
  nextMonthStartFor,
  toLocalCalendarDate,
  toLocalDateTimeWithOffset
} from "../src/renderer/features/calendar/calendar-date-utils";

const calendarViewSource = readFileSync(path.resolve(process.cwd(), "src/renderer/views/calendar-view.tsx"), "utf8");
const calendarStyles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

const task = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "task-1",
  title: "Tarea real",
  description: null,
  dueDate: "2026-09-15",
  dueTime: "09:30",
  priority: "MEDIUM",
  status: "PENDING",
  categoryId: null,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides
});

const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: "event-1",
  title: "Evento real",
  description: null,
  startAt: "2026-09-15T14:00:00Z",
  endAt: null,
  categoryId: null,
  location: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides
});

const plannerWith = (
  tasksResult: ReturnType<PlannerApi["tasks"]["list"]>,
  eventsResult: ReturnType<PlannerApi["events"]["list"]>
): PlannerApi => ({
  tasks: { list: vi.fn(() => tasksResult) },
  events: { list: vi.fn(() => eventsResult) }
} as unknown as PlannerApi);

describe("calendar date helpers", () => {
  it("generates a stable six-week grid beginning on Monday", () => {
    const grid = createMonthGrid(new Date(2026, 8, 1));

    expect(grid).toHaveLength(42);
    expect(grid[0].date.getDay()).toBe(1);
    expect(grid.some((day) => day.isoDate === "2026-09-01" && day.isCurrentMonth)).toBe(true);
  });

  it("supports previous, next, and today month selection without mutation", () => {
    const month = monthStartFor(new Date(2026, 8, 15));
    const today = new Date(2026, 8, 15);

    expect(nextMonthStartFor(month)).toEqual(new Date(2026, 9, 1));
    expect(firstSelectedDateForMonth(month, today)).toBe("2026-09-15");
    expect(firstSelectedDateForMonth(month, new Date(2026, 9, 15))).toBe("2026-09-01");
  });

  it("places dated tasks and local events on their real calendar day while excluding undated tasks", () => {
    const datedTask = task();
    const undatedTask = task({ id: "task-2", dueDate: null, dueTime: null });
    const plannerEvent = event();
    const eventDay = toLocalCalendarDate(new Date(plannerEvent.startAt));

    const grouped = groupCalendarRecordsByDay([datedTask, undatedTask], [plannerEvent]);

    expect(grouped.get(datedTask.dueDate!)?.tasks).toEqual([datedTask]);
    expect(grouped.get(eventDay)?.events).toEqual([plannerEvent]);
    expect([...grouped.values()].flatMap((items) => items.tasks)).not.toContain(undatedTask);
  });

  it("creates a complete local event query boundary with an explicit offset", () => {
    expect(toLocalDateTimeWithOffset(new Date(2026, 8, 1, 0, 0, 0))).toMatch(/T00:00:00[+-]\d{2}:\d{2}$/);
  });

  it("formats Spanish month names with natural lowercase casing", () => {
    expect(formatCalendarMonth(new Date(2026, 8, 1))).toBe("septiembre de 2026");
  });
});

describe("calendar planner reads", () => {
  it("loads tasks and events through only the approved list methods", async () => {
    const planner = plannerWith(
      Promise.resolve({ ok: true, data: { items: [task()], total: 1 } }),
      Promise.resolve({ ok: true, data: { items: [event()], total: 1 } })
    );

    const result = await loadCalendarData(planner, new Date(2026, 8, 1));

    expect(result).toMatchObject({ tasks: [task()], events: [event()] });
    expect(planner.tasks.list).toHaveBeenCalledOnce();
    expect(planner.events.list).toHaveBeenCalledOnce();
    expect(Object.keys(planner.tasks)).toEqual(["list"]);
    expect(Object.keys(planner.events)).toEqual(["list"]);
  });

  it("keeps successful events when the task source returns a controlled failure", async () => {
    const planner = plannerWith(
      Promise.resolve({ ok: false, error: { code: "PLANNER_DATABASE_UNAVAILABLE", userMessage: "unsafe source text" } }),
      Promise.resolve({ ok: true, data: { items: [event()], total: 1 } })
    );

    const result = await loadCalendarData(planner, new Date(2026, 8, 1));

    expect(result.tasks).toEqual([]);
    expect(result.events).toEqual([event()]);
    expect(result.taskError).toBe("No se pudieron cargar las tareas del calendario.");
    expect(result.taskError).not.toContain("unsafe source text");
  });

  it("keeps successful tasks when the event source throws", async () => {
    const planner = plannerWith(
      Promise.resolve({ ok: true, data: { items: [task()], total: 1 } }),
      Promise.reject(new Error("technical failure"))
    );

    const result = await loadCalendarData(planner, new Date(2026, 8, 1));

    expect(result.tasks).toEqual([task()]);
    expect(result.events).toEqual([]);
    expect(result.eventError).toBe("No se pudieron cargar los eventos del calendario.");
  });

  it("returns controlled empty source errors when planner access is unavailable", async () => {
    const result = await loadCalendarData(undefined, new Date(2026, 8, 1));

    expect(result.tasks).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.taskError).toBeDefined();
    expect(result.eventError).toBeDefined();
  });
});

describe("calendar workspace presentation", () => {
  it("keeps a compact command header, one month plane, and the selected-day focus rail", () => {
    expect(calendarViewSource).toContain('className="calendar-header__identity"');
    expect(calendarViewSource).toContain('className="calendar-controls"');
    expect(calendarViewSource).toContain('className="calendar-surface"');
    expect(calendarViewSource).toContain('className="calendar-focus-rail"');
    expect(calendarViewSource).toContain('className="calendar-status calendar-status--loading"');
    expect(calendarViewSource).toContain('className="calendar-status calendar-status--empty"');
    expect(calendarViewSource).toContain("<CalendarGrid days={days}");
    expect(calendarViewSource).toContain("<CalendarDayDetails");
    expect(calendarViewSource).toContain("items={selectedItems}");
  });

  it("retains visible month controls and distinct keyboard-accessible date states", () => {
    expect(calendarViewSource).toContain(">Mes anterior</button>");
    expect(calendarViewSource).toContain(">Hoy</button>");
    expect(calendarViewSource).toContain(">Mes siguiente</button>");
    expect(calendarStyles).toContain(".calendar-day.is-selected");
    expect(calendarStyles).toContain(".calendar-day.is-today::after");
    expect(calendarStyles).toContain(".calendar-day:focus-visible");
    expect(calendarStyles).toContain(':root[data-theme="dark"] .calendar-shell');
  });
});

describe("calendar event deletion", () => {
  it("prefills the edit dialog with real event values without updating on render or cancel", () => {
    const record = event({ description: "Descripción real", location: "Sala real" });
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const markup = renderToStaticMarkup(createElement(CalendarEventEditDialog, { event: record, onSave, onCancel }));
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('value="Evento real"');
    expect(markup).toContain("Descripción real");
    expect(markup).toContain('value="Sala real"');
    expect(markup).toContain(eventEditValues(record).startAt);
    expect(onSave).not.toHaveBeenCalled();
    handleCalendarDeleteDialogKey({ key: "Escape", shiftKey: false, preventDefault: vi.fn() }, false, onCancel, null, null, null);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("updates the exact event directly and refreshes only after success without changing the day", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, data: { item: event() } });
    const planner = { events: { update } } as unknown as PlannerApi;
    const record = event();
    const values = { ...eventEditValues(record), title: "Título actualizado" };
    expect(await saveCalendarEventEdit(planner, record, values)).toEqual({ saved: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ eventId: record.id, title: values.title, startAt: record.startAt, endAt: null }));
    const saveFlow = calendarViewSource.slice(calendarViewSource.indexOf("onSave={async"));
    expect(saveFlow).toContain("if (outcome.saved)");
    expect(saveFlow).toContain("setReloadVersion");
    expect(saveFlow).not.toContain("setSelectedDate");
  });

  it("retains edit input on invalid ranges or controlled failures and redacts technical errors", async () => {
    const record = event();
    const values = eventEditValues(record);
    const update = vi.fn().mockRejectedValue(new Error("private database detail"));
    const planner = { events: { update } } as unknown as PlannerApi;
    expect((await saveCalendarEventEdit(planner, record, { ...values, endAt: values.startAt })).message).toBe("El fin debe ser posterior al inicio.");
    expect(update).not.toHaveBeenCalled();
    expect((await saveCalendarEventEdit(planner, record, { ...values, startAt: "2026-02-30T12:00:00" })).saved).toBe(false);
    const outcome = await saveCalendarEventEdit(planner, record, values);
    expect(outcome.saved).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain("private database detail");
    expect(values).toEqual(eventEditValues(record));
    update.mockResolvedValue({ ok: false, error: { code: "PLANNER_NOT_FOUND", userMessage: "private database detail" } });
    expect((await saveCalendarEventEdit(planner, record, values)).message).toContain("ya no está disponible");
  });
  it("moves inline actions to the selected event and never renders them for tasks", () => {
    const first = event();
    const second = event({ id: "event-2", title: "Segundo evento" });
    const renderSelection = (id: string) => renderToStaticMarkup(createElement(CalendarDayDetails, {
      isoDate: "2026-09-15", items: { events: [first, second], tasks: [task()] }, selectedEventId: id,
      onSelectEvent: vi.fn(), onRequestEventEdit: vi.fn(), onRequestEventDeletion: vi.fn()
    }));
    const firstMarkup = renderSelection(first.id);
    expect(firstMarkup).toContain(`aria-label="Editar evento: ${first.title}"`);
    expect(firstMarkup).not.toContain(`aria-label="Editar evento: ${second.title}"`);
    expect(firstMarkup.match(/class="calendar-event-actions"/g)).toHaveLength(1);
    const secondMarkup = renderSelection(second.id);
    expect(secondMarkup).toContain(`aria-label="Eliminar evento: ${second.title}"`);
    expect(secondMarkup).not.toContain(`aria-label="Eliminar evento: ${first.title}"`);
    expect(renderSelection(task().id)).not.toContain("calendar-event-actions");
    expect(calendarViewSource).toContain("[selectedDate]");
    expect(calendarViewSource).toContain('document.removeEventListener("click", clearOutsideSelection)');
  });
  it("keeps deletion available for real events despite task-source failure, never during event loading or failure", () => {
    expect(canDeleteLoadedCalendarEvents(false)).toBe(true);
    expect(canDeleteLoadedCalendarEvents(true)).toBe(false);
    expect(canDeleteLoadedCalendarEvents(false, "No se pudieron cargar los eventos.")).toBe(false);
    expect(calendarViewSource).toContain("canDeleteLoadedCalendarEvents(isLoading, calendarData.eventError)");
  });

  it("targets the exact loaded event adjacent to the clicked control", () => {
    const onRequest = vi.fn();
    const onSelect = vi.fn();
    const selectedEvent = event();
    const items = { events: [selectedEvent], tasks: [] };
    const buttons: ReactElement<Record<string, unknown>>[] = [];
    const visit = (node: ReactNode): void => {
      Children.forEach(node, (child) => {
        if (!isValidElement<Record<string, unknown>>(child)) return;
        if (child.type === "button") buttons.push(child);
        visit(child.props.children as ReactNode);
      });
    };
    visit(CalendarDayDetails({ isoDate: "2026-09-15", items, onSelectEvent: onSelect, onRequestEventDeletion: onRequest }));
    expect(buttons).toHaveLength(1);
    (buttons[0].props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith(selectedEvent.id);
    expect(onRequest).not.toHaveBeenCalled();
    buttons.length = 0;
    visit(CalendarDayDetails({ isoDate: "2026-09-15", items, selectedEventId: selectedEvent.id, onSelectEvent: onSelect, onRequestEventDeletion: onRequest }));
    expect(buttons).toHaveLength(2);
    const trigger = {} as HTMLButtonElement;
    (buttons[1].props.onClick as (event: { currentTarget: HTMLButtonElement }) => void)({ currentTarget: trigger });
    expect(onRequest).toHaveBeenCalledWith(selectedEvent, trigger);
  });
  it("shows one contextual delete control only for the selected loaded event", () => {
    const items = { events: [event()], tasks: [task()] };
    const withDeletion = renderToStaticMarkup(createElement(CalendarDayDetails, {
      isoDate: "2026-09-15",
      items,
      selectedEventId: event().id,
      onSelectEvent: vi.fn(),
      onRequestEventDeletion: vi.fn()
    }));
    const withoutDeletion = renderToStaticMarkup(createElement(CalendarDayDetails, {
      isoDate: "2026-09-15",
      items,
      onSelectEvent: vi.fn(), onRequestEventDeletion: vi.fn()
    }));

    expect(withDeletion.match(/>Eliminar</g)).toHaveLength(1);
    expect(withDeletion).toContain("Tarea real");
    expect(withDeletion).toContain('class="calendar-event-actions"');
    expect(withDeletion).toContain('aria-pressed="true"');
    expect(withDeletion).not.toContain("calendar-event-context");
    expect(withoutDeletion).not.toContain("Eliminar evento");
    expect(renderToStaticMarkup(createElement(CalendarDayDetails, {
      isoDate: "2026-09-15", items: { events: [], tasks: [task()] }, selectedEventId: task().id, onSelectEvent: vi.fn(), onRequestEventDeletion: vi.fn()
    }))).not.toContain("Eliminar evento");
  });

  it("ignores stale selections and clears selection after successful deletion or unavailable events", () => {
    expect(resolveSelectedCalendarEvent({ events: [event()], tasks: [] }, event().id)).toEqual(event());
    expect(resolveSelectedCalendarEvent({ events: [], tasks: [task()] }, event().id)).toBeUndefined();
    expect(resolveSelectedCalendarEvent({ events: [event()], tasks: [] }, "removed-event")).toBeUndefined();
    const stale = renderToStaticMarkup(createElement(CalendarDayDetails, {
      isoDate: "2026-09-15", items: { events: [event()], tasks: [] }, selectedEventId: "removed-event",
      onSelectEvent: vi.fn(), onRequestEventDeletion: vi.fn()
    }));
    expect(stale).not.toContain("Evento seleccionado");
    expect(stale).not.toContain("Eliminar evento");
    const confirmFlow = calendarViewSource.slice(calendarViewSource.indexOf("const confirmEventDeletion"), calendarViewSource.indexOf("return <section"));
    expect(confirmFlow).toContain("current === eventToDelete.id ? null : current");
    expect(confirmFlow.indexOf("current === eventToDelete.id")).toBeGreaterThan(confirmFlow.indexOf("if (!outcome.deleted)"));
    expect(calendarViewSource).toContain("!eventActionsAvailable || !resolveSelectedCalendarEvent(selectedItems, selectedEventId)");
  });

  it("requires an explicit confirmation dialog and supports Escape and focus wrapping", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const markup = renderToStaticMarkup(createElement(CalendarEventDeleteDialog, {
      event: event(), isDeleting: false, isCancelling: false, error: null, onCancel, onConfirm
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Se eliminará permanentemente");
    expect(markup).toContain("Cancelar");
    expect(markup).toContain(">Eliminar</button>");
    expect(onConfirm).not.toHaveBeenCalled();

    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const escape = { key: "Escape", shiftKey: false, preventDefault: vi.fn() };
    handleCalendarDeleteDialogKey(escape, false, onCancel, first, last, first);
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    handleCalendarDeleteDialogKey({ key: "Tab", shiftKey: true, preventDefault: vi.fn() }, false, onCancel, first, last, first);
    expect(last.focus).toHaveBeenCalledOnce();
    handleCalendarDeleteDialogKey({ key: "Tab", shiftKey: false, preventDefault: vi.fn() }, false, onCancel, first, last, last);
    expect(first.focus).toHaveBeenCalledOnce();
    handleCalendarDeleteDialogKey(escape, true, onCancel, first, last, first);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("requests, confirms, and cancels deletion through narrow methods with safe errors", async () => {
    const planner = plannerWith(
      Promise.resolve({ ok: true, data: { items: [], total: 0 } }),
      Promise.resolve({ ok: true, data: { items: [], total: 0 } })
    );
    planner.events.requestDeletion = vi.fn().mockResolvedValue({ ok: true, data: { confirmationId: "opaque-token" } });
    planner.events.confirmDeletion = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { deleted: true } })
      .mockResolvedValueOnce({ ok: false, error: { code: "PLANNER_NOT_FOUND", userMessage: "unsafe database detail" } })
      .mockRejectedValueOnce(new Error("unsafe database detail"));
    planner.events.cancelDeletion = vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true } });

    expect(await requestCalendarEventDeletion(planner, event().id)).toEqual({ ready: true, confirmationId: "opaque-token" });
    expect(await confirmCalendarEventDeletion(planner, event().id, "opaque-token")).toEqual({ deleted: true });
    expect(planner.events.confirmDeletion).toHaveBeenCalledWith({ eventId: event().id, confirmationId: "opaque-token" });
    const missing = await confirmCalendarEventDeletion(planner, event().id, "opaque-token");
    const unavailable = await confirmCalendarEventDeletion(planner, event().id, "opaque-token");
    expect(missing).toEqual({ deleted: false, message: "El evento ya no está disponible. Actualiza el calendario." });
    expect(unavailable).toEqual({ deleted: false, message: "No se pudo eliminar el evento. Inténtalo de nuevo." });
    expect(await cancelCalendarEventDeletion(planner, event().id, "opaque-token")).toBe(true);
    expect(JSON.stringify([missing, unavailable])).not.toContain("unsafe database detail");
  });

  it("opens confirmation before deletion and reloads only after a successful result", () => {
    const requestFlow = calendarViewSource.slice(calendarViewSource.indexOf("const requestEventDeletion"), calendarViewSource.indexOf("const cancelEventDeletion"));
    const cancelFlow = calendarViewSource.slice(calendarViewSource.indexOf("const cancelEventDeletion"), calendarViewSource.indexOf("const confirmEventDeletion"));
    const confirmFlow = calendarViewSource.slice(calendarViewSource.indexOf("const confirmEventDeletion"), calendarViewSource.indexOf("return <section"));
    expect(requestFlow).toContain("requestCalendarEventDeletion(window.ares?.planner, event.id)");
    expect(cancelFlow).toContain("cancelCalendarEventDeletion(window.ares?.planner, eventToDelete.id, deletionConfirmationId)");
    expect(confirmFlow).toContain("confirmCalendarEventDeletion(window.ares?.planner, eventToDelete.id, deletionConfirmationId)");
    expect(requestFlow).not.toContain("confirmCalendarEventDeletion(");
    expect(cancelFlow).not.toContain("confirmCalendarEventDeletion(");
    expect(confirmFlow).toContain("if (!outcome.deleted)");
    expect(confirmFlow.indexOf("if (!outcome.deleted)")).toBeLessThan(confirmFlow.indexOf("setReloadVersion"));
    expect(calendarViewSource).toContain("[displayedMonth, reloadVersion]");
    expect(calendarViewSource).toContain('focusAfterClosing.current = "trigger"');
  });
});
