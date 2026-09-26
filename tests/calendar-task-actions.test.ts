import { createElement, Children, isValidElement, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TaskRecord, PlannerApi } from "../src/shared/planner-contracts";
import { CalendarDayDetails } from "../src/renderer/features/calendar/calendar-day-details";
import { CalendarTaskEditDialog } from "../src/renderer/features/calendar/calendar-task-edit-dialog";
import { CalendarTaskDeleteDialog, handleCalendarDeleteDialogKey } from "../src/renderer/features/calendar/calendar-task-delete-dialog";
import { taskEditValues, saveCalendarTaskEdit, toggleCalendarTaskCompletion } from "../src/renderer/features/calendar/calendar-task-editing";
import { requestCalendarTaskDeletion, cancelCalendarTaskDeletion, confirmCalendarTaskDeletion } from "../src/renderer/features/calendar/calendar-task-deletion";
import { readFileSync } from "node:fs";

const task: TaskRecord = { id: "550e8400-e29b-41d4-a716-446655440000", title: "Tarea de prueba", description: "Descripción real", dueDate: "2026-09-26", dueTime: "18:00", priority: "HIGH", status: "PENDING", completedAt: null, categoryId: null, createdAt: "2026-09-26T10:00:00Z", updatedAt: "2026-09-26T10:00:00Z" };
const props = { isoDate: task.dueDate!, items: { events: [], tasks: [task] }, onSelectTask: vi.fn(), onTaskRefresh: vi.fn(), onTaskDeleted: vi.fn(), onTaskBusyChange: vi.fn() };
describe("Calendar task interactions", () => {
  it("shows actions only beneath the selected real task and moves them when selection changes", () => {
    const unselected = renderToStaticMarkup(createElement(CalendarDayDetails, props));
    expect(unselected).not.toContain(">Eliminar<");
    const selected = renderToStaticMarkup(createElement(CalendarDayDetails, { ...props, selectedTaskId: task.id }));
    for (const action of ["Editar", "Completar", "Eliminar"]) expect(selected).toContain(`>${action}</button>`);
    expect(selected).toContain('aria-pressed="true"');
    const second = { ...task, id: "550e8400-e29b-41d4-a716-446655440001", title: "Segunda tarea", status: "COMPLETED" as const };
    const moved = renderToStaticMarkup(createElement(CalendarDayDetails, { ...props, items: { events: [], tasks: [task, second] }, selectedTaskId: second.id }));
    expect(moved.match(/calendar-task-actions/g)).toHaveLength(1);
    expect(moved.indexOf("Segunda tarea")).toBeLessThan(moved.indexOf("calendar-task-actions"));
    expect(moved).toContain(">Reabrir</button>");
    expect(renderToStaticMarkup(createElement(CalendarDayDetails, { ...props, items: { events: [], tasks: [] }, selectedTaskId: task.id }))).not.toContain("calendar-task-actions");
  });
  it("selects only the clicked task without changing data", () => {
    const buttons: ReactElement<Record<string, unknown>>[] = [];
    const visit = (node: ReactNode): void => Children.forEach(node, (child) => { if (isValidElement<Record<string, unknown>>(child)) { if (child.type === "button") buttons.push(child); visit(child.props.children as ReactNode); } });
    visit(CalendarDayDetails(props));
    (buttons[0].props.onClick as () => void)();
    expect(props.onSelectTask).toHaveBeenCalledWith(task.id);
    expect(props.onTaskRefresh).not.toHaveBeenCalled();
  });
  it("prefills real task fields and renders accessible dialogs without mutations", () => {
    const onSave = vi.fn(); const onCancel = vi.fn();
    const markup = renderToStaticMarkup(createElement(CalendarTaskEditDialog, { task, onSave, onCancel }));
    expect(markup).toContain('aria-modal="true"'); expect(markup).toContain(task.title); expect(markup).toContain(task.description!); expect(markup).toContain(task.dueDate!); expect(markup).toContain(task.dueTime!);
    handleCalendarDeleteDialogKey({ key: "Escape", shiftKey: false, preventDefault: vi.fn() }, false, onCancel, null, null, null);
    expect(onCancel).toHaveBeenCalledOnce(); expect(onSave).not.toHaveBeenCalled();
    const deletion = renderToStaticMarkup(createElement(CalendarTaskDeleteDialog, { task, isDeleting: false, isCancelling: false, error: null, onCancel, onConfirm: vi.fn() }));
    expect(deletion).toContain("Se eliminará permanentemente la tarea");
  });
  it("uses existing update and completion methods, including explicit reopening", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true }); const complete = vi.fn().mockResolvedValue({ ok: true });
    const planner = { tasks: { update, complete } } as unknown as PlannerApi;
    const values = { ...taskEditValues(task), title: "Título editado" };
    expect(await saveCalendarTaskEdit(planner, task, values)).toEqual({ saved: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id, title: values.title }));
    await toggleCalendarTaskCompletion(planner, task, () => new Date("2026-09-26T12:00:00Z"));
    expect(complete).toHaveBeenCalledWith({ taskId: task.id, completedAt: "2026-09-26T12:00:00.000Z" });
    await toggleCalendarTaskCompletion(planner, { ...task, status: "COMPLETED" });
    expect(update).toHaveBeenLastCalledWith({ taskId: task.id, status: "PENDING", completedAt: null });
  });
  it("preserves edit values and safely redacts failed updates", async () => {
    const values = taskEditValues(task);
    const planner = { tasks: { update: vi.fn().mockRejectedValue(new Error("private SQL")) } } as unknown as PlannerApi;
    const result = await saveCalendarTaskEdit(planner, task, values);
    expect(result.saved).toBe(false); expect(result.message).not.toContain("SQL"); expect(values).toEqual(taskEditValues(task));
    expect((await saveCalendarTaskEdit(planner, task, { ...values, dueDate: "" })).saved).toBe(false);
  });
  it("uses only request/confirm/cancel deletion methods with the exact task ID", async () => {
    const requestDeletion = vi.fn().mockResolvedValue({ ok: true, data: { confirmationId: "token" } });
    const confirmDeletion = vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } });
    const cancelDeletion = vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true } });
    const planner = { tasks: { requestDeletion, confirmDeletion, cancelDeletion } } as unknown as PlannerApi;
    expect(await requestCalendarTaskDeletion(planner, task.id)).toEqual({ ready: true, confirmationId: "token" });
    expect(confirmDeletion).not.toHaveBeenCalled();
    await cancelCalendarTaskDeletion(planner, task.id, "token"); expect(confirmDeletion).not.toHaveBeenCalled();
    await confirmCalendarTaskDeletion(planner, task.id, "token"); expect(confirmDeletion).toHaveBeenCalledWith({ taskId: task.id, confirmationId: "token" });
  });
  it("clears selection on day or outside changes, preserves the date on refresh, and adds no raw IPC", () => {
    const view = readFileSync("src/renderer/views/calendar-view.tsx", "utf8");
    expect(view).toContain("setSelectedEventId(null); setSelectedTaskId(null);");
    expect(view).toContain("[selectedDate]");
    expect(view).toContain("onTaskRefresh={() => setReloadVersion");
    const actions = readFileSync("src/renderer/features/calendar/calendar-task-actions.tsx", "utf8");
    expect(actions).not.toContain("ipcRenderer"); expect(actions).not.toContain("tasks.delete");
  });
});
