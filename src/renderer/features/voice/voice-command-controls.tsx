import type { RefObject } from "react";

type VoiceCommandControlsProperties = {
  state: "IDLE" | "RECORDING" | "PROCESSING";
  message?: string;
  onStart: () => void;
  onCancel: () => void;
  disabled?: boolean;
  processingInstruction?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
};

export const VoiceCommandControls = ({ state, message, onStart, onCancel, disabled, processingInstruction, triggerRef }: VoiceCommandControlsProperties) => {
  const visibleMessage = message === "Instrucción procesada. Revisa el resultado y confirma si se requiere."
    ? undefined
    : message;

  return <section aria-label="Controles de voz" className="voice-controls">
    {state === "IDLE" && <><p className="voice-state" id="voice-state">Toca para hablar</p><button aria-describedby="voice-state" aria-label="Iniciar grabación por voz" className="voice-button voice-button--microphone" disabled={disabled} onClick={onStart} ref={triggerRef} title="Hablar con Ares" type="button"><span aria-hidden="true">🎙</span></button></>}
    {state === "RECORDING" && <>
      <p className="voice-state" role="status">Escuchando…</p>
      <button className="quiet-button" onClick={onCancel} type="button">Cancelar</button>
    </>}
    {state === "PROCESSING" && <>
      <p className="voice-state" role="status">{processingInstruction ? "Procesando instrucción…" : "Procesando…"}</p>
      <button className="quiet-button" onClick={onCancel} type="button">Cancelar</button>
    </>}
    {visibleMessage && <p aria-live="polite" className="voice-state voice-state--message">{visibleMessage}</p>}
  </section>;
};
