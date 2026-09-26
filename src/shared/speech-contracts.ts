import type { OperationResult } from "./contracts";

export type SpokenResponse = { responseId: string; text: string };
export type SpeechAudio = { audio: ArrayBuffer; mimeType: "audio/mpeg" };
export type SpeechApi = {
  speak: (input: { responseId: string }) => Promise<OperationResult<SpeechAudio>>;
};
export const SPEECH_LIMITS = { textCharacters: 400, audioBytes: 2 * 1024 * 1024, timeoutMs: 20_000, responseLifetimeMs: 300_000 } as const;
