import OpenAI, { toFile } from "openai";

import type { VoiceMimeType } from "../../shared/voice-contracts";
import type { OpenAiTranscriptionConfiguration } from "../config/openai-environment";

export type OpenAiTranscriptionProvider = {
  transcribe: (input: { audio: ArrayBuffer; mimeType: VoiceMimeType; signal: AbortSignal }) => Promise<string>;
};

/** Fixed recognition hint: a compile-time constant naming Ares and the known apps. It never contains user data. */
export const TRANSCRIPTION_PROMPT_HINT = "Ares, abre Spotify, WhatsApp, Google, Claude o Discord.";

const extensionFor = (mimeType: VoiceMimeType): "webm" | "ogg" =>
  mimeType.startsWith("audio/ogg") ? "ogg" : "webm";

/** Main-only in-memory OpenAI audio adapter. It never writes a recording to disk. */
export const createOpenAiTranscriptionProvider = (
  configuration: OpenAiTranscriptionConfiguration
): OpenAiTranscriptionProvider => {
  const client = new OpenAI({ apiKey: configuration.apiKey, timeout: 20_000, maxRetries: 0 });

  return {
    async transcribe({ audio, mimeType, signal }): Promise<string> {
      const file = await toFile(new Uint8Array(audio), `recording.${extensionFor(mimeType)}`, { type: mimeType });
      const result = await client.audio.transcriptions.create(
        {
          file,
          model: configuration.transcriptionModel,
          response_format: "json",
          language: "es",
          prompt: TRANSCRIPTION_PROMPT_HINT
        },
        { signal }
      );
      return result.text;
    }
  };
};
