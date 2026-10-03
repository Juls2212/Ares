type VoiceCommandControlsProperties = {
  state: "IDLE" | "RECORDING" | "PROCESSING";
  message?: string;
  onStart: () => void;
  onCancel: () => void;
  disabled?: boolean;
  processingInstruction?: boolean;
};

export const VoiceCommandControls = ({ state, message, onStart, onCancel, disabled, processingInstruction }: VoiceCommandControlsProperties) => {
  const visibleMessage = message === "Instrucción procesada. Revisa el resultado y confirma si se requiere."
    ? undefined
    : message;

  return <section aria-label="Controles de voz" className="voice-controls">
    <p className="command-prompt">¿En qué trabajamos hoy, Juli?</p>
    {state === "IDLE" && <button aria-label="Iniciar grabación por voz" className="voice-button voice-button--microphone" disabled={disabled} onClick={onStart} title="Hablar con Ares" type="button"><span aria-hidden="true">🎙</span></button>}
    {state === "RECORDING" && <>
      <p className="live-status" role="status">Escuchando…</p>
      <button className="quiet-button" onClick={onCancel} type="button">Cancelar</button>
    </>}
    {state === "PROCESSING" && <>
      <p className="live-status" role="status">{processingInstruction ? "Procesando instrucción…" : "Procesando…"}</p>
      <button className="quiet-button" onClick={onCancel} type="button">Cancelar</button>
    </>}
    {visibleMessage && <p aria-live="polite" className="live-status">{visibleMessage}</p>}
  </section>;
};
