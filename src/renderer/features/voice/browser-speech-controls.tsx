import { speechStateLabels, type SpeechState } from "./browser-speech-adapter";

export const BrowserSpeechControls = ({ blocked, onText, onStateChange }: {
  blocked: boolean; onText: (text: string) => void; onStateChange: (state: SpeechState) => void;
}) => {
  // Retired compatibility component: browser recognition must never capture audio.
  return <section className="voice-controls" aria-label="Dictado por reconocimiento del navegador">
    <button type="button" className="voice-button" aria-pressed={false} disabled>
      Activar micrófono para dictar
    </button>
    <p role="status" aria-live="polite" className="live-status">{speechStateLabels.UNAVAILABLE}</p>
  </section>;
};
