type VoiceCommandControlsProperties = {
  state: "IDLE" | "RECORDING" | "PROCESSING";
  message?: string;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  disabled?: boolean;
  processingInstruction?: boolean;
};

export const VoiceCommandControls = ({ state, message, onStart, onStop, onCancel, disabled, processingInstruction }: VoiceCommandControlsProperties) => (
  <section aria-label="Controles de voz" className="voice-controls">
    <p className="support-note">Al detener la grabación, el audio se enviará a OpenAI para convertirlo en texto y procesar tu instrucción. Las acciones directas pueden ejecutarse; las sensibles requieren confirmación. Puedes cancelarla sin enviarlo.</p>
    {state === "IDLE" && <><p className="live-status" role="status">Listo para grabar</p><button className="voice-button" disabled={disabled} onClick={onStart} type="button">Iniciar grabación</button></>}
    {state === "RECORDING" && <>
      <p className="live-status" role="status">Grabando…</p>
      <button className="voice-button" onClick={onStop} type="button">Detener y transcribir</button>
      <button className="quiet-button" onClick={onCancel} type="button">Cancelar</button>
    </>}
    {state === "PROCESSING" && <p className="live-status" role="status">{processingInstruction ? "Procesando instrucción…" : "Transcribiendo…"}</p>}
    {message && <p aria-live="polite" className="live-status">{message}</p>}
  </section>
);
