import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { ContactFormRequest } from "../../../shared/messaging-contracts";
import { handleAssistantReviewDialogKey } from "../assistant/interpretation-result";

export type ContactFormValues = { displayName: string; phone: string };

type ContactFormDialogProperties = {
  request: ContactFormRequest;
  /** Resolves to a Spanish message when Main rejects the values, or undefined when they were accepted. */
  onSubmit: (values: ContactFormValues) => Promise<string | undefined>;
  onCancel: () => void;
};

const MAX_NAME_LENGTH = 40;
const MAX_PHONE_FIELD_LENGTH = 24;

/**
 * Main-initiated form for saving a contact. The name arrives prefilled from the spoken request; the number
 * is typed here and submitted straight to Main. It lives only in this component's state, is never echoed
 * back, and disappears with the form.
 */
export const ContactFormDialog = ({ request, onSubmit, onCancel }: ContactFormDialogProperties) => {
  const [displayName, setDisplayName] = useState(request.displayName);
  const [phone, setPhone] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const phoneField = useRef<HTMLInputElement>(null);

  const cancelHandler = useRef(onCancel);
  cancelHandler.current = onCancel;

  // Focus moves to the number field and goes back to whatever had it (the orb) when the form closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    phoneField.current?.focus();
    return () => {
      const target = previous?.isConnected ? previous : document.querySelector<HTMLElement>(".glass-orb");
      target?.focus();
    };
  }, []);

  // Escape cancels from anywhere; the dialog's own handler marks the event as handled first.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) cancelHandler.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorMessage(undefined);
    const message = await onSubmit({ displayName, phone });
    if (message !== undefined) {
      setErrorMessage(message);
      setBusy(false);
    }
  };

  const handleKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>): void => {
    const focusables = Array.from(dialog.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") ?? []);
    handleAssistantReviewDialogKey(keyboardEvent, onCancel, focusables[0] ?? null, focusables.at(-1) ?? null, document.activeElement);
  };

  return <div className="review-layer">
    <div
      aria-describedby="contact-form-description"
      aria-labelledby="contact-form-title"
      aria-modal="true"
      className="review-card contact-form-dialog"
      onKeyDown={handleKeyDown}
      ref={dialog}
      role="dialog"
      tabIndex={-1}
    >
      <div className="review-card__eyebrow"><span>Nuevo contacto</span></div>
      <h2 className="contact-form__title" id="contact-form-title">Guardar contacto</h2>
      <p className="contact-form__description" id="contact-form-description">Escribe el número aquí. Ares no lo dicta ni lo comparte con el asistente.</p>
      <form className="contact-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="contact-form__field">
          <span>Nombre</span>
          <input
            autoComplete="off"
            maxLength={MAX_NAME_LENGTH}
            name="contact-name"
            onChange={(event) => setDisplayName(event.target.value)}
            required
            type="text"
            value={displayName}
          />
        </label>
        <label className="contact-form__field">
          <span>Número de teléfono</span>
          <input
            aria-describedby={errorMessage ? "contact-form-error" : undefined}
            aria-invalid={errorMessage ? true : undefined}
            autoComplete="off"
            inputMode="tel"
            maxLength={MAX_PHONE_FIELD_LENGTH}
            name="contact-phone"
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+57 300 123 4567"
            ref={phoneField}
            required
            type="tel"
            value={phone}
          />
        </label>
        {errorMessage && <p className="contact-form__error" id="contact-form-error" role="alert">{errorMessage}</p>}
        <div className="review-card__controls">
          <button className="button-secondary" disabled={busy} onClick={onCancel} type="button">Cancelar</button>
          <button className="button-primary" disabled={busy} type="submit">Continuar</button>
        </div>
      </form>
    </div>
  </div>;
};
