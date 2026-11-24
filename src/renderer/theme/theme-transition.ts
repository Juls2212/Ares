/**
 * The theme change animation: the sphere of the orb shows the new palette first, then the new theme expands from it as
 * a circular wave (View Transitions API, with a thin ring on the wave front). Everything else here is a fallback: without
 * the API, with reduced motion, while the window is hidden or while the window is being resized, the theme is applied
 * instantly. The native Windows title bar buttons are drawn by the OS, so they change color instantly; only the web
 * content animates.
 */
import type { ThemeName } from "./themes";

/**
 * The manual switch. "wave" is the circular wave, "fade" a cheap cross-fade of the root (opacity only), "instant" no
 * animation. Nothing changes it by itself: a slow run is only logged, never remembered. To switch the whole feature off,
 * change this one line to "instant" (or to "fade" for a gentler change).
 */
export type ThemeTransitionMode = "wave" | "fade" | "instant";
export const THEME_TRANSITION_MODE: ThemeTransitionMode = "wave";

/** Timing, in milliseconds. HOLD + EXPAND is the wave itself; SETTLE lets the ring fade at the full radius. */
export const THEME_TRANSITION = { holdMs: 160, expandMs: 700, settleMs: 90 } as const;
export const THEME_TRANSITION_TOTAL_MS = THEME_TRANSITION.holdMs + THEME_TRANSITION.expandMs + THEME_TRANSITION.settleMs;
export const THEME_FADE_MS = 250;
/** A run still "running" after this long is cleaned up by force, so no state can stay stuck. */
export const THEME_TRANSITION_WATCHDOG_MS = 2_000;
/** Ease-in-out for the expansion. */
export const THEME_TRANSITION_EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
/** The sphere radius in the orb renderer's 440-unit design box. */
export const ORB_CORE_RADIUS_UNITS = 58;
export const ORB_DESIGN_SIZE = 440;
/** The sphere pulse: a half sine over this many milliseconds, starting with the transition. */
export const THEME_PULSE_MS = 420;

/** A frame above this is counted as long in the log line. Pacing is only reported; it never changes the mode. */
export const FRAME_LONG_MS = 24;

export type Rect = { left: number; top: number; width: number; height: number };
export type WaveGeometry = { x: number; y: number; r0: number; rMax: number };

/**
 * Origin at the center of the CANVAS as displayed, R0 the sphere radius scaled by the canvas CSS size, Rmax the distance
 * to the farthest window corner. All values are viewport CSS pixels, the same space the clip-path and the ring use.
 */
export const computeWaveGeometry = (canvas: Rect, viewport: { width: number; height: number }): WaveGeometry => {
  const x = canvas.left + canvas.width / 2;
  const y = canvas.top + canvas.height / 2;
  const side = Math.min(canvas.width, canvas.height);
  const r0 = (ORB_CORE_RADIUS_UNITS * side) / ORB_DESIGN_SIZE;
  const rMax = Math.max(Math.hypot(x, y), Math.hypot(viewport.width - x, y), Math.hypot(x, viewport.height - y), Math.hypot(viewport.width - x, viewport.height - y));
  return { x, y, r0, rMax };
};

/** The clip-path of the new snapshot: one value shared by the CSS custom property and the animation start. */
export const waveClip = (radius: number, geometry: WaveGeometry): string => `circle(${radius}px at ${geometry.x}px ${geometry.y}px)`;

const fractionOf = (milliseconds: number): number => milliseconds / THEME_TRANSITION_TOTAL_MS;

/** Clip-path keyframes: hold at R0, expand to Rmax with the ease, stay there while the ring fades. */
export const waveKeyframes = (geometry: WaveGeometry): Keyframe[] => [
  { clipPath: waveClip(geometry.r0, geometry), offset: 0, easing: "linear" },
  { clipPath: waveClip(geometry.r0, geometry), offset: fractionOf(THEME_TRANSITION.holdMs), easing: THEME_TRANSITION_EASE },
  { clipPath: waveClip(geometry.rMax, geometry), offset: fractionOf(THEME_TRANSITION.holdMs + THEME_TRANSITION.expandMs) },
  { clipPath: waveClip(geometry.rMax, geometry), offset: 1 }
];

/** The ring travels with the wave front: scale from R0/Rmax to 1 in the same timing, then fades. Only transform and opacity. */
export const ringKeyframes = (geometry: WaveGeometry): Keyframe[] => {
  const start = geometry.rMax > 0 ? geometry.r0 / geometry.rMax : 1;
  return [
    { transform: `scale(${start})`, opacity: 1, offset: 0, easing: "linear" },
    { transform: `scale(${start})`, opacity: 1, offset: fractionOf(THEME_TRANSITION.holdMs), easing: THEME_TRANSITION_EASE },
    { transform: "scale(1)", opacity: 1, offset: fractionOf(THEME_TRANSITION.holdMs + THEME_TRANSITION.expandMs) },
    { transform: "scale(1)", opacity: 0, offset: 1 }
  ];
};

/** The cheap alternative: the new snapshot fades in, opacity only. */
export const fadeKeyframes = (): Keyframe[] => [{ opacity: 0 }, { opacity: 1 }];

/** The pulse of the orb: 0 before and after, a half sine in between. */
export const pulseAt = (elapsedMs: number): number => {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > THEME_PULSE_MS) return 0;
  return Math.sin((Math.PI * elapsedMs) / THEME_PULSE_MS);
};

/* ------------------------------ measurement ------------------------------ */

export type PacingStats = { frames: number; long: number; maxMs: number };

/** Counts requestAnimationFrame deltas: how many frames, how many above 24 ms, and the largest. */
export const createFramePacer = (): { record: (now: number) => void; stats: () => PacingStats } => {
  let last: number | undefined;
  const stats: PacingStats = { frames: 0, long: 0, maxMs: 0 };
  return {
    record: (now) => {
      if (!Number.isFinite(now)) return;
      if (last !== undefined) {
        const delta = now - last;
        if (delta >= 0) {
          stats.frames += 1;
          if (delta > FRAME_LONG_MS) stats.long += 1;
          if (delta > stats.maxMs) stats.maxMs = delta;
        }
      }
      last = now;
    },
    stats: () => ({ ...stats })
  };
};

/** Distance in pixels between the origin that was used and the canvas center measured afterwards. */
export const originDelta = (geometry: { x: number; y: number }, measured: Rect | undefined): number =>
  measured ? Math.hypot(geometry.x - (measured.left + measured.width / 2), geometry.y - (measured.top + measured.height / 2)) : 0;

export type TransitionDecision = "wave" | "fade" | "instant";
export type TransitionReason = "ok" | "reduced-motion" | "hidden" | "no-rect" | "resize" | "unsupported" | "error" | "mode";

/** The one console line per theme change. Whole numbers and two names from closed lists only; it is never stored. */
export const formatTransitionLine = (input: { decision: TransitionDecision; reason: TransitionReason; originDelta: number; stats: PacingStats }): string => {
  const whole = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  return `theme-transition decision=${input.decision} reason=${input.reason} origin-delta=${whole(input.originDelta)} frames=${whole(input.stats.frames)} long=${whole(input.stats.long)} maxMs=${whole(input.stats.maxMs)}`;
};

/* ------------------------------ controller ------------------------------ */

export type ViewTransitionLike = {
  ready: Promise<unknown>;
  finished: Promise<unknown>;
  updateCallbackDone: Promise<unknown>;
  skipTransition: () => void;
};

export type WaveHandle = { animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => void; remove: () => void };

export type ThemeTransitionDependencies = {
  /** Undefined when the browser has no View Transitions API. */
  startViewTransition: ((update: () => void) => ViewTransitionLike) | undefined;
  isHidden: () => boolean;
  prefersReducedMotion: () => boolean;
  /** True while the WINDOW is being resized (a real resize event in the last 150 ms), or a resize has not been handled yet. */
  isWindowResizing: () => boolean;
  /** Tells the layout tracker that the next moments belong to a theme change, so resize events caused by it are not real resizes. */
  ignoreLayoutChanges: (milliseconds: number) => void;
  /** True when an orb is on screen. It reads no layout. */
  hasOrb: () => boolean;
  /** Sets the theme everywhere that is not a canvas: the store (and so the React views, committed now) and the CSS custom properties. */
  apply: (theme: ThemeName) => void;
  /** Redraws the orb and the hex grid right now with the new theme. */
  redraw: () => void;
  /** The displayed rect of the orb canvas. It reads layout, so the controller calls it only inside the update callback and once at the end. */
  measureCanvas: () => Rect | undefined;
  getViewport: () => { width: number; height: number };
  /** Publishes the clip-path as one CSS custom property (set on every run, cleared on finish, cancel and skip). */
  setWaveVariables: (geometry: WaveGeometry | undefined) => void;
  /** Creates the aria-hidden ring element inside the new state. It removes any ring left over from an earlier run first. */
  createWave: (geometry: WaveGeometry) => WaveHandle | undefined;
  /** Animates the new snapshot of the root with the given keyframes. */
  animateRoot: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;
  startPulse: () => void;
  /** Switches the orb to its low-cost drawing (about 30 fps, minimum particles, no shadow blur) and back. */
  setLowCost: (enabled: boolean) => void;
  /** Starts counting frame deltas; the returned function stops and gives the numbers. */
  startPacing: () => () => PacingStats;
  log: (line: string) => void;
  setTimer: (callback: () => void, milliseconds: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Overrides the mode constant (used by tests). */
  mode?: ThemeTransitionMode;
};

export type ThemeTransitionController = {
  /** Applies the theme without any animation (the initial theme). */
  initialize: (theme: ThemeName) => void;
  /** Animates when it can, applies instantly when it cannot. */
  change: (theme: ThemeName) => void;
  isRunning: () => boolean;
};

const ignore = (): void => undefined;
const EMPTY_STATS: PacingStats = { frames: 0, long: 0, maxMs: 0 };

/** Everything one run owns. Nothing of a run lives outside this object, so a finished or skipped run cannot leave anything behind. */
type Run = {
  transition: ViewTransitionLike | undefined;
  mode: "wave" | "fade";
  geometry: WaveGeometry | undefined;
  wave: WaveHandle | undefined;
  stopPacing: (() => PacingStats) | undefined;
  watchdog: unknown;
  done: boolean;
  reason: TransitionReason;
};

export const createThemeTransitionController = (dependencies: ThemeTransitionDependencies): ThemeTransitionController => {
  let latest: ThemeName | undefined;
  let active: Run | undefined;
  const mode: ThemeTransitionMode = dependencies.mode ?? THEME_TRANSITION_MODE;

  const applyNow = (theme: ThemeName): void => {
    dependencies.apply(theme);
    dependencies.redraw();
  };

  const instant = (theme: ThemeName, reason: TransitionReason): void => {
    try { applyNow(theme); } finally {
      dependencies.log(formatTransitionLine({ decision: "instant", reason, originDelta: 0, stats: EMPTY_STATS }));
    }
  };

  /**
   * Ends a run and undoes everything it changed. It is safe to call twice and from any state: finished, skipped,
   * rejected, thrown or stuck. Each step is guarded so one failure cannot stop the others.
   */
  const finish = (run: Run): void => {
    if (run.done) return;
    run.done = true;
    if (active === run) active = undefined;
    const attempt = (step: () => void): void => { try { step(); } catch { /* the remaining steps still run */ } };
    attempt(() => { if (run.watchdog !== undefined) dependencies.clearTimer(run.watchdog); });
    attempt(() => run.wave?.remove());
    run.wave = undefined;
    attempt(() => dependencies.setWaveVariables(undefined));
    attempt(() => dependencies.setLowCost(false));
    let stats = EMPTY_STATS;
    attempt(() => { stats = run.stopPacing?.() ?? EMPTY_STATS; });
    run.stopPacing = undefined;
    // The orb is drawn once more at full quality, with the latest theme.
    attempt(() => dependencies.redraw());
    let delta = 0;
    attempt(() => { delta = run.geometry ? originDelta(run.geometry, dependencies.measureCanvas()) : 0; });
    attempt(() => dependencies.log(formatTransitionLine({ decision: run.mode, reason: run.reason, originDelta: delta, stats })));
  };

  return {
    initialize: (theme) => { latest = theme; applyNow(theme); },
    isRunning: () => active !== undefined,
    change: (theme) => {
      if (theme === latest) return;
      // The latest request always wins, even if an older update callback runs late.
      latest = theme;
      const previous = active;
      if (previous) {
        // A new change while one is running: skip the old one and end it completely before starting again.
        try { previous.transition?.skipTransition(); } catch { /* already finished */ }
        finish(previous);
      }
      const start = dependencies.startViewTransition;
      const reason: TransitionReason | undefined =
        mode === "instant" ? "mode"
          : !start ? "unsupported"
            : dependencies.prefersReducedMotion() ? "reduced-motion"
              : dependencies.isHidden() ? "hidden"
                : !dependencies.hasOrb() ? "no-rect"
                  : dependencies.isWindowResizing() ? "resize"
                    : undefined;
      // Resize events that the theme change itself causes (the title bar overlay, a repaint) are not real resizes.
      dependencies.ignoreLayoutChanges(THEME_TRANSITION_TOTAL_MS + 500);
      if (reason !== undefined || !start) {
        instant(theme, reason ?? "unsupported");
        return;
      }
      const run: Run = { transition: undefined, mode: mode === "fade" ? "fade" : "wave", geometry: undefined, wave: undefined, stopPacing: undefined, watchdog: undefined, done: false, reason: mode === "fade" ? "mode" : "ok" };
      active = run;
      try {
        run.transition = start(() => {
          // A callback that runs after its run ended (it was skipped before it ran) only applies the latest theme.
          if (run.done || active !== run) {
            dependencies.apply(latest ?? theme);
            dependencies.redraw();
            return;
          }
          try {
            // The new snapshot is taken after this returns. The order matters: commit the theme and the React views first,
            // then read the layout ONCE (this forces it), then set the variable and draw the orb at low cost.
            dependencies.apply(latest ?? theme);
            if (run.mode === "wave") {
              const measured = dependencies.measureCanvas();
              run.geometry = measured && measured.width > 0 && measured.height > 0 ? computeWaveGeometry(measured, dependencies.getViewport()) : undefined;
              dependencies.setWaveVariables(run.geometry);
              dependencies.setLowCost(true);
            }
            dependencies.redraw();
            if (run.mode === "wave" && run.geometry) {
              run.wave?.remove();
              run.wave = dependencies.createWave(run.geometry);
              dependencies.startPulse();
            }
          } catch {
            // Whatever went wrong, the run is over and the latest theme is applied, never half-way.
            run.reason = "error";
            finish(run);
            try { applyNow(latest ?? theme); } catch { /* nothing more can be done */ }
          }
        });
      } catch {
        run.reason = "error";
        finish(run);
        try { applyNow(theme); } catch { /* nothing more can be done */ }
        return;
      }
      const transition = run.transition;
      // Watchdog: a run that has not ended after 2 s is ended by force.
      run.watchdog = dependencies.setTimer(() => {
        if (run.done) return;
        run.reason = "error";
        try { transition.skipTransition(); } catch { /* already finished */ }
        finish(run);
        try { applyNow(latest ?? theme); } catch { /* nothing more can be done */ }
      }, THEME_TRANSITION_WATCHDOG_MS);
      const options: KeyframeAnimationOptions = { duration: run.mode === "fade" ? THEME_FADE_MS : THEME_TRANSITION_TOTAL_MS, fill: "forwards" };
      transition.ready.then(() => {
        if (run.done || active !== run) return;
        // Counting frames is the only thing that runs per frame: it reads a timestamp and nothing from the layout.
        run.stopPacing = dependencies.startPacing();
        if (run.mode === "wave" && run.geometry) {
          dependencies.animateRoot(waveKeyframes(run.geometry), options);
          run.wave?.animate(ringKeyframes(run.geometry), options);
        } else {
          dependencies.animateRoot(fadeKeyframes(), options);
        }
      }).catch(ignore);
      transition.updateCallbackDone.catch(ignore);
      // Whether it finished, was skipped or was rejected, the run ends here.
      transition.finished.catch(ignore).finally(() => finish(run));
    }
  };
};
