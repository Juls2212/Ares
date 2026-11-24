import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ORB_LAYOUT_SETTLE_MS,
  ORB_SIZE_TOLERANCE_PX,
  ignoreOrbLayoutChanges,
  isOrbLayoutSettling,
  markOrbLayoutChange,
  registerOrbLayoutProbe,
  resetOrbLayoutTracking
} from "../src/renderer/orb/orb-layout";
import { createOrbMotion, createParticles, drawOrbFrame } from "../src/renderer/orb/orb-renderer";
import { createOrbSignal } from "../src/renderer/orb/orb-runtime";
import { THEMES, type ThemeName } from "../src/renderer/theme/themes";
import {
  THEME_FADE_MS,
  THEME_PULSE_MS,
  THEME_TRANSITION,
  THEME_TRANSITION_EASE,
  THEME_TRANSITION_MODE,
  THEME_TRANSITION_TOTAL_MS,
  THEME_TRANSITION_WATCHDOG_MS,
  computeWaveGeometry,
  createFramePacer,
  createThemeTransitionController,
  fadeKeyframes,
  formatTransitionLine,
  originDelta,
  pulseAt,
  ringKeyframes,
  waveClip,
  waveKeyframes,
  type PacingStats,
  type Rect,
  type ThemeTransitionDependencies,
  type ThemeTransitionMode,
  type ViewTransitionLike
} from "../src/renderer/theme/theme-transition";
import { paintThemeNow, registerThemePainter, themeStore } from "../src/renderer/theme/theme-store";

beforeEach(() => { resetOrbLayoutTracking(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetOrbLayoutTracking(); });

describe("wave geometry comes from the canvas", () => {
  const viewport = { width: 480, height: 740 };

  it("starts at the center of the canvas, with R0 the sphere radius scaled by the canvas size and Rmax reaching the farthest corner", () => {
    const geometry = computeWaveGeometry({ left: 20, top: 70, width: 440, height: 440 }, viewport);
    expect([geometry.x, geometry.y, geometry.r0]).toEqual([240, 290, 58]);
    expect(geometry.rMax).toBeCloseTo(Math.hypot(240, 450), 6);
  });

  it("uses the canvas rect, not the stage: a smaller canvas, a top-aligned canvas, a resized window and a high DPR all move the origin with the canvas", () => {
    const centered = computeWaveGeometry({ left: 90, top: 220, width: 300, height: 300 }, viewport);
    expect([centered.x, centered.y, centered.r0]).toEqual([240, 370, (58 * 300) / 440]);
    expect(computeWaveGeometry({ left: 90, top: 70, width: 300, height: 300 }, viewport).y).toBe(220);
    const small = computeWaveGeometry({ left: 10, top: 60, width: 200, height: 200 }, { width: 420, height: 620 });
    expect([small.x, small.y, small.r0]).toEqual([110, 160, (58 * 200) / 440]);
    expect(computeWaveGeometry({ left: 20, top: 70, width: 440, height: 440 }, viewport).r0).toBe(58);
    const wide = computeWaveGeometry({ left: 0, top: 0, width: 880, height: 440 }, { width: 1000, height: 1000 });
    expect([wide.x, wide.y, wide.r0]).toEqual([440, 220, 58]);
  });

  it("always covers every corner, wherever the canvas is", () => {
    for (const [left, top] of [[0, 0], [300, 10], [10, 600], [200, 300]] as const) {
      const { x, y, rMax } = computeWaveGeometry({ left, top, width: 100, height: 100 }, viewport);
      for (const [cx, cy] of [[0, 0], [viewport.width, 0], [0, viewport.height], [viewport.width, viewport.height]]) expect(Math.hypot(cx! - x, cy! - y)).toBeLessThanOrEqual(rMax + 1e-9);
    }
  });

  it("measures how far the origin used is from the canvas center measured afterwards", () => {
    expect(originDelta({ x: 240, y: 290 }, { left: 20, top: 70, width: 440, height: 440 })).toBe(0);
    expect(originDelta({ x: 240, y: 290 }, { left: 23, top: 74, width: 440, height: 440 })).toBe(5);
    expect(originDelta({ x: 1, y: 1 }, undefined)).toBe(0);
  });
});

describe("timing and keyframes", () => {
  it("uses the documented constants: 160 ms hold, 700 ms expansion, 950 ms in total, ease-in-out, a 250 ms fade, a 2 s watchdog", () => {
    expect(THEME_TRANSITION).toEqual({ holdMs: 160, expandMs: 700, settleMs: 90 });
    expect(THEME_TRANSITION_TOTAL_MS).toBe(950);
    expect(THEME_TRANSITION_EASE).toBe("cubic-bezier(0.65, 0, 0.35, 1)");
    expect(THEME_FADE_MS).toBe(250);
    expect(THEME_TRANSITION_WATCHDOG_MS).toBe(2000);
    expect(THEME_TRANSITION_MODE).toBe("wave");
  });

  it("holds the circle at R0, expands it to Rmax with the ease, and keeps the same origin as the CSS variable", () => {
    const geometry = { x: 240, y: 290, r0: 58, rMax: 510 };
    const keyframes = waveKeyframes(geometry);
    expect(keyframes.map((keyframe) => keyframe.clipPath)).toEqual([
      "circle(58px at 240px 290px)", "circle(58px at 240px 290px)", "circle(510px at 240px 290px)", "circle(510px at 240px 290px)"
    ]);
    expect(waveClip(geometry.r0, geometry)).toBe(keyframes[0]!.clipPath);
    expect(keyframes.map((keyframe) => keyframe.offset)).toEqual([0, 160 / 950, 860 / 950, 1]);
    expect(keyframes[1]!.easing).toBe(THEME_TRANSITION_EASE);
    const ring = ringKeyframes(geometry);
    expect(ring.map((keyframe) => keyframe.offset)).toEqual(keyframes.map((keyframe) => keyframe.offset));
    expect(ring[0]!.transform).toBe(`scale(${58 / 510})`);
    expect(ring.at(-1)!.opacity).toBe(0);
    for (const keyframe of ring) expect(Object.keys(keyframe).filter((key) => !["offset", "easing"].includes(key)).sort()).toEqual(["opacity", "transform"]);
    expect(fadeKeyframes()).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("makes a half-sine pulse that is zero outside its window", () => {
    expect(pulseAt(-1)).toBe(0);
    expect(pulseAt(THEME_PULSE_MS / 2)).toBeCloseTo(1, 6);
    expect(pulseAt(THEME_PULSE_MS + 1)).toBe(0);
    for (const hostile of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(pulseAt(hostile)).toBe(0);
  });
});

describe("frame pacing and the decision line", () => {
  const feed = (deltas: number[]): PacingStats => {
    const pacer = createFramePacer();
    let now = 1000;
    pacer.record(now);
    for (const delta of deltas) { now += delta; pacer.record(now); }
    return pacer.stats();
  };

  it("counts frames, frames above 24 ms and the largest delta", () => {
    expect(feed([16.7, 16.7, 30, 16.7, 45, 80])).toEqual({ frames: 6, long: 3, maxMs: 80 });
    expect(feed([])).toEqual({ frames: 0, long: 0, maxMs: 0 });
    const pacer = createFramePacer();
    for (const hostile of [Number.NaN, Number.POSITIVE_INFINITY]) pacer.record(hostile);
    pacer.record(10);
    pacer.record(5);
    expect(pacer.stats().frames).toBe(0);
  });

  it("writes one fixed-format line: a decision and a reason from closed lists, then whole numbers", () => {
    const line = formatTransitionLine({ decision: "wave", reason: "ok", originDelta: 2.6, stats: { frames: 54, long: 2, maxMs: 47.8 } });
    expect(line).toBe("theme-transition decision=wave reason=ok origin-delta=3 frames=54 long=2 maxMs=48");
    const pattern = /^theme-transition decision=(?:wave|fade|instant) reason=(?:ok|reduced-motion|hidden|no-rect|resize|unsupported|error|mode) origin-delta=\d+ frames=\d+ long=\d+ maxMs=\d+$/u;
    expect(line).toMatch(pattern);
    expect(formatTransitionLine({ decision: "instant", reason: "resize", originDelta: Number.NaN, stats: { frames: -3, long: Number.POSITIVE_INFINITY, maxMs: 0 } }))
      .toBe("theme-transition decision=instant reason=resize origin-delta=0 frames=0 long=0 maxMs=0");
  });
});

describe("window resize tracking", () => {
  it("is settling for 150 ms after a real window resize, and the canvas observers no longer count", () => {
    expect(ORB_LAYOUT_SETTLE_MS).toBe(150);
    expect(isOrbLayoutSettling(10_000)).toBe(false);
    markOrbLayoutChange(10_000);
    expect(isOrbLayoutSettling(10_100)).toBe(true);
    expect(isOrbLayoutSettling(10_151)).toBe(false);
    const canvas = readFileSync("src/renderer/orb/orb-canvas.tsx", "utf8");
    // Only the window resize event marks a resize; the ResizeObserver callback of the orb does not.
    expect(canvas.match(/markOrbLayoutChange\(/gu)).toHaveLength(1); // the window listener only
    expect(canvas).toContain('const onWindowResize = (): void => markOrbLayoutChange();');
    const resizeFunction = canvas.slice(canvas.indexOf("const resize = (): void => {"), canvas.indexOf("const paint = (dt: number)"));
    expect(resizeFunction).not.toContain("markOrbLayoutChange");
  });

  it("ignores the resize events that a theme change itself causes, but not an earlier real resize", () => {
    markOrbLayoutChange(1_000);
    ignoreOrbLayoutChanges(1_450, 1_100);
    expect(isOrbLayoutSettling(1_120)).toBe(true); // the real resize at 1000 still counts
    markOrbLayoutChange(1_300); // caused by the theme change: dropped
    expect(isOrbLayoutSettling(1_400)).toBe(false);
    markOrbLayoutChange(2_600); // after the ignore window it counts again
    expect(isOrbLayoutSettling(2_650)).toBe(true);
  });

  it("treats a canvas that is a pixel off from the drawn size as settled, and a real mismatch as a pending resize", () => {
    expect(ORB_SIZE_TOLERANCE_PX).toBe(2);
    let pending = false;
    registerOrbLayoutProbe(() => pending);
    expect(isOrbLayoutSettling(50_000)).toBe(false);
    pending = true;
    expect(isOrbLayoutSettling(50_000)).toBe(true);
    registerOrbLayoutProbe(() => { throw new Error("detached"); });
    expect(isOrbLayoutSettling(50_000)).toBe(false);
    const canvas = readFileSync("src/renderer/orb/orb-canvas.tsx", "utf8");
    expect(canvas).toContain("size > 0 && Math.abs(Math.floor(Math.min(rect.width, rect.height)) - size) >= ORB_SIZE_TOLERANCE_PX");
  });
});

type Fake = ViewTransitionLike & {
  resolveReady: () => void; finish: () => void; rejectFinished: () => void; skipped: boolean;
};

type HarnessOptions = {
  supported?: boolean; hidden?: boolean; reduced?: boolean; throwsOnStart?: boolean; hasOrb?: boolean; resizing?: boolean; mode?: ThemeTransitionMode;
  canvas?: Rect; stats?: PacingStats; applyThrowsInCallback?: boolean; callbackAsync?: boolean;
};

const CANVAS: Rect = { left: 20, top: 70, width: 440, height: 440 };

const createHarness = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  const logs: string[] = [];
  const transitions: Fake[] = [];
  const waves: Array<{ removed: boolean; animated: boolean }> = [];
  const variables: Array<{ x: number; y: number; r0: number; rMax: number } | undefined> = [];
  const lowCost: boolean[] = [];
  const ignored: number[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const measured = { rect: options.canvas ?? CANVAS };
  const apply = vi.fn((theme: ThemeName) => { calls.push(`apply:${theme}`); if (options.applyThrowsInCallback && transitions.length > 0) throw new Error("broken"); });
  const redraw = vi.fn(() => { calls.push("redraw"); });
  const startPulse = vi.fn(() => { calls.push("pulse"); });
  const animateRoot = vi.fn();
  const stopPacing = vi.fn(() => options.stats ?? { frames: 54, long: 2, maxMs: 31 });
  const dependencies: ThemeTransitionDependencies = {
    startViewTransition: options.supported === false ? undefined : (callback) => {
      if (options.throwsOnStart) throw new Error("not allowed");
      let resolveReady = (): void => undefined;
      let finish = (): void => undefined;
      let rejectFinished = (): void => undefined;
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; void reject; });
      const finished = new Promise<void>((resolve, reject) => { finish = resolve; rejectFinished = () => reject(new Error("rejected")); });
      const updateCallbackDone = new Promise<void>((resolve) => {
        queueMicrotask(() => { callback(); calls.push("callback-returned"); resolve(); });
      });
      const fake: Fake = {
        ready, finished, updateCallbackDone, skipped: false, resolveReady, finish, rejectFinished,
        skipTransition: () => { fake.skipped = true; finish(); }
      };
      transitions.push(fake);
      calls.push("start");
      return fake;
    },
    isHidden: () => options.hidden ?? false,
    prefersReducedMotion: () => options.reduced ?? false,
    isWindowResizing: () => options.resizing ?? false,
    ignoreLayoutChanges: (milliseconds) => { ignored.push(milliseconds); },
    hasOrb: () => options.hasOrb ?? true,
    apply,
    redraw,
    measureCanvas: () => { calls.push("measure"); return measured.rect; },
    getViewport: () => ({ width: 480, height: 740 }),
    setWaveVariables: (geometry) => { calls.push(geometry ? "vars:set" : "vars:clear"); variables.push(geometry); },
    createWave: () => { const wave = { removed: false, animated: false }; waves.push(wave); calls.push("wave"); return { animate: () => { wave.animated = true; }, remove: () => { wave.removed = true; } }; },
    animateRoot,
    startPulse,
    setLowCost: (enabled) => { calls.push(`lowcost:${enabled}`); lowCost.push(enabled); },
    startPacing: () => { calls.push("pacing"); return stopPacing; },
    log: (line) => { logs.push(line); },
    setTimer: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimer: (handle) => { timers.delete(handle as number); },
    ...(options.mode ? { mode: options.mode } : {})
  };
  const controller = createThemeTransitionController(dependencies);
  const flush = async (): Promise<void> => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
  const fireWatchdogs = (): void => { for (const callback of [...timers.values()]) callback(); };
  return { controller, calls, logs, transitions, waves, variables, lowCost, ignored, timers, measured, apply, redraw, startPulse, animateRoot, stopPacing, flush, fireWatchdogs };
};

const finishRun = async (harness: ReturnType<typeof createHarness>, index: number): Promise<void> => {
  harness.transitions[index]!.resolveReady();
  harness.transitions[index]!.finish();
  await harness.flush();
};

describe("theme transition controller", () => {
  it("does not animate the initial theme and logs nothing", () => {
    const { controller, apply, redraw, transitions, waves, logs } = createHarness();
    controller.initialize("dark");
    expect(apply).toHaveBeenCalledExactlyOnceWith("dark");
    expect(redraw).toHaveBeenCalledOnce();
    expect(transitions).toHaveLength(0);
    expect(waves).toHaveLength(0);
    expect(logs).toEqual([]);
  });

  it("measures the canvas INSIDE the update callback, after the React commit, and not when the change is requested", async () => {
    const { controller, calls, flush } = createHarness();
    controller.initialize("dark");
    calls.length = 0;
    controller.change("light");
    expect(calls).toEqual(["start"]);
    await flush();
    expect(calls).toEqual(["start", "apply:light", "measure", "vars:set", "lowcost:true", "redraw", "wave", "pulse", "callback-returned"]);
    expect(calls.filter((call) => call === "measure")).toHaveLength(1);
  });

  it("uses the canvas as it is at that moment: a layout that changed after the request moves the origin", async () => {
    const { controller, measured, variables, flush } = createHarness();
    controller.initialize("dark");
    controller.change("light");
    measured.rect = { left: 90, top: 70, width: 300, height: 300 };
    await flush();
    expect(variables[0]).toMatchObject({ x: 240, y: 220, r0: (58 * 300) / 440 });
  });

  it("clips from the sphere once ready, and animates the ring in the same timing and space", async () => {
    const harness = createHarness();
    harness.controller.initialize("dark");
    harness.controller.change("light");
    await harness.flush();
    expect(harness.animateRoot).not.toHaveBeenCalled();
    harness.transitions[0]!.resolveReady();
    await harness.flush();
    expect(harness.calls).toContain("pacing");
    expect(harness.animateRoot).toHaveBeenCalledOnce();
    expect(harness.animateRoot.mock.calls[0]![1]).toMatchObject({ duration: 950, fill: "forwards" });
    expect(harness.animateRoot.mock.calls[0]![0]).toEqual(waveKeyframes(harness.variables[0]!));
    expect(harness.waves[0]!.animated).toBe(true);
  });

  it("logs ONE decision line per change, and tells the resize guard to ignore the change's own resize events", async () => {
    const harness = createHarness();
    harness.controller.initialize("dark");
    harness.controller.change("light");
    await harness.flush();
    expect(harness.ignored).toEqual([THEME_TRANSITION_TOTAL_MS + 500]);
    await finishRun(harness, 0);
    expect(harness.logs).toEqual(["theme-transition decision=wave reason=ok origin-delta=0 frames=54 long=2 maxMs=31"]);
  });
});

describe("30 consecutive toggles always choose the wave", () => {
  it("plays a wave every time, whether the runs are slow, janky or fast, and leaves nothing behind", async () => {
    const harness = createHarness({ stats: { frames: 60, long: 40, maxMs: 400 } }); // a very janky run, every time
    harness.controller.initialize("dark");
    let theme: ThemeName = "dark";
    for (let index = 0; index < 30; index += 1) {
      theme = theme === "dark" ? "light" : "dark";
      harness.controller.change(theme);
      await harness.flush();
      expect(harness.transitions).toHaveLength(index + 1);
      await finishRun(harness, index);
      expect(harness.controller.isRunning()).toBe(false);
    }
    expect(harness.logs).toHaveLength(30);
    for (const line of harness.logs) expect(line).toMatch(/^theme-transition decision=wave reason=ok /u);
    expect(harness.waves).toHaveLength(30);
    expect(harness.waves.every((wave) => wave.removed)).toBe(true);
    expect(harness.variables.at(-1)).toBeUndefined();
    expect(harness.lowCost.at(-1)).toBe(false);
    expect(harness.timers.size).toBe(0);
  });

  it("also plays 30 rapid toggles pressed before any of them finishes, ending on the right theme with one clean state", async () => {
    const harness = createHarness();
    harness.controller.initialize("dark");
    let theme: ThemeName = "dark";
    for (let index = 0; index < 30; index += 1) {
      theme = theme === "dark" ? "light" : "dark";
      harness.controller.change(theme);
    }
    await harness.flush();
    expect(harness.calls.filter((call) => call.startsWith("apply:")).at(-1)).toBe(`apply:${theme}`);
    await finishRun(harness, harness.transitions.length - 1);
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.waves.every((wave) => wave.removed)).toBe(true);
    expect(harness.variables.at(-1)).toBeUndefined();
    expect(harness.lowCost.at(-1)).toBe(false);
    expect(harness.timers.size).toBe(0);
    for (const line of harness.logs) expect(line).toMatch(/decision=wave reason=ok/u);
  });

  it("has no sticky fallback: there is no remaining automatic switch to the fade mode", () => {
    const source = readFileSync("src/renderer/theme/theme-transition.ts", "utf8");
    expect(source).not.toMatch(/fallback=fade|FALLBACK_FRAME_COUNT|FALLBACK_LINE|veryLong|currentMode/u);
    expect(source).toContain("const mode: ThemeTransitionMode = dependencies.mode ?? THEME_TRANSITION_MODE;");
    expect(source.match(/mode = /gu)).toBeNull();
  });
});

describe("when the theme is applied instantly, and why", () => {
  it.each([
    ["unsupported", { supported: false }], ["reduced-motion", { reduced: true }], ["hidden", { hidden: true }],
    ["no-rect", { hasOrb: false }], ["resize", { resizing: true }], ["mode", { mode: "instant" as const }]
  ] as Array<[string, HarnessOptions]>)("applies instantly with reason «%s»: no ring, no variable, no low-cost mode, one line", (reason, options) => {
    const { controller, calls, waves, transitions, startPulse, logs, lowCost } = createHarness(options);
    controller.initialize("dark");
    calls.length = 0;
    controller.change("light");
    expect(calls).toEqual(["apply:light", "redraw"]);
    expect(waves).toHaveLength(0);
    expect(transitions).toHaveLength(0);
    expect(lowCost).toEqual([]);
    expect(startPulse).not.toHaveBeenCalled();
    expect(logs).toEqual([`theme-transition decision=instant reason=${reason} origin-delta=0 frames=0 long=0 maxMs=0`]);
  });

  it("a real resize is only a one-time reason: after the window settled, the guard is off again", () => {
    markOrbLayoutChange(5_000);
    expect(isOrbLayoutSettling(5_100)).toBe(true);
    expect(isOrbLayoutSettling(5_200)).toBe(false);
  });

  it("a canvas size change caused by the theme change does not count as a window resize", () => {
    // The canvas observer no longer marks; resize events during the change are ignored; a one-pixel drift is tolerated.
    ignoreOrbLayoutChanges(1_450, 9_000);
    markOrbLayoutChange(9_050);
    markOrbLayoutChange(9_400);
    expect(isOrbLayoutSettling(9_450)).toBe(false);
    registerOrbLayoutProbe(() => Math.abs(439 - 440) >= ORB_SIZE_TOLERANCE_PX);
    expect(isOrbLayoutSettling(9_450)).toBe(false);
  });

  it("falls back to an instant change with reason «error» when starting the transition throws, and leaves no state", () => {
    const { controller, calls, variables, lowCost, logs } = createHarness({ throwsOnStart: true });
    controller.initialize("dark");
    calls.length = 0;
    expect(() => controller.change("light")).not.toThrow();
    expect(calls).toContain("apply:light");
    expect(variables.at(-1)).toBeUndefined();
    expect(lowCost.at(-1)).toBe(false);
    expect(controller.isRunning()).toBe(false);
    expect(logs.at(-1)).toMatch(/decision=wave reason=error /u);
  });

  it("ignores a change to the theme it already has", () => {
    const { controller, transitions, logs } = createHarness();
    controller.initialize("dark");
    controller.change("dark");
    expect(transitions).toHaveLength(0);
    expect(logs).toEqual([]);
  });
});

describe("the state is always reset", () => {
  it("after finish: ring removed, variable cleared, orb cost restored, watchdog cleared, nothing running", async () => {
    const harness = createHarness();
    harness.controller.initialize("dark");
    harness.controller.change("light");
    await harness.flush();
    expect(harness.timers.size).toBe(1);
    await finishRun(harness, 0);
    expect(harness.waves[0]!.removed).toBe(true);
    expect(harness.variables.at(-1)).toBeUndefined();
    expect(harness.lowCost).toEqual([true, false]);
    expect(harness.timers.size).toBe(0);
    expect(harness.controller.isRunning()).toBe(false);
  });

  it("after a skip by a newer change: the old run is ended completely before the new one starts, and a late callback leaves nothing behind", async () => {
    const harness = createHarness();
    harness.controller.initialize("dark");
    harness.controller.change("light");
    // The second press arrives before the first update callback has run (a microtask later).
    harness.controller.change("dark");
    expect(harness.transitions[0]!.skipped).toBe(true);
    await harness.flush();
    // The first run's late callback only applied the latest theme: one ring (the second run's), one variable.
    expect(harness.waves).toHaveLength(1);
    expect(harness.calls.filter((call) => call === "vars:set")).toHaveLength(1);
    expect(harness.calls.filter((call) => call === "lowcost:true")).toHaveLength(1);
    expect(harness.calls.filter((call) => call.startsWith("apply:")).at(-1)).toBe("apply:dark");
    await finishRun(harness, 1);
    expect(harness.waves.every((wave) => wave.removed)).toBe(true);
    expect(harness.variables.at(-1)).toBeUndefined();
    expect(harness.lowCost.at(-1)).toBe(false);
    expect(harness.controller.isRunning()).toBe(false);
  });

  it("after the finished promise is rejected", async () => {
    const harness = createHarness();
    harness.controller.initialize("dark");
    harness.controller.change("light");
    await harness.flush();
    harness.transitions[0]!.rejectFinished();
    await harness.flush();
    expect(harness.waves[0]!.removed).toBe(true);
    expect(harness.variables.at(-1)).toBeUndefined();
    expect(harness.lowCost.at(-1)).toBe(false);
    expect(harness.controller.isRunning()).toBe(false);
    harness.controller.change("dark"); // and the next change works
    await harness.flush();
    expect(harness.transitions).toHaveLength(2);
  });

  it("after an exception in the update callback: no half state, the latest theme applied, an «error» reason", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => { rejections.push(reason); };
    process.on("unhandledRejection", onRejection);
    try {
      const harness = createHarness({ applyThrowsInCallback: true });
      harness.controller.initialize("dark");
      harness.controller.change("light");
      await harness.flush();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(harness.lowCost.at(-1) ?? false).toBe(false);
      expect(harness.variables.at(-1)).toBeUndefined();
      expect(harness.controller.isRunning()).toBe(false);
      expect(harness.timers.size).toBe(0);
      expect(harness.logs.at(-1)).toMatch(/reason=error /u);
      expect(rejections).toEqual([]);
    } finally { process.off("unhandledRejection", onRejection); }
  });

  it("raises no unhandled rejection when a transition is skipped or rejected", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => { rejections.push(reason); };
    process.on("unhandledRejection", onRejection);
    try {
      const harness = createHarness();
      harness.controller.initialize("dark");
      harness.controller.change("light");
      await harness.flush();
      harness.controller.change("dark");
      await harness.flush();
      harness.transitions[1]!.rejectFinished();
      await harness.flush();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(rejections).toEqual([]);
    } finally { process.off("unhandledRejection", onRejection); }
  });

  it("does not animate a run that was replaced before it became ready", async () => {
    const { controller, transitions, animateRoot, flush } = createHarness();
    controller.initialize("dark");
    controller.change("light");
    controller.change("dark");
    await flush();
    transitions[0]!.resolveReady();
    await flush();
    expect(animateRoot).not.toHaveBeenCalled();
  });
});

describe("the watchdog", () => {
  it("forces cleanup of a transition that is still running after 2 s: ring, variable, orb cost, running state", async () => {
    const harness = createHarness();
    harness.controller.initialize("dark");
    harness.controller.change("light");
    await harness.flush();
    expect(harness.controller.isRunning()).toBe(true);
    expect(harness.timers.size).toBe(1);
    harness.fireWatchdogs(); // the transition never finishes
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.transitions[0]!.skipped).toBe(true);
    expect(harness.waves[0]!.removed).toBe(true);
    expect(harness.variables.at(-1)).toBeUndefined();
    expect(harness.lowCost.at(-1)).toBe(false);
    expect(harness.timers.size).toBe(0);
    expect(harness.logs.at(-1)).toMatch(/^theme-transition decision=wave reason=error /u);
    // The next change works normally.
    harness.controller.change("dark");
    await harness.flush();
    expect(harness.transitions).toHaveLength(2);
    expect(harness.controller.isRunning()).toBe(true);
  });

  it("is set for 2 s with a real timer (fake timers) and does nothing once the run has finished", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.controller.initialize("dark");
    harness.controller.change("light");
    await harness.flush();
    await finishRun(harness, 0);
    const logsBefore = harness.logs.length;
    harness.fireWatchdogs();
    expect(harness.logs).toHaveLength(logsBefore);
    const source = readFileSync("src/renderer/theme/theme-transition-dom.ts", "utf8");
    expect(source).toContain("setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds)");
    expect(readFileSync("src/renderer/theme/theme-transition.ts", "utf8")).toContain("}, THEME_TRANSITION_WATCHDOG_MS);");
  });
});

describe("the fade mode is manual only", () => {
  it("fade: opacity only, no clip variable, no ring, no low-cost mode and no pulse, logged with reason «mode»", async () => {
    const harness = createHarness({ mode: "fade", stats: { frames: 15, long: 0, maxMs: 17 } });
    harness.controller.initialize("dark");
    harness.controller.change("light");
    await harness.flush();
    harness.transitions[0]!.resolveReady();
    await harness.flush();
    expect(harness.animateRoot).toHaveBeenCalledExactlyOnceWith(fadeKeyframes(), { duration: 250, fill: "forwards" });
    expect(harness.waves).toHaveLength(0);
    expect(harness.variables).toEqual([]);
    expect(harness.startPulse).not.toHaveBeenCalled();
    harness.transitions[0]!.finish();
    await harness.flush();
    expect(harness.logs).toEqual(["theme-transition decision=fade reason=mode origin-delta=0 frames=15 long=0 maxMs=17"]);
  });
});

describe("theme store and painters", () => {
  it("notifies subscribers once per real change and repaints every painter, even if one throws", () => {
    const listener = vi.fn();
    const unsubscribe = themeStore.subscribe(listener);
    const start = themeStore.get();
    const other: ThemeName = start === "dark" ? "light" : "dark";
    themeStore.set(other);
    themeStore.set(other);
    expect(listener).toHaveBeenCalledOnce();
    themeStore.set("blue" as never);
    expect(themeStore.get()).toBe(other);
    themeStore.set(start);
    unsubscribe();
    const good = vi.fn();
    const off = [registerThemePainter(() => { throw new Error("broken canvas"); }), registerThemePainter(good)];
    expect(() => paintThemeNow()).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
    off.forEach((release) => release());
    paintThemeNow();
    expect(good).toHaveBeenCalledOnce();
  });
});

describe("orb pulse and the low-cost drawing", () => {
  const record = (themeName: ThemeName, extra: { pulse?: number; cheap?: boolean; reducedMotion?: boolean } = {}) => {
    const calls: unknown[][] = [];
    const sets: Array<[string, unknown]> = [];
    const target: Record<string, unknown> = {};
    const context = new Proxy(target, {
      get: (store, property: string) => property in store ? store[property] : (...args: unknown[]) => {
        calls.push([property, ...args]);
        return property === "createRadialGradient" ? { addColorStop: (...stop: unknown[]) => calls.push(["addColorStop", ...stop]) } : undefined;
      },
      set: (store, property: string, value) => { store[property] = value; sets.push([property, value]); return true; }
    }) as unknown as CanvasRenderingContext2D;
    drawOrbFrame(context, {
      size: 440, time: 1, dt: 1 / 60, state: "idle", level: 0.3, theme: THEMES[themeName].orb, particles: createParticles(),
      reducedMotion: extra.reducedMotion ?? false, motion: createOrbMotion(), ...(extra.pulse === undefined ? {} : { pulse: extra.pulse }), ...(extra.cheap ? { cheap: true } : {})
    });
    const numbers = calls.flatMap((call) => call.filter((value): value is number => typeof value === "number"));
    expect(numbers.every(Number.isFinite)).toBe(true);
    expect(JSON.stringify([calls, sets])).not.toMatch(/NaN|Infinity/u);
    return { text: JSON.stringify([calls, sets]), sets, calls };
  };

  it.each(["dark", "light"] as const)("changes the drawing only while the pulse is active, and stays finite, in the %s theme", (themeName) => {
    const rest = record(themeName, { pulse: 0 }).text;
    expect(record(themeName).text).toBe(rest);
    expect(record(themeName, { pulse: 1 }).text).not.toBe(rest);
    for (const hostile of [Number.NaN, Number.POSITIVE_INFINITY, -4, 9]) record(themeName, { pulse: hostile });
    expect(record(themeName, { pulse: Number.NaN }).text).toBe(rest);
  });

  it("ignores the pulse under reduced motion", () => {
    expect(record("dark", { pulse: 1, reducedMotion: true }).text).toBe(record("dark", { pulse: 0, reducedMotion: true }).text);
  });

  it.each(["dark", "light"] as const)("draws without shadow blur in the low-cost mode, still showing the pulse, in the %s theme", (themeName) => {
    const normal = record(themeName, { pulse: 1 });
    expect(normal.sets.some(([name, value]) => name === "shadowBlur" && (value as number) > 0)).toBe(true);
    const cheap = record(themeName, { pulse: 1, cheap: true });
    expect(cheap.sets.some(([name, value]) => name === "shadowBlur" && (value as number) > 0)).toBe(false);
    expect(cheap.sets.some(([name]) => name === "shadowColor")).toBe(false);
    expect(record(themeName, { pulse: 1, cheap: true }).text).not.toBe(record(themeName, { pulse: 0, cheap: true }).text);
    expect(cheap.calls.length).toBe(normal.calls.length);
  });

  it("does not allocate a point per wireframe segment (it reuses two scratch points)", () => {
    const source = readFileSync("src/renderer/orb/orb-renderer.ts", "utf8");
    expect(source).toContain("projectInto(bufferA,");
    expect(source).toContain("projectInto(bufferB,");
    expect(source).not.toMatch(/const p[01] = project\(/u);
    expect(source).toContain("mix(accent2, accent, v, segmentColor)");
  });

  it("keeps the pulse start and the low-cost flag in the shared signal, off by default", () => {
    const signal = createOrbSignal();
    expect(signal.pulseStart).toBeUndefined();
    expect(signal.lowCost).toBe(false);
  });

  it("runs the loop slowly with the minimum particles while the low-cost flag is on, and holds the static grid back (source check)", () => {
    const source = readFileSync("src/renderer/orb/orb-canvas.tsx", "utf8");
    expect(source).toContain("reducedMotion || signal.lowCost ||");
    expect(source).toContain("particleCount: cheap ? MINIMUM_PARTICLES : particleCount");
    expect(source).toContain("const cheap = signal.lowCost;");
    expect(source).toContain("if (orbSignal.lowCost) dirty = true; else paint();");
  });
});

describe("wiring (source checks)", () => {
  const main = readFileSync("src/renderer/main.tsx", "utf8");
  const css = readFileSync("src/renderer/styles/ares-hud.css", "utf8");
  const dom = readFileSync("src/renderer/theme/theme-transition-dom.ts", "utf8");

  it("applies the first theme without animation and animates every later matchMedia change", () => {
    expect(main).toContain("themeTransition.initialize(readSystemTheme());");
    expect(main).toContain('darkQuery.addEventListener("change", () => themeTransition.change(themeNameFromQuery(darkQuery.matches)));');
    expect(main.indexOf("initialize(")).toBeLessThan(main.indexOf("addEventListener"));
  });

  it("turns the default cross-fade off, clips the new snapshot from the one custom property, and keeps the ring inert", () => {
    expect(css).toMatch(/::view-transition-old\(root\),\s*::view-transition-new\(root\) \{\s*animation: none;\s*mix-blend-mode: normal;/u);
    expect(css).toContain("clip-path: var(--wave-clip, none);");
    expect(css).not.toMatch(/--wave-(?:x|y|r0|rmax)/u);
    const wrapper = css.slice(css.indexOf(".theme-wave {"), css.indexOf("}", css.indexOf(".theme-wave {")));
    expect(wrapper).toContain("pointer-events: none;");
    expect(wrapper).toContain("position: fixed;");
    expect(wrapper).toContain("contain: layout paint;");
    expect(wrapper).toContain("view-transition-name: theme-wave;");
    expect(dom).toContain('setAttribute("aria-hidden", "true")');
    expect(dom).toContain('pseudoElement: "::view-transition-new(root)"');
  });

  it("never leaves a ring behind: creating one first removes any stale one (two elements with the same name abort a transition)", () => {
    expect(dom).toContain('for (const stale of document.querySelectorAll(".theme-wave")) stale.remove();');
    expect(dom.indexOf("querySelectorAll(\".theme-wave\")")).toBeLessThan(dom.indexOf('document.createElement("div")'));
  });

  it("gives the ring no filter, blur or shadow: three strokes, animated by transform and opacity only", () => {
    const ring = css.slice(css.indexOf("/* ---------- Theme change"));
    expect(ring).not.toMatch(/filter\s*:|drop-shadow|blur\(|box-shadow\s*:|text-shadow\s*:/u);
    expect(dom.match(/theme-wave__(?:halo|mid|line)/gu)).toHaveLength(3);
    expect(dom).not.toMatch(/filter|blur|boxShadow|shadow/iu);
  });

  it("reads the layout only inside the callback and once at the end, never in a frame loop, and flushes React once before the animation", () => {
    const pacing = dom.slice(dom.indexOf("const startFramePacing"), dom.indexOf("/** The real browser wiring"));
    expect(pacing).not.toMatch(/getBoundingClientRect|querySelector|offsetWidth|offsetHeight|getComputedStyle|innerWidth/u);
    expect(dom.match(/flushSync\(/gu)).toHaveLength(1);
    const controller = readFileSync("src/renderer/theme/theme-transition.ts", "utf8");
    expect(controller.match(/dependencies\.measureCanvas\(\)/gu)).toHaveLength(2);
    expect(controller.indexOf("dependencies.apply(latest ?? theme)")).toBeLessThan(controller.lastIndexOf("dependencies.measureCanvas()"));
  });

  it("owns every piece of state inside one run object, so nothing can stay stuck between runs", () => {
    const controller = readFileSync("src/renderer/theme/theme-transition.ts", "utf8");
    const factory = controller.slice(controller.indexOf("export const createThemeTransitionController"));
    expect(factory).not.toMatch(/\blet (?:wave|geometry|stopPacing|skipped)\b/u);
    expect(controller).toContain("const finish = (run: Run): void => {");
    expect(controller).toContain("if (run.done) return;");
  });

  it("is renderer-only and adds no network, IPC or storage", () => {
    for (const file of ["theme-transition.ts", "theme-transition-dom.ts", "theme-store.ts"]) {
      expect(readFileSync(`src/renderer/theme/${file}`, "utf8"), file).not.toMatch(/window\.ares|ipcRenderer|fetch\(|localStorage|XMLHttpRequest/u);
    }
  });
});
