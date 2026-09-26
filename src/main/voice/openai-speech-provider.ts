import OpenAI from "openai";
import { SPEECH_LIMITS } from "../../shared/speech-contracts";
import type { SpeechProvider } from "./speech-service";

export const createOpenAiSpeechProvider = (apiKey: string): SpeechProvider => {
  const client = new OpenAI({ apiKey, timeout: SPEECH_LIMITS.timeoutMs, maxRetries: 0 });
  return async (text, signal) => {
    const response = await client.audio.speech.create({
      model: "gpt-4o-mini-tts", voice: "onyx", input: text, response_format: "mp3",
      instructions: "Adult masculine voice, warm, calm, clear, natural Colombian Spanish, slightly deep tone, conversational but concise. Do not imitate a real person."
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
