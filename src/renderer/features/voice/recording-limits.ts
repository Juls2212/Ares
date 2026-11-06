/**
 * Longest live voice recording the renderer allows: the recorder stops by itself at this point.
 * It stays below the 60 s bound that Main enforces (VOICE_MAX_RECORDING_DURATION_MS) and silence detection still ends it earlier.
 */
export const LIVE_RECORDING_LIMIT_MS = 30_000;
