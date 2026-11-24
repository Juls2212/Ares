import type { OrbSignal } from "../../orb/orb-runtime";

/** RMS of a time-domain byte buffer (128 is silence), scaled so ordinary speech reaches roughly 0.5 to 0.9. */
export const levelFromTimeDomain = (samples: ArrayLike<number>): number => {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = (samples[index]! - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.max(0, rms * 3.2));
};

type AudioContextLike = {
  state: string;
  resume: () => Promise<void>;
  destination: unknown;
  createMediaElementSource: (element: HTMLMediaElement) => { connect: (node: unknown) => unknown };
  createAnalyser: () => { fftSize: number; connect: (node: unknown) => unknown; getByteTimeDomainData: (array: Uint8Array<ArrayBuffer>) => void };
};

let sharedContext: AudioContextLike | undefined;
const getContext = (): AudioContextLike | undefined => {
  try {
    const Constructor = (window as unknown as { AudioContext?: new () => AudioContextLike }).AudioContext;
    sharedContext ??= Constructor ? new Constructor() : undefined;
  } catch {
    sharedContext = undefined;
  }
  return sharedContext;
};

/**
 * Taps the response audio with a Web Audio analyser so the orb can follow the voice. It is renderer-only: no IPC, no
 * second stream, and the audio keeps reaching the speakers. If the context is not running the element is NOT rerouted
 * (rerouting through a suspended context would silence the voice), and the orb uses its simulated envelope instead.
 */
export const attachPlaybackLevel = (audio: HTMLMediaElement, signal: OrbSignal, contextFactory: () => AudioContextLike | undefined = getContext): void => {
  try {
    const context = contextFactory();
    if (!context) return;
    if (context.state !== "running") { void context.resume().catch(() => undefined); return; }
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    const buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    const sampler = (): number => {
      analyser.getByteTimeDomainData(buffer);
      return levelFromTimeDomain(buffer);
    };
    const release = (): void => { if (signal.sampler === sampler) signal.sampler = undefined; };
    audio.addEventListener("playing", () => { signal.sampler = sampler; });
    for (const event of ["ended", "pause", "error", "emptied"]) audio.addEventListener(event, release);
  } catch {
    // Without an analyser the orb keeps its simulated envelope.
  }
};
