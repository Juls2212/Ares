import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { ASSISTANT_INSTRUCTION_MAX_LENGTH } from "../../../shared/assistant-contracts";

/** Shown (once per session) when the OpenAI key is not configured, so typed input is offered without being asked for. */
export const LOCAL_MODE_HINT = "Modo local: escribe con Ctrl+K";
/** Shown when the microphone is pressed without the OpenAI key: spoken input cannot work, typed input can. */
export const VOICE_NEEDS_KEY_MESSAGE = "La voz necesita la clave de OpenAI. Puedes escribir con Ctrl+K.";
export const COMMAND_INPUT_LABEL = "Escribe una instrucción para Ares";
export const COMMAND_INPUT_PLACEHOLDER = "Escribe y pulsa Enter";

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Ctrl+K (Cmd+K on a Mac) opens the input; with Alt or Shift it is some other shortcut. */
export const isCommandShortcut = (event: ShortcutEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLocaleLowerCase("en-US") === "k";

/** The text to submit: trimmed, and never longer than the interpreter accepts. Empty text submits nothing. */
export const textToSubmit = (value: string): string | undefined => {
  const text = value.trim();
  return text.length === 0 ? undefined : text.slice(0, ASSISTANT_INSTRUCTION_MAX_LENGTH);
};

/**
 * A minimal single-line command input, hidden until it is invoked. Enter submits through the same function that submits a
 * transcribed text, Escape closes it, and the field is cleared on submit. The text lives only in this field: it is never stored
 * or logged here.
 */
export const CommandInput = ({ onSubmit, onClose }: { onSubmit: (text: string) => void; onClose: () => void }) => {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = textToSubmit(field.current?.value ?? "");
    if (field.current) field.current.value = "";
    if (text === undefined) return;
    onSubmit(text);
    onClose();
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (field.current) field.current.value = "";
    onClose();
  };

  return <form className="command-input" onSubmit={submit}>
    <input
      aria-label={COMMAND_INPUT_LABEL}
      autoComplete="off"
      className="command-input__field"
      maxLength={ASSISTANT_INSTRUCTION_MAX_LENGTH}
      onKeyDown={keyDown}
      placeholder={COMMAND_INPUT_PLACEHOLDER}
      ref={field}
      spellCheck={false}
      type="text"
    />
  </form>;
};
