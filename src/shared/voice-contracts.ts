import type { OperationResult } from "./contracts";

export const VOICE_ALLOWED_MIME_TYPES = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus"
] as const;

export type VoiceMimeType = (typeof VOICE_ALLOWED_MIME_TYPES)[number];
export const VOICE_MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_RECORDING_DURATION_MS = 60_000;

/** A bounded browser-captured audio payload. It contains no file path or device metadata. */
export type VoiceTranscriptionInput = {
  audio: ArrayBuffer;
  mimeType: VoiceMimeType;
};

export type VoiceTranscriptionData = { text: string };

export const VOICE_ERROR_CODES = {
  inputInvalid: "VOICE_INPUT_INVALID",
  audioEmpty: "VOICE_AUDIO_EMPTY",
  audioTooLarge: "VOICE_AUDIO_TOO_LARGE",
  mimeUnsupported: "VOICE_MIME_UNSUPPORTED",
  configuration: "VOICE_CONFIGURATION_UNAVAILABLE",
  authentication: "VOICE_AUTHENTICATION_UNAVAILABLE",
  modelAccess: "VOICE_MODEL_ACCESS_UNAVAILABLE",
  rateLimited: "VOICE_RATE_LIMITED",
  provider: "VOICE_PROVIDER_UNAVAILABLE",
  ipcUnavailable: "VOICE_IPC_UNAVAILABLE"
} as const;

export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[keyof typeof VOICE_ERROR_CODES];
export type VoiceOperationResult<T> = OperationResult<T>;

export type VoiceApi = {
  transcribe: (
    input: VoiceTranscriptionInput
  ) => Promise<VoiceOperationResult<VoiceTranscriptionData>>;
  onGlobalShortcut: (callback: () => void) => () => void;
};
