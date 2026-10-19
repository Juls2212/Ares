export const SPEECH_END_SILENCE_MS = 1_700;
export const SPEECH_ACTIVITY_THRESHOLD = 0.025;
const VOICE_LEVEL_NOISE_FLOOR = 0.008;
const VOICE_LEVEL_RANGE = 0.16;
const VOICE_LEVEL_ATTACK = 0.38;
const VOICE_LEVEL_RELEASE = 0.18;

type AnalyserLike = {
  fftSize: number;
  getByteTimeDomainData: (values: Uint8Array<ArrayBuffer>) => void;
};

type AudioContextLike = {
  createAnalyser: () => AnalyserLike;
  createMediaStreamSource: (stream: MediaStream) => { connect: (target: AnalyserLike) => void; disconnect?: () => void };
  resume?: () => Promise<void>;
  close?: () => Promise<void>;
};

type SpeechEndDetectorDependencies = {
  createAudioContext?: () => AudioContextLike | undefined;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  onSpeechEnded: () => void;
  onLevel?: (level: number) => void;
};

export type SpeechEndDetector = {
  start: (stream: MediaStream) => boolean;
  hasDetectedSpeech: () => boolean;
  dispose: () => void;
};

const measureLevel = (values: Uint8Array): number => {
  let total = 0;
  for (const value of values) {
    const sample = (value - 128) / 128;
    total += sample * sample;
  }
  return Math.sqrt(total / values.length);
};

export const normalizeVoiceLevel = (level: number): number => {
  if (!Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, (level - VOICE_LEVEL_NOISE_FLOOR) / VOICE_LEVEL_RANGE));
};

/** Renderer-only end-of-speech monitor. It never records, stores, or uploads audio. */
export const createSpeechEndDetector = (dependencies: SpeechEndDetectorDependencies): SpeechEndDetector => {
  const now = dependencies.now ?? (() => performance.now());
  // Animation frames pause in a hidden window, which would stall silence detection during background
  // operation; a hidden document falls back to a short timer. Timer handles are encoded as negatives.
  const requestFrame = dependencies.requestFrame ?? ((callback) =>
    typeof document !== "undefined" && document.hidden
      ? -window.setTimeout(() => callback(performance.now()), 100)
      : requestAnimationFrame(callback));
  const cancelFrame = dependencies.cancelFrame ?? ((handle) => {
    if (handle < 0) window.clearTimeout(-handle);
    else cancelAnimationFrame(handle);
  });
  let animationFrame: number | undefined;
  let context: AudioContextLike | undefined;
  let source: { connect: (target: AnalyserLike) => void; disconnect?: () => void } | undefined;
  let analyser: AnalyserLike | undefined;
  let speechDetected = false;
  let silenceStartedAt: number | undefined;
  let ended = false;
  let smoothedLevel = 0;

  const resetLevel = (): void => {
    smoothedLevel = 0;
    dependencies.onLevel?.(0);
  };

  const dispose = (): void => {
    if (animationFrame !== undefined) cancelFrame(animationFrame);
    animationFrame = undefined;
    source?.disconnect?.();
    source = undefined;
    const closingContext = context;
    context = undefined;
    analyser = undefined;
    resetLevel();
    if (closingContext?.close) void closingContext.close().catch(() => undefined);
  };

  const poll = (): void => {
    if (!analyser || ended) return;
    const values = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    const measuredLevel = measureLevel(values);
    const normalizedLevel = normalizeVoiceLevel(measuredLevel);
    const smoothing = normalizedLevel > smoothedLevel ? VOICE_LEVEL_ATTACK : VOICE_LEVEL_RELEASE;
    smoothedLevel += (normalizedLevel - smoothedLevel) * smoothing;
    dependencies.onLevel?.(Math.min(1, Math.max(0, smoothedLevel)));
    const current = now();
    if (measuredLevel >= SPEECH_ACTIVITY_THRESHOLD) {
      speechDetected = true;
      silenceStartedAt = undefined;
    } else if (speechDetected) {
      silenceStartedAt ??= current;
      if (current - silenceStartedAt >= SPEECH_END_SILENCE_MS) {
        ended = true;
        resetLevel();
        dependencies.onSpeechEnded();
        return;
      }
    }
    animationFrame = requestFrame(poll);
  };

  return {
    start(stream): boolean {
      try {
        const constructor = dependencies.createAudioContext ?? (() => {
          const source = globalThis as typeof globalThis & { webkitAudioContext?: new () => AudioContextLike };
          const AudioContextConstructor = source.AudioContext ?? source.webkitAudioContext;
          return AudioContextConstructor ? new AudioContextConstructor() : undefined;
        });
        context = constructor() as AudioContextLike | undefined;
        if (!context) return false;
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        if (context.resume) void context.resume().catch(() => undefined);
        animationFrame = requestFrame(poll);
        return true;
      } catch {
        dispose();
        return false;
      }
    },
    hasDetectedSpeech: () => speechDetected,
    dispose
  };
};
