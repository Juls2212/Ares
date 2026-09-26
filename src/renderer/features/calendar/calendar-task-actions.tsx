import { useEffect, useRef, useState } from "react";
import type { TaskRecord } from "../../../shared/planner-contracts";
import { CalendarTaskEditDialog } from "./calendar-task-edit-dialog";
import { CalendarTaskDeleteDialog } from "./calendar-task-delete-dialog";
import { saveCalendarTaskEdit, toggleCalendarTaskCompletion } from "./calendar-task-editing";
import { requestCalendarTaskDeletion, confirmCalendarTaskDeletion, cancelCalendarTaskDeletion } from "./calendar-task-deletion";

export const CalendarTaskActions = ({ task, onRefresh, onDeleted, onBusyChange }: { task: TaskRecord; onRefresh: () => void; onDeleted: () => void; onBusyChange: (busy: boolean) => void }) => {
  const [editing, setEditing] = useState(false);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const guard = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = () => { trigger.current?.isConnected && trigger.current.focus(); };
  const setPending = (value: boolean) => { guard.current = value; setBusy(value); onBusyChange(value); };
  useEffect(() => () => onBusyChange(false), []);
  return <div className="calendar-event-actions calendar-task-actions">
    <button type="button" className="calendar-event-edit-trigger" disabled={busy} onClick={(click) => { trigger.current = click.currentTarget; setEditing(true); }}>Editar</button>
    <button type="button" className="calendar-event-edit-trigger" disabled={busy} onClick={(click) => {
      if (guard.current) return;
      trigger.current = click.currentTarget; setPending(true); setError(undefined);
      void toggleCalendarTaskCompletion(window.ares?.planner, task).then((result) => { if (result.saved) onRefresh(); else setError(result.message); }).finally(() => setPending(false));
    }}>{task.status === "COMPLETED" ? "Reabrir" : "Completar"}</button>
    <button type="button" className="calendar-event-delete-trigger" disabled={busy} onClick={(click) => {
      if (guard.current) return;
      trigger.current = click.currentTarget; setPending(true); setError(undefined);
      void requestCalendarTaskDeletion(window.ares?.planner, task.id).then((result) => { if (result.ready) setConfirmationId(result.confirmationId); else setError(result.message); }).finally(() => setPending(false));
    }}>Eliminar</button>
    {error && !confirmationId && <p role="alert" className="calendar-status calendar-status--error">{error}</p>}
    {busy && !confirmationId && <p role="status">Actualizando tarea...</p>}
    {editing && <CalendarTaskEditDialog task={task} onCancel={() => { setEditing(false); restoreFocus(); }} onSave={async (values) => {
      onBusyChange(true);
      const result = await saveCalendarTaskEdit(window.ares?.planner, task, values);
      onBusyChange(false);
      if (result.saved) { setEditing(false); restoreFocus(); onRefresh(); }
      return result;
    }} />}
    {confirmationId && <CalendarTaskDeleteDialog task={task} isDeleting={busy && !cancelling} isCancelling={cancelling} error={error ?? null} onCancel={() => {
      if (guard.current) return;
      setPending(true); setCancelling(true);
      void cancelCalendarTaskDeletion(window.ares?.planner, task.id, confirmationId).then((cancelled) => {
        if (cancelled) { setConfirmationId(null); setError(undefined); restoreFocus(); }
        else setError("No se pudo cancelar la confirmación. Inténtalo de nuevo.");
      }).finally(() => { setCancelling(false); setPending(false); });
    }} onConfirm={() => {
      if (guard.current) return;
      setPending(true);
      void confirmCalendarTaskDeletion(window.ares?.planner, task.id, confirmationId).then((result) => {
        setConfirmationId(null);
        if (result.deleted) { onDeleted(); onRefresh(); }
        else { setError(result.message); restoreFocus(); }
      }).finally(() => setPending(false));
    }} />}
  </div>;
};
