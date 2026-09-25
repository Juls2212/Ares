type VoiceCommandControlsProperties = {
  state: "IDLE" | "RECORDING" | "PROCESSING";
  message?: string;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
};

export const VoiceCommandControls = ({ state, message, onStart, onStop, onCancel }: VoiceCommandControlsProperties) => (
  <section aria-label="Controles de voz" className="voice-controls">
    {state === "IDLE" && <button className="voice-button" onClick={onStart} type="button">Iniciar grabación</button>}
    {state === "RECORDING" && <>
      <button className="voice-button" onClick={onStop} type="button">Detener grabación</button>
      <button className="quiet-button" onClick={onCancel} type="button">Cancelar grabación</button>
    </>}
    {state === "PROCESSING" && <p className="live-status" role="status">Transcribiendo...</p>}
    {message && <p aria-live="polite" className="live-status">{message}</p>}
  </section>
);
