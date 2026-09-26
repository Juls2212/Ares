import { randomUUID } from "node:crypto";
import type { OperationResult } from "../../shared/contracts";
import { SPEECH_LIMITS, type SpeechAudio, type SpokenResponse } from "../../shared/speech-contracts";
import { MainConfigurationError } from "../config/database-environment";

export type SpeechProvider = (text: string, signal: AbortSignal) => Promise<SpeechAudio>;
const failure = (code: string): OperationResult<SpeechAudio> => {
  // Codes originate only from the closed failure branches below, never upstream errors.
  console.error(`Response speech failed [${code}].`);
  return { ok: false, error: { code, userMessage: code === "SPEECH_BUSY" ? "La voz está ocupada. Intenta de nuevo en un momento." : "No pude reproducir la voz. Puedes seguir leyendo la respuesta." } };
};

export const createSpeechService = (provider: () => SpeechProvider, clock = Date.now, timeoutMs: number = SPEECH_LIMITS.timeoutMs) => {
  const responses = new Map<number, { response: SpokenResponse; expires: number; abort?: AbortController }>();
  let busy = false;
  const clear = (windowId: number): void => { responses.get(windowId)?.abort?.abort(); responses.delete(windowId); };
  return {
    clear,
    remember(windowId: number, text: string): SpokenResponse | undefined {
      clear(windowId);
      if (!text.trim() || text.length > SPEECH_LIMITS.textCharacters) return undefined;
      const response = { responseId: randomUUID(), text };
      responses.set(windowId, { response, expires: clock() + SPEECH_LIMITS.responseLifetimeMs });
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
          provider()(entry.response.text, abort.signal),
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
