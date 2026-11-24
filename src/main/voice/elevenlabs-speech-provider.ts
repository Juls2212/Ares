import { SPEECH_LIMITS } from "../../shared/speech-contracts";
import { defineFailureTaxonomy } from "../../shared/failure-taxonomy";
import type { SpeechProvider } from "./speech-service";
import { normalizeSpeechText } from "./speech-text-normalizer";

/**
 * The only module allowed to call ElevenLabs. It receives the already-capped spoken text and nothing else from the person.
 * Every failure is one of the closed codes below; no provider text, key, voice id or spoken text ever reaches a message.
 */
export const ELEVENLABS_HOST = "api.elevenlabs.io";
export const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
export const ELEVENLABS_LANGUAGE_CODE = "es";
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_64";
export const ELEVENLABS_VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.35, speed: 1.05, use_speaker_boost: true } as const;
export const ELEVENLABS_TIMEOUT_MS = 8_000;
export const ELEVENLABS_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const ELEVENLABS_VOICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/u;

export const ELEVENLABS_FAILURES = defineFailureTaxonomy({
  ELEVENLABS_NOT_CONFIGURED: "La voz de ElevenLabs no está configurada.",
  ELEVENLABS_UNAUTHORIZED: "ElevenLabs no aceptó la clave de acceso.",
  ELEVENLABS_QUOTA_EXCEEDED: "Se agotó el cupo de voz de ElevenLabs.",
  ELEVENLABS_VOICE_NOT_FOUND: "ElevenLabs no encontró la voz elegida.",
  ELEVENLABS_UNAVAILABLE: "ElevenLabs no está disponible ahora.",
  ELEVENLABS_TIMEOUT: "ElevenLabs tardó demasiado en responder.",
  ELEVENLABS_RESPONSE_INVALID: "ElevenLabs envió un audio que no se puede usar."
});
export type ElevenLabsFailureCode = keyof typeof ELEVENLABS_FAILURES.messages;

/** Carries only a closed code as its message; it never wraps an upstream error. */
export class ElevenLabsSpeechError extends Error {
  constructor(readonly code: ElevenLabsFailureCode, readonly network = false) { super(code); this.name = "ElevenLabsSpeechError"; }
}

export type ElevenLabsConfiguration = { apiKey: string; voiceId: string };

const statusCode = (status: number): ElevenLabsFailureCode =>
  status === 401 || status === 403 ? "ELEVENLABS_UNAUTHORIZED"
    : status === 402 || status === 429 ? "ELEVENLABS_QUOTA_EXCEEDED"
      : status === 404 || status === 422 ? "ELEVENLABS_VOICE_NOT_FOUND"
        : status >= 500 ? "ELEVENLABS_UNAVAILABLE" : "ELEVENLABS_RESPONSE_INVALID";

const readBounded = async (response: Response): Promise<ArrayBuffer> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > ELEVENLABS_MAX_AUDIO_BYTES) throw new ElevenLabsSpeechError("ELEVENLABS_RESPONSE_INVALID");
  const reader = response.body?.getReader();
  if (!reader) throw new ElevenLabsSpeechError("ELEVENLABS_RESPONSE_INVALID");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > ELEVENLABS_MAX_AUDIO_BYTES) throw new ElevenLabsSpeechError("ELEVENLABS_RESPONSE_INVALID");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  if (size === 0) throw new ElevenLabsSpeechError("ELEVENLABS_RESPONSE_INVALID");
  const audio = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
  return audio.buffer;
};

const requestOnce = async (configuration: ElevenLabsConfiguration, text: string, signal: AbortSignal): Promise<ArrayBuffer> => {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ELEVENLABS_TIMEOUT_MS);
  try {
    if (signal.aborted) controller.abort();
    const url = `https://${ELEVENLABS_HOST}/v1/text-to-speech/${configuration.voiceId}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": configuration.apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL_ID, language_code: ELEVENLABS_LANGUAGE_CODE, voice_settings: ELEVENLABS_VOICE_SETTINGS }),
      redirect: "error",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new ElevenLabsSpeechError(statusCode(response.status)); }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("audio/")) { await response.body?.cancel().catch(() => undefined); throw new ElevenLabsSpeechError("ELEVENLABS_RESPONSE_INVALID"); }
    return await readBounded(response);
  } catch (error) {
    if (error instanceof ElevenLabsSpeechError) throw error;
    throw timedOut ? new ElevenLabsSpeechError("ELEVENLABS_TIMEOUT") : new ElevenLabsSpeechError("ELEVENLABS_UNAVAILABLE", true);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
};

export const createElevenLabsSpeechProvider = (configuration: ElevenLabsConfiguration | undefined): SpeechProvider => async (text, signal) => {
  if (!configuration || !configuration.apiKey || !ELEVENLABS_VOICE_ID_PATTERN.test(configuration.voiceId)) throw new ElevenLabsSpeechError("ELEVENLABS_NOT_CONFIGURED");
  const spoken = normalizeSpeechText(text);
  let audio: ArrayBuffer | undefined;
  // One retry, only for a network error that never produced a response.
  for (let attempt = 0; attempt < 2 && audio === undefined; attempt += 1) {
    try { audio = await requestOnce(configuration, spoken, signal); }
    catch (error) {
      const retryable = error instanceof ElevenLabsSpeechError && error.network && !signal.aborted && attempt === 0;
      if (!retryable) throw error;
    }
  }
  if (audio === undefined || audio.byteLength > SPEECH_LIMITS.audioBytes) throw new ElevenLabsSpeechError("ELEVENLABS_RESPONSE_INVALID");
  return { audio, mimeType: "audio/mpeg" };
};
