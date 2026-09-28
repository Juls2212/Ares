import OpenAI from "openai";
import { SPEECH_LIMITS } from "../../shared/speech-contracts";
import type { SpeechProvider } from "./speech-service";
import { normalizeSpeechText } from "./speech-text-normalizer";

export const OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts";
export const OPENAI_SPEECH_VOICE = "onyx";
export const OPENAI_SPEECH_SPEED = 1.05;
export const OPENAI_SPEECH_INSTRUCTIONS = "Adult masculine voice, warm, calm, clear, natural Colombian Spanish with a slightly deep tone. Speak with a fluid, connected rhythm and a natural conversational pace. Use brief pauses only at genuine sentence boundaries. Avoid exaggerated pauses between short phrases, headings, labels, dates, list fragments, or punctuation. Keep the delivery concise and helpful. Do not imitate a real person.";

export const createOpenAiSpeechProvider = (apiKey: string): SpeechProvider => {
  const client = new OpenAI({ apiKey, timeout: SPEECH_LIMITS.timeoutMs, maxRetries: 0 });
  return async (text, signal) => {
    const response = await client.audio.speech.create({
      model: OPENAI_SPEECH_MODEL,
      voice: OPENAI_SPEECH_VOICE,
      speed: OPENAI_SPEECH_SPEED,
      input: normalizeSpeechText(text),
      response_format: "mp3",
      instructions: OPENAI_SPEECH_INSTRUCTIONS
    }, { signal });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/mpeg")) throw new Error("SPEECH_FORMAT");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SPEECH_EMPTY");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > SPEECH_LIMITS.audioBytes) throw new Error("SPEECH_SIZE");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const audio = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
    return { audio: audio.buffer, mimeType: "audio/mpeg" };
  };
};
