import type { OperationResult } from "./contracts";

export type SpokenResponse = { responseId: string; text: string };
export type SpeechAudio = { audio: ArrayBuffer; mimeType: "audio/mpeg" };
export type SpeechApi = {
  speak: (input: { responseId: string }) => Promise<OperationResult<SpeechAudio>>;
};
/** The on-screen text of an agenda answer (up to 12 items) may be longer than an ordinary response. */
export const AGENDA_TEXT_CHARACTERS = 1_200;
export const SPEECH_LIMITS = { textCharacters: 400, audioBytes: 2 * 1024 * 1024, timeoutMs: 20_000, responseLifetimeMs: 300_000 } as const;
