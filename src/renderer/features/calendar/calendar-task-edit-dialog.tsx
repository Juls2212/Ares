import { useEffect, useRef, useState } from "react";
import type { TaskRecord, TaskPriority } from "../../../shared/planner-contracts";
import { taskEditValues, type CalendarTaskEditValues, type TaskChangeOutcome } from "./calendar-task-editing";
import { handleCalendarDeleteDialogKey } from "./calendar-event-delete-dialog";

export const CalendarTaskEditDialog = ({ task, onSave, onCancel }: { task: TaskRecord; onSave: (values: CalendarTaskEditValues) => Promise<TaskChangeOutcome>; onCancel: () => void }) => {
  const [values, setValues] = useState(() => taskEditValues(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const title = useRef<HTMLInputElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const change = (field: keyof CalendarTaskEditValues, value: string) => setValues((current) => ({ ...current, [field]: value }));
  return <div className="calendar-delete-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="calendar-task-edit-title" className="calendar-edit-dialog" tabIndex={-1} ref={dialog}
    onKeyDown={(key) => handleCalendarDeleteDialogKey(key, saving, onCancel, title.current, save.current, document.activeElement)}>
    <h2 id="calendar-task-edit-title">Editar tarea</h2>
    <form onSubmit={(submit) => {
      submit.preventDefault();
      if (inFlight.current) return;
      inFlight.current = true; setSaving(true); setError(undefined); dialog.current?.focus();
      void onSave(values).then((result) => { if (!result.saved) setError(result.message); })
        .catch(() => setError("No se pudo guardar la tarea. Inténtalo de nuevo."))
        .finally(() => { inFlight.current = false; setSaving(false); });
    }}>
      <label>Título<input ref={title} required maxLength={240} disabled={saving} value={values.title} onChange={(event) => change("title", event.target.value)} /></label>
      <label>Descripción<textarea maxLength={4000} disabled={saving} value={values.description} onChange={(event) => change("description", event.target.value)} /></label>
      <label>Fecha de vencimiento<input type="date" disabled={saving} value={values.dueDate} onChange={(event) => change("dueDate", event.target.value)} /></label>
      <label>Hora (opcional)<input type="time" disabled={saving} value={values.dueTime} onChange={(event) => change("dueTime", event.target.value)} /></label>
      <label>Prioridad<select disabled={saving} value={values.priority} onChange={(event) => change("priority", event.target.value as TaskPriority)}><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option></select></label>
      {error && <p role="alert">{error}</p>}{saving && <p role="status">Guardando tarea...</p>}
      <div className="calendar-delete-actions"><button type="button" disabled={saving} onClick={onCancel}>Cancelar</button><button ref={save} disabled={saving} type="submit">Guardar</button></div>
    </form>
  </div></div>;
};
