import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { EventRecord } from "../../../shared/planner-contracts";
import { eventEditValues, type CalendarEventEditValues } from "./calendar-event-editing";
import { handleCalendarDeleteDialogKey } from "./calendar-event-delete-dialog";

type Properties = {
  event: EventRecord;
  onCancel: () => void;
  onSave: (values: CalendarEventEditValues) => Promise<{ saved: boolean; message?: string }>;
};
export const CalendarEventEditDialog = ({ event, onCancel, onSave }: Properties) => {
  const [values, setValues] = useState(() => eventEditValues(event));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const title = useRef<HTMLInputElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const handleKey = (key: KeyboardEvent<HTMLDivElement>) => handleCalendarDeleteDialogKey(key, saving, onCancel, title.current, save.current, document.activeElement);
  const change = (field: keyof CalendarEventEditValues, value: string) => setValues((current) => ({ ...current, [field]: value }));
  return <div className="calendar-delete-backdrop">
    <div aria-labelledby="calendar-edit-title" aria-modal="true" className="calendar-edit-dialog" role="dialog" tabIndex={-1} ref={dialog} onKeyDown={handleKey}>
      <h2 id="calendar-edit-title">Editar evento</h2>
      <form onSubmit={(submit) => {
        submit.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        setSaving(true);
        setError(undefined);
        dialog.current?.focus();
        void onSave(values).then((result) => { if (!result.saved) setError(result.message); })
          .catch(() => setError("No se pudo guardar el evento. Inténtalo de nuevo."))
          .finally(() => { inFlight.current = false; setSaving(false); });
      }}>
        <label>Título<input ref={title} required disabled={saving} value={values.title} onChange={(changeEvent) => change("title", changeEvent.target.value)} /></label>
        <label>Descripción<textarea disabled={saving} value={values.description} onChange={(changeEvent) => change("description", changeEvent.target.value)} /></label>
        <label>Inicio<input type="datetime-local" step="1" required disabled={saving} value={values.startAt} onChange={(changeEvent) => change("startAt", changeEvent.target.value.length === 16 ? `${changeEvent.target.value}:00` : changeEvent.target.value)} /></label>
        <label>Fin (opcional)<input type="datetime-local" step="1" disabled={saving} value={values.endAt} onChange={(changeEvent) => change("endAt", changeEvent.target.value.length === 16 ? `${changeEvent.target.value}:00` : changeEvent.target.value)} /></label>
        <label>Lugar (opcional)<input disabled={saving} value={values.location} onChange={(changeEvent) => change("location", changeEvent.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        {saving && <p role="status">Guardando evento...</p>}
        <div className="calendar-delete-actions"><button type="button" disabled={saving} onClick={onCancel}>Cancelar</button><button ref={save} type="submit" disabled={saving}>Guardar</button></div>
      </form>
    </div>
  </div>;
};
