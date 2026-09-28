export const SPEECH_END_SILENCE_MS = 1_700;
export const SPEECH_ACTIVITY_THRESHOLD = 0.025;

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

/** Renderer-only end-of-speech monitor. It never records, stores, or uploads audio. */
export const createSpeechEndDetector = (dependencies: SpeechEndDetectorDependencies): SpeechEndDetector => {
  const now = dependencies.now ?? (() => performance.now());
  const requestFrame = dependencies.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = dependencies.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  let animationFrame: number | undefined;
  let context: AudioContextLike | undefined;
  let source: { connect: (target: AnalyserLike) => void; disconnect?: () => void } | undefined;
  let analyser: AnalyserLike | undefined;
  let speechDetected = false;
  let silenceStartedAt: number | undefined;
  let ended = false;

  const dispose = (): void => {
    if (animationFrame !== undefined) cancelFrame(animationFrame);
    animationFrame = undefined;
    source?.disconnect?.();
    source = undefined;
    const closingContext = context;
    context = undefined;
    analyser = undefined;
    if (closingContext?.close) void closingContext.close().catch(() => undefined);
  };

  const poll = (): void => {
    if (!analyser || ended) return;
    const values = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    const current = now();
    if (measureLevel(values) >= SPEECH_ACTIVITY_THRESHOLD) {
      speechDetected = true;
      silenceStartedAt = undefined;
    } else if (speechDetected) {
      silenceStartedAt ??= current;
      if (current - silenceStartedAt >= SPEECH_END_SILENCE_MS) {
        ended = true;
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
