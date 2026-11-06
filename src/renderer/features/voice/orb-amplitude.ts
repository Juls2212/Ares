/**
 * Maps the microphone level that the silence detector already measures to the orb's `amp` value. It owns no
 * audio: it only receives numbers, so recording, silence detection and cancellation are not touched.
 */
export const NOISE_FLOOR_WINDOW_MS = 300;
export const AMPLITUDE_RANGE = 0.25;
export const AMPLITUDE_ATTACK_MS = 60;
export const AMPLITUDE_RELEASE_MS = 220;
/** Speaking uses the same mapping, attenuated for a softer pulse. */
export const SPEAKING_ATTENUATION = 0.55;
export const BLOB_SPEED_AMPLITUDE_GAIN = 1.2;

export const clampAmplitude = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** amp = clamp((rms − floor) / 0.25, 0, 1). */
export const amplitudeFromRms = (rms: number, floor: number): number => clampAmplitude((rms - floor) / AMPLITUDE_RANGE);

/** animation.playbackRate = stateSpeed × (1 + amp × 1.2). */
export const blobPlaybackRate = (stateSpeed: number, amplitude: number): number =>
  stateSpeed * (1 + clampAmplitude(amplitude) * BLOB_SPEED_AMPLITUDE_GAIN);

export type AmplitudeMapper = {
  /** Feeds one RMS measurement taken at `timeMs` and returns the smoothed amplitude (0..1). */
  push: (rms: number, timeMs: number) => number;
  reset: () => void;
  value: () => number;
};

/**
 * The noise floor is the mean RMS of the first 300 ms after a reset; the amplitude is then smoothed
 * asymmetrically (attack 60 ms, release 220 ms) with time-based exponential smoothing.
 */
export const createAmplitudeMapper = (): AmplitudeMapper => {
  let startedAt: number | undefined;
  let floorTotal = 0;
  let floorCount = 0;
  let floor = 0;
  let lastTime: number | undefined;
  let current = 0;

  return {
    push: (rms, timeMs) => {
      const safeRms = Number.isFinite(rms) && rms >= 0 ? rms : 0;
      startedAt ??= timeMs;
      if (timeMs - startedAt < NOISE_FLOOR_WINDOW_MS) {
        floorTotal += safeRms;
        floorCount += 1;
        floor = floorTotal / floorCount;
      }
      const target = amplitudeFromRms(safeRms, floor);
      const elapsed = lastTime === undefined ? 0 : Math.max(0, timeMs - lastTime);
      lastTime = timeMs;
      const timeConstant = target > current ? AMPLITUDE_ATTACK_MS : AMPLITUDE_RELEASE_MS;
      current += (target - current) * (1 - Math.exp(-elapsed / timeConstant));
      current = clampAmplitude(current);
      return current;
    },
    reset: () => {
      startedAt = undefined;
      floorTotal = 0;
      floorCount = 0;
      floor = 0;
      lastTime = undefined;
      current = 0;
    },
    value: () => current
  };
};

/** Gentle synthetic pulse for speaking when no real output level is read. Same shape as the prototype. */
export const syntheticSpeechAmplitude = (timeSeconds: number): number =>
  clampAmplitude((0.3 + 0.7 * Math.pow(Math.abs(Math.sin(timeSeconds * 3.4)), 3)) * SPEAKING_ATTENUATION);

export type OrbAmplitudeSource = {
  /** Called by the silence detector's existing analyser loop with the raw RMS. */
  pushMicRms: (rms: number) => void;
  /** Sets the amplitude to zero; called whenever recording ends or is cancelled. */
  reset: () => void;
  subscribe: (listener: (amplitude: number) => void) => () => void;
};

export const createOrbAmplitudeSource = (now: () => number = () => performance.now()): OrbAmplitudeSource => {
  const mapper = createAmplitudeMapper();
  const listeners = new Set<(amplitude: number) => void>();
  const publish = (amplitude: number): void => {
    for (const listener of listeners) listener(amplitude);
  };
  return {
    pushMicRms: (rms) => publish(mapper.push(rms, now())),
    reset: () => {
      mapper.reset();
      publish(0);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};

/** The single renderer-wide source shared by the detector wiring and the orb. */
export const orbAmplitudeSource: OrbAmplitudeSource = createOrbAmplitudeSource();
