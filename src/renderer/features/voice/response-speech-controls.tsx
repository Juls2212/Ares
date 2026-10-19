import { useEffect, useRef, useState, type RefObject } from "react";
import type { SpokenResponse } from "../../../shared/speech-contracts";
import { createResponsePlayback, type PlaybackEvent, type PlaybackState } from "./response-playback";
import { shouldAutomaticallySpeak } from "./speech-eligibility";

export const ResponseSpeechControls = ({ response, blocked, onPlaybackEvent, onPlaybackState, stopRef, headless = false }: {
  response?: SpokenResponse;
  blocked: boolean;
  onPlaybackEvent?: (event: PlaybackEvent) => void;
  onPlaybackState?: (state: PlaybackState) => void;
  stopRef?: RefObject<(() => void) | undefined>;
  headless?: boolean;
}) => {
  const [state, setState] = useState<PlaybackState>("IDLE");
  const playback = useRef<ReturnType<typeof createResponsePlayback> | undefined>(undefined);
  const seen = useRef<string | undefined>(undefined);
  const playbackEvent = useRef(onPlaybackEvent);
  const playbackState = useRef(onPlaybackState);
  playbackEvent.current = onPlaybackEvent;
  playbackState.current = onPlaybackState;
  useEffect(() => {
    const controller = createResponsePlayback({
      speak: (input) => window.ares.speech.speak(input), createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url), createAudio: (url) => new Audio(url), onState: (nextState) => { setState(nextState); playbackState.current?.(nextState); },
      onFailure: (category) => { if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.error(`Response playback failed [${category}].`); },
      onDiagnostic: (category) => { if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.info(`Response playback event [${category}].`); },
      onPlaybackEvent: (event) => playbackEvent.current?.(event)
    });
    playback.current = controller;
    if (stopRef) stopRef.current = controller.stop;
    const escape = (event: KeyboardEvent): void => { if (event.key === "Escape") controller.stop(); };
    // Minimizing or hiding the window must not stop speech: only Escape and real teardown do.
    document.addEventListener("keydown", escape);
    window.addEventListener("pagehide", controller.stop);
    return () => {
      controller.stop(); playback.current = undefined;
      if (stopRef) stopRef.current = undefined;
      document.removeEventListener("keydown", escape);
      window.removeEventListener("pagehide", controller.stop);
    };
  }, []);
  useEffect(() => {
    if (blocked || !response) { playback.current?.stop(); return; }
    if (seen.current !== response.responseId) {
      playback.current?.stop();
      const eligible = shouldAutomaticallySpeak({ enabled: true, blocked, hidden: false, responseId: response.responseId, previousId: seen.current });
      seen.current = response.responseId;
      if (eligible) void playback.current?.play(response.responseId);
    }
  }, [response?.responseId, blocked]);
  if (headless || !response || (blocked && state === "IDLE")) return null;
  return <section aria-label="Voz de la respuesta" className="response-speech-controls">
    <button type="button" disabled={!response || blocked || state === "LOADING" || state === "PLAYING"} onClick={() => { if (response && !blocked) void playback.current?.play(response.responseId); }}>Escuchar respuesta</button>
    {state === "PLAYING" && <button type="button" onClick={() => playback.current?.stop()}>Detener voz</button>}
    <p aria-live="polite">{state === "LOADING" ? "Generando voz…" : state === "PLAYING" ? "Reproduciendo voz…" : state === "FINISHED" ? "Voz finalizada" : state === "ERROR" ? "No se pudo iniciar o continuar la voz. Puedes seguir leyendo la respuesta." : ""}</p>
  </section>;
};
