export type SpeechState = "READY" | "LISTENING" | "PROCESSING" | "EMPTY" | "UNAVAILABLE" | "SERVICE_UNAVAILABLE" | "MICROPHONE_UNAVAILABLE" | "DENIED" | "ERROR" | "INTERRUPTED";
export const speechStateLabels: Record<SpeechState, string> = {
  READY: "Listo para escuchar", LISTENING: "Escuchando…", PROCESSING: "Procesando…",
  EMPTY: "No se entendió la instrucción", UNAVAILABLE: "El reconocimiento de voz no está disponible en esta instalación. Puedes escribir tu instrucción.",
  DENIED: "No se permitió usar el micrófono. Puedes escribir tu instrucción.",
  SERVICE_UNAVAILABLE: "El reconocimiento de voz no está disponible en esta instalación. Puedes escribir tu instrucción.",
  MICROPHONE_UNAVAILABLE: "El navegador no puede capturar el micrófono. Puedes escribir tu instrucción.",
  ERROR: "No se pudo reconocer la voz. Puedes escribir tu instrucción.",
  INTERRUPTED: "La escucha se interrumpió. Puedes volver a intentarlo o escribir."
};
type SpeechResultEvent = { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
export type BrowserRecognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onaudiostart?: (() => void) | null; onaudioend?: (() => void) | null;
  onspeechstart?: (() => void) | null; onspeechend?: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecognitionConstructor = new () => BrowserRecognition;
export type SpeechDiagnostic = "START_REQUEST" | "START_EVENT" | "AUDIO_START" | "AUDIO_END" | "SPEECH_START" | "SPEECH_END" | "RESULT_FINAL" | "END_EVENT" | "STOP_REQUEST" | "ABORT_REQUEST" | "START_FAILED" | "STOP_FAILED" | "TIMEOUT" | "ERROR_NETWORK" | "ERROR_NOT_ALLOWED" | "ERROR_SERVICE_NOT_ALLOWED" | "ERROR_AUDIO_CAPTURE" | "ERROR_NO_SPEECH" | "ERROR_ABORTED" | "ERROR_LANGUAGE_NOT_SUPPORTED" | "ERROR_OTHER";
export const classifySpeechError = (error: unknown): { state: SpeechState; diagnostic: SpeechDiagnostic } => {
  switch (error) {
    case "network": return { state: "SERVICE_UNAVAILABLE", diagnostic: "ERROR_NETWORK" };
    case "not-allowed": return { state: "DENIED", diagnostic: "ERROR_NOT_ALLOWED" };
    case "service-not-allowed": return { state: "DENIED", diagnostic: "ERROR_SERVICE_NOT_ALLOWED" };
    case "audio-capture": return { state: "MICROPHONE_UNAVAILABLE", diagnostic: "ERROR_AUDIO_CAPTURE" };
    case "no-speech": return { state: "EMPTY", diagnostic: "ERROR_NO_SPEECH" };
    case "aborted": return { state: "INTERRUPTED", diagnostic: "ERROR_ABORTED" };
    case "language-not-supported": return { state: "UNAVAILABLE", diagnostic: "ERROR_LANGUAGE_NOT_SUPPORTED" };
    default: return { state: "ERROR", diagnostic: "ERROR_OTHER" };
  }
};
export const detectSpeechRecognition = (scope: unknown): RecognitionConstructor | undefined => {
  if (!scope || typeof scope !== "object") return undefined;
  const candidate = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const constructor = candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition;
  return typeof constructor === "function" ? constructor as RecognitionConstructor : undefined;
};

export const bindSpeechCancellation = (documentTarget: EventTarget, windowTarget: EventTarget, isHidden: () => boolean, cancel: () => void) => {
  const onKey = (event: Event) => { if ((event as KeyboardEvent).key === "Escape") cancel(); };
  const onVisibility = () => { if (isHidden()) cancel(); };
  documentTarget.addEventListener("keydown", onKey); documentTarget.addEventListener("visibilitychange", onVisibility);
  windowTarget.addEventListener("blur", cancel); windowTarget.addEventListener("pagehide", cancel);
  return () => {
    documentTarget.removeEventListener("keydown", onKey); documentTarget.removeEventListener("visibilitychange", onVisibility);
    windowTarget.removeEventListener("blur", cancel); windowTarget.removeEventListener("pagehide", cancel);
  };
};

export const createBrowserSpeechAdapter = (dependencies: {
  recognitionConstructor?: RecognitionConstructor;
  onState: (state: SpeechState) => void;
  onText: (text: string) => void;
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  onDiagnostic?: (code: SpeechDiagnostic) => void;
}) => {
  let recognition: BrowserRecognition | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let processing = false;
  const diagnose = (code: SpeechDiagnostic) => { try { dependencies.onDiagnostic?.(code); } catch { /* Diagnostics cannot affect capture. */ } };
  const release = () => {
    if (timer !== undefined) dependencies.clearTimer(timer);
    timer = undefined;
    const previous = recognition;
    recognition = undefined; processing = false;
    if (previous) {
      previous.onstart = previous.onend = previous.onresult = previous.onerror = null;
      previous.onaudiostart = previous.onaudioend = previous.onspeechstart = previous.onspeechend = null;
    }
    return previous;
  };
  const stop = () => {
    if (!recognition || processing) return;
    processing = true;
    diagnose("STOP_REQUEST");
    dependencies.onState("PROCESSING");
    if (timer !== undefined) dependencies.clearTimer(timer);
    timer = dependencies.setTimer(() => {
      const previous = release();
      diagnose("TIMEOUT");
      diagnose("ABORT_REQUEST");
      try { previous?.abort(); } catch { /* A stalled recognizer is never retried. */ }
      dependencies.onState("INTERRUPTED");
    }, 5000);
    try { recognition.stop(); } catch {
      diagnose("STOP_FAILED");
      const previous = release();
      try { previous?.abort(); } catch { /* Release capture on browser failure. */ }
      dependencies.onState("ERROR");
    }
  };
  const cancel = () => {
    const previous = release();
    if (previous) diagnose("ABORT_REQUEST");
    try { previous?.abort(); } catch { /* Cancellation never submits text. */ }
    if (!disposed && previous) dependencies.onState(dependencies.recognitionConstructor ? "READY" : "UNAVAILABLE");
  };
  return {
    supported: !!dependencies.recognitionConstructor,
    start: () => {
      if (disposed || recognition) return;
      if (!dependencies.recognitionConstructor) return dependencies.onState("UNAVAILABLE");
      let transcript = "";
      let failed = false;
      try {
        const current = new dependencies.recognitionConstructor(); recognition = current;
        current.lang = "es-CO"; current.continuous = false; current.interimResults = false; current.maxAlternatives = 1;
        const active = () => !disposed && recognition === current;
        current.onaudiostart = () => { if (active()) diagnose("AUDIO_START"); };
        current.onaudioend = () => { if (active()) diagnose("AUDIO_END"); };
        current.onspeechstart = () => { if (active()) diagnose("SPEECH_START"); };
        current.onspeechend = () => { if (active()) diagnose("SPEECH_END"); };
        current.onstart = () => { if (active() && !processing && !failed) { diagnose("START_EVENT"); dependencies.onState("LISTENING"); } };
        current.onresult = (event) => {
          if (!active() || failed) return;
          const pieces: string[] = [];
          for (let index = 0; index < Math.min(event.results.length, 20); index++) {
            const result = event.results[index];
            if (result.isFinal && typeof result[0]?.transcript === "string") pieces.push(result[0].transcript.slice(0, 2000));
          }
          transcript = pieces.join(" ").trim().slice(0, 2000);
          if (transcript) diagnose("RESULT_FINAL");
        };
        current.onerror = (event) => {
          if (!active() || failed) return;
          failed = true; processing = true; transcript = "";
          const classification = classifySpeechError(event.error);
          diagnose(classification.diagnostic);
          dependencies.onState(classification.state);
          if (timer !== undefined) dependencies.clearTimer(timer);
          // Allow the browser's terminal end event instead of masking it with abort.
          timer = dependencies.setTimer(() => {
            const previous = release(); diagnose("TIMEOUT"); diagnose("ABORT_REQUEST");
            try { previous?.abort(); } catch { /* Bound error cleanup without retry. */ }
          }, 5000);
        };
        current.onend = () => {
          if (!active()) return;
          diagnose("END_EVENT");
          release();
          if (failed) return;
          if (transcript) { dependencies.onText(transcript); dependencies.onState("READY"); }
          else dependencies.onState("EMPTY");
        };
        dependencies.onState("PROCESSING");
        timer = dependencies.setTimer(stop, 30_000);
        diagnose("START_REQUEST");
        current.start();
      } catch {
        diagnose("START_FAILED");
        const previous = release();
        try { previous?.abort(); } catch { /* Construction/start failures remain controlled. */ }
        dependencies.onState("UNAVAILABLE");
      }
    },
    stop, cancel,
    dispose: () => { disposed = true; cancel(); }
  };
};
