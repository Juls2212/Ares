import { getOpenAiSpeechConfiguration } from "../src/main/config/openai-environment";
import { createOpenAiSpeechProvider } from "../src/main/voice/openai-speech-provider";
import { SPEECH_LIMITS } from "../src/shared/speech-contracts";

/** Explicit opt-in only. Emits a category, never audio, text, credentials or provider details. */
export const run = async (): Promise<void> => {
  if (process.env.ARES_LIVE_SPEECH_CHECK !== "1") throw new Error("LIVE_SPEECH_NOT_AUTHORIZED");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SPEECH_LIMITS.timeoutMs);
  try {
    const provider = createOpenAiSpeechProvider(getOpenAiSpeechConfiguration().apiKey);
    const result = await provider("La voz de Ares es generada por IA.", abort.signal);
    console.log(result.audio.byteLength > 0 && result.audio.byteLength <= SPEECH_LIMITS.audioBytes && result.mimeType === "audio/mpeg" ? "LIVE_SPEECH_SUCCESS" : "LIVE_SPEECH_INVALID_AUDIO");
  } catch {
    console.log(abort.signal.aborted ? "LIVE_SPEECH_TIMEOUT" : "LIVE_SPEECH_UNAVAILABLE");
  } finally { clearTimeout(timer); }
};
