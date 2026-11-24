import { SPEECH_LIMITS } from "../../../shared/speech-contracts";
import { SPOKEN_CAP_AGENDA, SPOKEN_CAP_DEFAULT, capSpokenText } from "../../../shared/spoken-text-cap";

/**
 * The Windows system voice (the browser speech synthesis) as the last-resort speech output, used only when no provider can
 * synthesize the answer (no OpenAI key and no ElevenLabs, or both unavailable). It runs entirely in the renderer: no IPC, no
 * network, nothing persisted and nothing logged. The text it speaks is the same already-capped text the providers would get.
 */

/** The failure codes of the speech channel that mean «no provider can speak»; every other failure keeps its own handling. */
export const SYSTEM_VOICE_FALLBACK_CODES: readonly string[] = ["SPEECH_CONFIGURATION_UNAVAILABLE", "SPEECH_PROVIDER_UNAVAILABLE"];

/** Shown once per session when the computer has no Spanish voice installed; the text stays on screen. */
export const NO_SYSTEM_VOICE_MESSAGE = "No hay una voz en español instalada en este equipo. Puedes leer la respuesta.";

/** The preferred regions, in order, before any other Spanish voice. */
export const SYSTEM_VOICE_PREFERRED_LANGUAGES = ["es-co", "es-mx", "es-es"] as const;

export type VoiceLike = { lang: string; name?: string };

const normalizeLanguage = (lang: string): string => lang.trim().replaceAll("_", "-").toLocaleLowerCase("en-US");

/** es-CO, then es-MX, then es-ES, then any other es-* (or plain es); the first of each tier wins. Undefined if none is Spanish. */
export const selectSpanishVoice = <T extends VoiceLike>(voices: readonly T[]): T | undefined => {
  for (const preferred of SYSTEM_VOICE_PREFERRED_LANGUAGES) {
    const match = voices.find((voice) => normalizeLanguage(voice.lang) === preferred);
    if (match) return match;
  }
  return voices.find((voice) => {
    const lang = normalizeLanguage(voice.lang);
    return lang === "es" || lang.startsWith("es-");
  });
};

/** The same cap the providers get: two sentences normally, the agenda cap for a long (agenda) answer. */
export const capForSystemVoice = (text: string): string =>
  capSpokenText(text, text.length > SPEECH_LIMITS.textCharacters ? SPOKEN_CAP_AGENDA : SPOKEN_CAP_DEFAULT);

export type UtteranceLike = {
  lang: string;
  voice: unknown;
  rate: number;
  pitch: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export type SynthesisLike<V extends VoiceLike = VoiceLike> = {
  getVoices: () => V[];
  speak: (utterance: never) => void;
  cancel: () => void;
  addEventListener?: (type: "voiceschanged", listener: () => void) => void;
  removeEventListener?: (type: "voiceschanged", listener: () => void) => void;
};

export type SystemVoiceHandlers = { onStart: () => void; onEnd: () => void; onError: () => void };
/** STARTED: speaking was requested and the handlers will be called. NO_VOICE: no Spanish voice. UNAVAILABLE: no speech synthesis. */
export type SystemVoiceStart = "STARTED" | "NO_VOICE" | "UNAVAILABLE";

export type SystemVoiceDependencies = {
  getSynthesis: () => SynthesisLike | undefined;
  createUtterance: (text: string) => UtteranceLike;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** How long to wait for the voice list when it is still empty (it loads lazily); default 1 second. */
  voicesWaitMs?: number;
};

export const createSystemVoice = (dependencies: SystemVoiceDependencies) => {
  const setTimer = dependencies.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const voicesWaitMs = dependencies.voicesWaitMs ?? 1_000;
  let generation = 0;

  const readVoices = (synthesis: SynthesisLike): VoiceLike[] => {
    try { return synthesis.getVoices(); } catch { return []; }
  };

  /** The voice list is empty until the engine has loaded it; wait for it for a moment instead of failing early. */
  const waitForVoices = (synthesis: SynthesisLike): Promise<VoiceLike[]> => new Promise((resolve) => {
    const initial = readVoices(synthesis);
    if (initial.length > 0 || !synthesis.addEventListener) { resolve(initial); return; }
    let done = false;
    let timer: unknown;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimer(timer);
      synthesis.removeEventListener?.("voiceschanged", finish);
      resolve(readVoices(synthesis));
    };
    synthesis.addEventListener?.("voiceschanged", finish);
    timer = setTimer(finish, voicesWaitMs);
  });

  const cancel = (): void => {
    generation += 1;
    try { dependencies.getSynthesis()?.cancel(); } catch { /* nothing to cancel */ }
  };

  return {
    cancel,
    /** Speaks the capped text. Never throws; the handlers report what happens next. */
    async speak(text: string, handlers: SystemVoiceHandlers): Promise<SystemVoiceStart> {
      const synthesis = dependencies.getSynthesis();
      if (!synthesis) return "UNAVAILABLE";
      const current = ++generation;
      const voice = selectSpanishVoice(await waitForVoices(synthesis));
      if (current !== generation) return "STARTED";
      if (!voice) return "NO_VOICE";
      const spoken = capForSystemVoice(text).trim();
      if (spoken.length === 0) return "NO_VOICE";
      try {
        const utterance = dependencies.createUtterance(spoken);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onstart = () => { if (current === generation) handlers.onStart(); };
        utterance.onend = () => { if (current === generation) handlers.onEnd(); };
        utterance.onerror = () => { if (current === generation) handlers.onError(); };
        synthesis.cancel();
        synthesis.speak(utterance as never);
        return "STARTED";
      } catch {
        return "UNAVAILABLE";
      }
    }
  };
};

/** The browser's real speech synthesis, or undefined where it does not exist. */
export const browserSynthesis = (): SynthesisLike | undefined => {
  try {
    return typeof window !== "undefined" && "speechSynthesis" in window ? (window.speechSynthesis as unknown as SynthesisLike) : undefined;
  } catch {
    return undefined;
  }
};

export const browserUtterance = (text: string): UtteranceLike => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike;
