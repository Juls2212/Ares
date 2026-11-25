/**
 * Microphone capture settings for spoken commands. One source of truth for the renderer.
 *
 * Mono, with the browser's echo cancellation, noise suppression and automatic gain control on, gives the
 * transcription model one clean channel at a steady level. The values are plain preferences (not `exact`), so a
 * microphone that cannot honor one of them still opens instead of failing with OverconstrainedError.
 */
export const VOICE_AUDIO_CONSTRAINTS = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
} as const;

/** Opus bitrate for the recording. Speech is clear well below this; it stays far under the 5 MB payload bound. */
export const VOICE_AUDIO_BITS_PER_SECOND = 64_000;

/**
 * Recordings shorter than this are not sent: a tap or a click carries no sentence and only invites a mistranscription.
 * The upper bound stays the existing LIVE_RECORDING_LIMIT_MS (30 s) and VOICE_MAX_RECORDING_DURATION_MS (60 s).
 */
export const VOICE_MIN_RECORDING_MS = 400;

export const VOICE_TOO_SHORT_RECORDING_MESSAGE = "La grabación fue muy corta. Mantén el micrófono y di una frase corta y natural.";
