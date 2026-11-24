import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HexBackground, OrbCanvas, OrbFallback } from "../src/renderer/orb/orb-canvas";
import {
  ACTIVE_FRAME_INTERVAL_MS,
  IDLE_FRAME_INTERVAL_MS,
  MINIMUM_PARTICLES,
  REAL_LEVEL_MAXIMUM_AGE_MS,
  createFrameLoop,
  createOrbSignal,
  createParticleBudget,
  orbVisualStateFor,
  setOrbLevel,
  targetLevelFor,
  type OrbState
} from "../src/renderer/orb/orb-runtime";
import { levelFromTimeDomain, attachPlaybackLevel } from "../src/renderer/features/voice/playback-level";

afterEach(() => { vi.useRealTimers(); });

describe("state to look mapping", () => {
  it("maps every app state to one of the five looks, with processing, interpreting and acting all thinking", () => {
    const expected: Record<OrbState, string> = {
      idle: "idle", recording: "listening", transcribing: "thinking", interpreting: "thinking", acting: "thinking", speaking: "speaking", error: "error"
    };
    for (const [state, look] of Object.entries(expected)) expect(orbVisualStateFor(state as OrbState)).toBe(look);
  });
});

describe("orb signal", () => {
  it("uses a fresh real level while listening and speaking, and the simulated envelope otherwise", () => {
    const signal = createOrbSignal();
    signal.state = "listening";
    expect(targetLevelFor(signal, 1, 1_000)).toBeGreaterThan(0.1); // simulated: no analyser has reported
    setOrbLevel(signal, 0.9, 1_000);
    expect(targetLevelFor(signal, 1, 1_100)).toBe(0.9);
    expect(targetLevelFor(signal, 1, 1_000 + REAL_LEVEL_MAXIMUM_AGE_MS + 1)).not.toBe(0.9); // stale: simulated again
    signal.state = "idle";
    expect(targetLevelFor(signal, 1, 1_100)).toBeLessThan(0.2); // a real level is not used while idle
  });

  it("prefers the playback sampler while speaking and falls back when it has nothing", () => {
    const signal = createOrbSignal();
    signal.state = "speaking";
    signal.sampler = () => 0.7;
    expect(targetLevelFor(signal, 0, 0)).toBe(0.7);
    signal.sampler = () => undefined;
    expect(targetLevelFor(signal, 0, 0)).toBeGreaterThanOrEqual(0);
    signal.sampler = () => Number.NaN;
    expect(Number.isFinite(targetLevelFor(signal, 0, 0))).toBe(true);
    signal.sampler = () => 7;
    expect(targetLevelFor(signal, 0, 0)).toBe(1);
  });

  it("clamps and rejects hostile levels", () => {
    const signal = createOrbSignal();
    setOrbLevel(signal, 5, 0);
    expect(signal.level).toBe(1);
    setOrbLevel(signal, Number.NaN, 0);
    expect(signal.level).toBeUndefined();
  });
});

describe("frame scheduler", () => {
  const harness = (options: { hidden?: boolean; idle?: boolean } = {}) => {
    const state = { hidden: options.hidden ?? false, idle: options.idle ?? false };
    const callbacks = new Map<number, (now: number) => void>();
    let nextHandle = 1;
    const draw = vi.fn();
    const loop = createFrameLoop({
      requestFrame: (callback) => { const handle = nextHandle++; callbacks.set(handle, callback); return handle; },
      cancelFrame: (handle) => { callbacks.delete(handle); },
      isHidden: () => state.hidden,
      isIdle: () => state.idle,
      draw
    });
    /** Runs the pending frame at the given time. */
    const tick = (now: number): boolean => {
      const entry = [...callbacks.entries()][0];
      if (!entry) return false;
      callbacks.delete(entry[0]);
      entry[1](now);
      return true;
    };
    return { state, loop, draw, tick, pending: () => callbacks.size };
  };

  it("draws at full rate while active and about half that while idle", () => {
    const active = harness();
    active.loop.start();
    let drawnActive = 0;
    for (let time = 0; time <= 1000; time += ACTIVE_FRAME_INTERVAL_MS) { active.tick(time); drawnActive = active.draw.mock.calls.length; }
    const idle = harness({ idle: true });
    idle.loop.start();
    for (let time = 0; time <= 1000; time += ACTIVE_FRAME_INTERVAL_MS) idle.tick(time);
    expect(drawnActive).toBeGreaterThan(55);
    expect(idle.draw.mock.calls.length).toBeGreaterThan(25);
    expect(idle.draw.mock.calls.length).toBeLessThan(35);
    expect(IDLE_FRAME_INTERVAL_MS).toBeGreaterThan(ACTIVE_FRAME_INTERVAL_MS * 1.9);
  });

  it("schedules nothing while the page is hidden, and resumes when it becomes visible", () => {
    const { loop, state, draw, tick, pending } = harness({ hidden: true });
    loop.start();
    expect(pending()).toBe(0);
    expect(draw).not.toHaveBeenCalled();
    state.hidden = false;
    loop.start(); // what the visibilitychange listener does
    expect(pending()).toBe(1);
    tick(0);
    expect(draw).toHaveBeenCalledOnce();
  });

  it("stops by itself when the page is hidden mid-run and draws no further frame", () => {
    const { loop, state, draw, tick, pending } = harness();
    loop.start();
    tick(0);
    tick(17);
    expect(draw).toHaveBeenCalledTimes(2);
    state.hidden = true;
    tick(34);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(pending()).toBe(0);
    expect(loop.isRunning()).toBe(false);
    state.hidden = false;
    loop.start();
    tick(100);
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it("does not start twice and cancels cleanly", () => {
    const { loop, pending } = harness();
    loop.start();
    loop.start();
    expect(pending()).toBe(1);
    loop.stop();
    expect(pending()).toBe(0);
    expect(loop.isRunning()).toBe(false);
  });
});

describe("adaptive particle budget", () => {
  const feed = (budget: ReturnType<typeof createParticleBudget>, frameMs: number, seconds: number, from = 0): number => {
    let now = from;
    const end = from + seconds * 1000;
    while (now < end) { now += frameMs; budget.record(frameMs, now); }
    return now;
  };

  it("halves the count when the average frame time stays above 24 ms for a second, down to a floor", () => {
    const budget = createParticleBudget(520);
    expect(budget.count()).toBe(520);
    let now = feed(budget, 30, 1.2);
    expect(budget.count()).toBe(260);
    now = feed(budget, 30, 1.2, now);
    expect(budget.count()).toBe(130);
    feed(budget, 30, 5, now);
    expect(budget.count()).toBe(MINIMUM_PARTICLES);
  });

  it("restores the count when frames are comfortably fast, and keeps it when they are in between", () => {
    const budget = createParticleBudget(520);
    let now = feed(budget, 30, 2.5);
    expect(budget.count()).toBeLessThan(520);
    const reduced = budget.count();
    now = feed(budget, 21, 1.2, now);
    expect(budget.count()).toBe(reduced);
    feed(budget, 16.7, 3, now);
    expect(budget.count()).toBe(520);
  });

  it("ignores hostile frame times", () => {
    const budget = createParticleBudget(520);
    for (const value of [Number.NaN, -5, 0, Number.POSITIVE_INFINITY]) budget.record(value, 1000);
    expect(budget.count()).toBe(520);
  });
});

describe("fallbacks and markup", () => {
  it("renders the canvas hidden from assistive technology, with a hex layer that is also hidden", () => {
    const markup = renderToStaticMarkup(createElement(OrbCanvas));
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<canvas class="orb-canvas">');
    expect(renderToStaticMarkup(createElement(HexBackground))).toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/<button|role=|aria-label/u);
  });

  it("renders a plain CSS orb with a state ring for forced colors or a missing 2D context", () => {
    const signal = createOrbSignal();
    signal.state = "thinking";
    const markup = renderToStaticMarkup(createElement(OrbFallback, { signal }));
    expect(markup).toContain('class="orb-fallback"');
    expect(markup).toContain('data-state="thinking"');
    expect(markup).toContain("orb-fallback__ring");
    expect(markup).not.toContain("<canvas");
  });

  it("switches to the CSS orb when getContext returns null (source check of the guard)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/renderer/orb/orb-canvas.tsx", "utf8");
    expect(source).toContain('probe = canvas.getContext("2d")');
    expect(source).toContain("setNoContext(true)");
    expect(source).toContain('useMediaQuery("(forced-colors: active)")');
    expect(source).toContain("MAXIMUM_PIXEL_RATIO = 2");
    expect(source).toContain("document.hidden");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).not.toMatch(/getUserMedia|ipcRenderer|window\.ares/u);
  });
});

describe("playback level", () => {
  it("measures the level of a time-domain buffer: silence is 0 and a loud wave is capped at 1", () => {
    expect(levelFromTimeDomain(new Uint8Array(128).fill(128))).toBe(0);
    expect(levelFromTimeDomain([])).toBe(0);
    const loud = Array.from({ length: 128 }, (_, index) => (index % 2 === 0 ? 255 : 0));
    expect(levelFromTimeDomain(loud)).toBe(1);
    const speech = Array.from({ length: 128 }, (_, index) => 128 + Math.round(30 * Math.sin(index)));
    const level = levelFromTimeDomain(speech);
    expect(level).toBeGreaterThan(0.3);
    expect(level).toBeLessThan(0.9);
  });

  const fakeAudio = () => {
    const listeners = new Map<string, () => void>();
    return { element: { addEventListener: (name: string, listener: () => void) => { listeners.set(name, listener); } } as unknown as HTMLMediaElement, emit: (name: string) => listeners.get(name)?.() };
  };

  it("taps the audio only when the context is running, and exposes a sampler only while it plays", () => {
    const signal = createOrbSignal();
    const connect = vi.fn();
    const analyser = { fftSize: 0, connect, getByteTimeDomainData: (array: Uint8Array) => array.fill(200) };
    const context = {
      state: "running", resume: vi.fn(async () => undefined), destination: {},
      createAnalyser: () => analyser,
      createMediaElementSource: () => ({ connect })
    };
    const { element, emit } = fakeAudio();
    attachPlaybackLevel(element, signal, () => context);
    expect(signal.sampler).toBeUndefined();
    emit("playing");
    expect(signal.sampler!()).toBeGreaterThan(0.5);
    emit("ended");
    expect(signal.sampler).toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(2); // source to analyser, analyser to the speakers
  });

  it("leaves the audio untouched when the context is suspended, missing or throws, so the voice is never silenced", () => {
    const signal = createOrbSignal();
    const createMediaElementSource = vi.fn();
    const suspended = { state: "suspended", resume: vi.fn(async () => undefined), destination: {}, createAnalyser: vi.fn(), createMediaElementSource };
    attachPlaybackLevel(fakeAudio().element, signal, () => suspended);
    expect(createMediaElementSource).not.toHaveBeenCalled();
    expect(suspended.resume).toHaveBeenCalledOnce();
    expect(() => attachPlaybackLevel(fakeAudio().element, signal, () => undefined)).not.toThrow();
    expect(() => attachPlaybackLevel(fakeAudio().element, signal, () => { throw new Error("no audio"); })).not.toThrow();
    expect(signal.sampler).toBeUndefined();
  });
});
