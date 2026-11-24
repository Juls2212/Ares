import { randomUUID } from "node:crypto";
import type { OperationResult } from "../../shared/contracts";
import { AGENDA_TEXT_CHARACTERS, SPEECH_LIMITS, type SpeechAudio, type SpokenResponse } from "../../shared/speech-contracts";
import { SPOKEN_CAP_AGENDA, SPOKEN_CAP_DEFAULT, capSpokenText } from "./spoken-text-cap";
import { MainConfigurationError } from "../config/database-environment";

/** Optional facts about the response, kept in Main only. An agenda is spoken with its own text and the agenda cap. */
export type RememberOptions = { spokenText?: string; agenda?: boolean };

export type SpeechProvider = (text: string, signal: AbortSignal) => Promise<SpeechAudio>;
const failure = (code: string): OperationResult<SpeechAudio> => {
  // Codes originate only from the closed failure branches below, never upstream errors.
  console.error(`Response speech failed [${code}].`);
  return { ok: false, error: { code, userMessage: code === "SPEECH_BUSY" ? "La voz está ocupada. Intenta de nuevo en un momento." : "No pude reproducir la voz. Puedes seguir leyendo la respuesta." } };
};

export const createSpeechService = (provider: () => SpeechProvider, clock = Date.now, timeoutMs: number = SPEECH_LIMITS.timeoutMs) => {
  const responses = new Map<number, { response: SpokenResponse; expires: number; abort?: AbortController; spokenText?: string; agenda?: boolean }>();
  let busy = false;
  const clear = (windowId: number): void => { responses.get(windowId)?.abort?.abort(); responses.delete(windowId); };
  return {
    clear,
    remember(windowId: number, text: string, options: RememberOptions = {}): SpokenResponse | undefined {
      clear(windowId);
      const limit = options.agenda ? AGENDA_TEXT_CHARACTERS : SPEECH_LIMITS.textCharacters;
      if (!text.trim() || text.length > limit) return undefined;
      if (options.spokenText !== undefined && (!options.spokenText.trim() || options.spokenText.length > limit)) return undefined;
      const response = { responseId: randomUUID(), text };
      responses.set(windowId, {
        response, expires: clock() + SPEECH_LIMITS.responseLifetimeMs,
        ...(options.spokenText === undefined ? {} : { spokenText: options.spokenText }), ...(options.agenda ? { agenda: true } : {})
      });
      return response;
    },
    async speak(windowId: number, input: unknown): Promise<OperationResult<SpeechAudio>> {
      const entry = responses.get(windowId);
      if (!input || typeof input !== "object" || Object.keys(input).join() !== "responseId" || !entry || entry.expires <= clock() || (input as { responseId?: unknown }).responseId !== entry.response.responseId) return failure("SPEECH_RESPONSE_INVALID");
      if (busy) return failure("SPEECH_BUSY");
      busy = true;
      const abort = new AbortController(); entry.abort = abort;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const audio = await Promise.race([
          provider()(capSpokenText(entry.spokenText ?? entry.response.text, entry.agenda ? SPOKEN_CAP_AGENDA : SPOKEN_CAP_DEFAULT), abort.signal),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error("TIMEOUT")); }, timeoutMs); })
        ]);
        if (abort.signal.aborted || responses.get(windowId) !== entry) return failure("SPEECH_RESPONSE_INVALID");
        if (audio.mimeType !== "audio/mpeg" || !(audio.audio instanceof ArrayBuffer) || audio.audio.byteLength === 0 || audio.audio.byteLength > SPEECH_LIMITS.audioBytes) return failure("SPEECH_AUDIO_INVALID");
        return { ok: true, data: audio };
      } catch (error) {
        const code = abort.signal.aborted ? "SPEECH_TIMEOUT" : error instanceof MainConfigurationError ? "SPEECH_CONFIGURATION_UNAVAILABLE" : "SPEECH_PROVIDER_UNAVAILABLE";
        return failure(code);
      } finally { if (timer) clearTimeout(timer); busy = false; entry.abort = undefined; }
    }
  };
};
