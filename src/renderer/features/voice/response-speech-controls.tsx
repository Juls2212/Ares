import { useEffect, useRef, useState } from "react";
import type { SpokenResponse } from "../../../shared/speech-contracts";
import { createResponsePlayback, type PlaybackState } from "./response-playback";
import { shouldAutomaticallySpeak } from "./speech-eligibility";

export const ResponseSpeechControls = ({ response, blocked, automatic, onAutomaticChange }: { response?: SpokenResponse; blocked: boolean; automatic: boolean; onAutomaticChange: (enabled: boolean) => void }) => {
  const [state, setState] = useState<PlaybackState>("IDLE");
  const playback = useRef<ReturnType<typeof createResponsePlayback> | undefined>(undefined);
  const seen = useRef<string | undefined>(undefined);
  const auto = useRef(automatic);
  auto.current = automatic;
  useEffect(() => {
    const controller = createResponsePlayback({
      speak: (input) => window.ares.speech.speak(input), createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url), createAudio: (url) => new Audio(url), onState: setState,
      onFailure: (category) => { if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.error(`Response playback failed [${category}].`); },
      onDiagnostic: (category) => { if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.info(`Response playback event [${category}].`); }
    });
    playback.current = controller;
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") controller.stop(); };
    const hidden = (): void => { if (document.hidden) controller.stop(); };
    document.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", controller.stop);
    return () => {
      controller.stop(); playback.current = undefined;
      document.removeEventListener("keydown", escape); document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", controller.stop);
    };
  }, []);
  useEffect(() => {
    if (blocked || !response) { playback.current?.stop(); return; }
    if (seen.current !== response.responseId) {
      playback.current?.stop();
      const eligible = shouldAutomaticallySpeak({ enabled: auto.current, blocked, hidden: document.hidden, responseId: response.responseId, previousId: seen.current });
      seen.current = response.responseId;
      if (eligible) void playback.current?.play(response.responseId);
    }
  }, [response?.responseId, blocked]);
  return <section aria-label="Voz de la respuesta" className="response-speech-controls">
    <p>La voz de Ares es generada por IA.</p>
    <label><input type="checkbox" checked={automatic} onChange={(event) => { auto.current = event.target.checked; onAutomaticChange(event.target.checked); if (!event.target.checked) playback.current?.stop(); }} /> Leer respuestas automáticamente</label>
    <button type="button" disabled={!response || blocked || state === "LOADING" || state === "PLAYING"} onClick={() => { if (response && !blocked && !document.hidden) void playback.current?.play(response.responseId); }}>Escuchar respuesta</button>
    {(state === "PLAYING" || state === "LOADING") && <button type="button" onClick={() => playback.current?.stop()}>Detener voz</button>}
    <p aria-live="polite">{state === "LOADING" ? "Generando voz…" : state === "PLAYING" ? "Reproduciendo voz…" : state === "FINISHED" ? "Voz finalizada" : state === "ERROR" ? "No se pudo iniciar o continuar la voz. Puedes seguir leyendo la respuesta." : ""}</p>
  </section>;
};
