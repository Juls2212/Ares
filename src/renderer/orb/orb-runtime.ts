/**
 * Everything around the orb drawing that is not drawing: the mutable signal the app writes to, the mapping from the
 * app's states to the orb's looks, the frame scheduler and the adaptive particle budget. None of it uses React state,
 * so a level change never re-renders a component.
 */
import { PARTICLE_COUNT, simulatedLevel, type OrbVisualState } from "./orb-renderer";

/** The state names the app already uses (voice, interpretation, action and playback). */
export type OrbState = "idle" | "recording" | "transcribing" | "interpreting" | "acting" | "speaking" | "error";

/** Processing, interpreting and acting all use the thinking look. */
export const orbVisualStateFor = (state: OrbState): OrbVisualState =>
  state === "recording" ? "listening"
    : state === "transcribing" || state === "interpreting" || state === "acting" ? "thinking"
      : state === "speaking" ? "speaking"
        : state === "error" ? "error"
          : "idle";

/** A real level older than this is ignored, so the simulated envelope takes over when an analyser stops reporting. */
export const REAL_LEVEL_MAXIMUM_AGE_MS = 400;

export type OrbSignal = {
  state: OrbVisualState;
  /** Last real level (0..1) and when it arrived; undefined while no analyser has reported. */
  level: number | undefined;
  levelAt: number;
  /** Optional reader for the playback analyser; it is only called while speaking. */
  sampler: (() => number | undefined) | undefined;
  /** When the theme-change pulse started (performance.now), or undefined when there is none. */
  pulseStart: number | undefined;
  /** True while a theme transition runs: about 30 fps, the minimum particle count and no shadow blur. */
  lowCost: boolean;
};

export const createOrbSignal = (): OrbSignal => ({ state: "idle", level: undefined, levelAt: 0, sampler: undefined, pulseStart: undefined, lowCost: false });

export const setOrbLevel = (signal: OrbSignal, level: number, now: number): void => {
  signal.level = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : undefined;
  signal.levelAt = now;
};

/** The level the orb should aim for: the real one if fresh, else the state's simulated envelope. */
export const targetLevelFor = (signal: OrbSignal, time: number, now: number): number => {
  if (signal.state === "speaking" && signal.sampler) {
    const sampled = signal.sampler();
    if (sampled !== undefined && Number.isFinite(sampled)) return Math.min(1, Math.max(0, sampled));
  }
  const fresh = signal.level !== undefined && now - signal.levelAt <= REAL_LEVEL_MAXIMUM_AGE_MS;
  if (fresh && (signal.state === "listening" || signal.state === "speaking")) return signal.level!;
  return simulatedLevel(signal.state, time);
};

/** The one signal shared by the voice code (writer) and the canvas loop (reader). */
export const orbSignal: OrbSignal = createOrbSignal();

/* ------------------------------ frame scheduler ------------------------------ */

export const ACTIVE_FRAME_INTERVAL_MS = 1000 / 60;
export const IDLE_FRAME_INTERVAL_MS = 1000 / 30;

export type FrameLoopDependencies = {
  requestFrame: (callback: (now: number) => void) => number;
  cancelFrame: (handle: number) => void;
  isHidden: () => boolean;
  /** Called for each frame that is drawn, with the time since the previous drawn frame in milliseconds. */
  draw: (now: number, frameMs: number) => void;
  isIdle: () => boolean;
};

export type FrameLoop = {
  /** Starts, or resumes after the page became visible. Does nothing while hidden. */
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

/**
 * requestAnimationFrame at full rate while the orb is active and about 30 frames per second while idle. It does not
 * schedule anything while the page is hidden or minimized; the caller calls start() again when it becomes visible.
 */
export const createFrameLoop = (dependencies: FrameLoopDependencies): FrameLoop => {
  let handle: number | undefined;
  let lastDrawn: number | undefined;
  const tick = (now: number): void => {
    handle = undefined;
    if (dependencies.isHidden()) { lastDrawn = undefined; return; }
    const interval = dependencies.isIdle() ? IDLE_FRAME_INTERVAL_MS : ACTIVE_FRAME_INTERVAL_MS;
    // A frame is allowed a little early so a 60 Hz display does not skip every other frame.
    if (lastDrawn === undefined || now - lastDrawn >= interval - 2) {
      const frameMs = lastDrawn === undefined ? ACTIVE_FRAME_INTERVAL_MS : now - lastDrawn;
      lastDrawn = now;
      dependencies.draw(now, frameMs);
    }
    handle = dependencies.requestFrame(tick);
  };
  return {
    start: () => {
      if (handle !== undefined || dependencies.isHidden()) return;
      lastDrawn = undefined;
      handle = dependencies.requestFrame(tick);
    },
    stop: () => {
      if (handle !== undefined) dependencies.cancelFrame(handle);
      handle = undefined;
      lastDrawn = undefined;
    },
    isRunning: () => handle !== undefined
  };
};

/* ------------------------------ particle budget ------------------------------ */

export const SLOW_FRAME_MS = 24;
export const FAST_FRAME_MS = 19;
export const BUDGET_WINDOW_MS = 1000;
export const MINIMUM_PARTICLES = 130;

export type ParticleBudget = { record: (frameMs: number, now: number) => number; count: () => number };

/** Halves the particle count when the average frame time over one second is above 24 ms; doubles it back when comfortably below. */
export const createParticleBudget = (maximum = PARTICLE_COUNT): ParticleBudget => {
  let count = maximum;
  let windowStart: number | undefined;
  let total = 0;
  let frames = 0;
  return {
    record: (frameMs, now) => {
      if (!Number.isFinite(frameMs) || frameMs <= 0) return count;
      windowStart ??= now;
      total += frameMs;
      frames += 1;
      if (now - windowStart >= BUDGET_WINDOW_MS) {
        const average = total / frames;
        if (average > SLOW_FRAME_MS) count = Math.max(MINIMUM_PARTICLES, Math.floor(count / 2));
        else if (average < FAST_FRAME_MS) count = Math.min(maximum, count * 2);
        windowStart = now;
        total = 0;
        frames = 0;
      }
      return count;
    },
    count: () => count
  };
};
