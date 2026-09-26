import { useEffect, useRef, type KeyboardEvent } from "react";
import type { TaskRecord } from "../../../shared/planner-contracts";

type DialogKey = Pick<KeyboardEvent<HTMLDivElement>, "key" | "shiftKey" | "preventDefault">;
type Focusable = { focus: () => void } | null;

export const handleCalendarDeleteDialogKey = (
  keyboardEvent: DialogKey,
  isDeleting: boolean,
  onCancel: () => void,
  first: Focusable,
  last: Focusable,
  active: unknown
): void => {
  if (keyboardEvent.key === "Escape" && !isDeleting) {
    keyboardEvent.preventDefault();
    onCancel();
  }
  if (keyboardEvent.key === "Tab" && !isDeleting) {
    if (keyboardEvent.shiftKey && active === first) {
      keyboardEvent.preventDefault();
      last?.focus();
    } else if (!keyboardEvent.shiftKey && active === last) {
      keyboardEvent.preventDefault();
      first?.focus();
    }
  }
  if (keyboardEvent.key === "Tab" && isDeleting) keyboardEvent.preventDefault();
};

type CalendarTaskDeleteDialogProperties = {
  task: TaskRecord;
  isDeleting: boolean;
  isCancelling: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export const CalendarTaskDeleteDialog = ({
  task,
  isDeleting,
  isCancelling,
  error,
  onCancel,
  onConfirm
}: CalendarTaskDeleteDialogProperties) => {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
  }, []);

  useEffect(() => {
    if (isDeleting) dialog.current?.focus();
  }, [isDeleting]);

  const handleKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>): void => {
    handleCalendarDeleteDialogKey(
      keyboardEvent,
      isDeleting || isCancelling,
      onCancel,
      cancelButton.current,
      deleteButton.current,
      document.activeElement
    );
  };

  return <div className="calendar-delete-backdrop">
    <div
      aria-describedby="calendar-task-delete-description"
      aria-labelledby="calendar-task-delete-title"
      aria-modal="true"
      className="calendar-delete-dialog"
      onKeyDown={handleKeyDown}
      ref={dialog}
      role="dialog"
      tabIndex={-1}
    >
      <p className="eyebrow">Confirmación necesaria</p>
      <h2 id="calendar-task-delete-title">Eliminar tarea</h2>
      <p id="calendar-task-delete-description">Se eliminará permanentemente la tarea «{task.title}». Esta acción no se puede deshacer.</p>
      {error && <p className="calendar-delete-error" role="alert">{error}</p>}
      {isDeleting && <p className="calendar-delete-progress" role="status">Eliminando tarea...</p>}
      {isCancelling && <p className="calendar-delete-progress" role="status">Cancelando confirmación...</p>}
      <div className="calendar-delete-actions">
        <button disabled={isDeleting || isCancelling} onClick={onCancel} ref={cancelButton} type="button">Cancelar</button>
        <button className="calendar-delete-actions__confirm" disabled={isDeleting || isCancelling} onClick={onConfirm} ref={deleteButton} type="button">Eliminar</button>
      </div>
    </div>
  </div>;
};
