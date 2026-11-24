import { describe, expect, it } from "vitest";

import {
  ORB_VISUAL_STATES,
  PARTICLE_COUNT,
  SEGMENTS,
  TICKS,
  createOrbMotion,
  createParticles,
  drawHexGrid,
  drawOrbFrame,
  simulatedLevel,
  spinTargetFor,
  stepOrbMotion,
  type OrbFrameParams,
  type OrbVisualState
} from "../src/renderer/orb/orb-renderer";
import { THEMES, type ThemeName } from "../src/renderer/theme/themes";

type Call = { name: string; args: unknown[] };

/** A recording fake 2D context: every method call and every property assignment is kept for inspection. */
const createRecordingContext = () => {
  const calls: Call[] = [];
  const sets: Array<[string, unknown]> = [];
  const target: Record<string, unknown> = {};
  const context = new Proxy(target, {
    get: (store, property: string) => {
      if (property in store) return store[property];
      return (...args: unknown[]) => {
        calls.push({ name: property, args });
        if (property === "createRadialGradient") return { addColorStop: (...stopArgs: unknown[]) => calls.push({ name: "addColorStop", args: stopArgs }) };
        return undefined;
      };
    },
    set: (store, property: string, value) => { store[property] = value; sets.push([property, value]); return true; }
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls, sets, count: (name: string) => calls.filter((call) => call.name === name).length };
};

const frame = (overrides: Partial<OrbFrameParams> = {}, themeName: ThemeName = "dark"): OrbFrameParams => ({
  size: 440, time: 3.2, dt: 1 / 60, state: "idle", level: 0.4, theme: THEMES[themeName].orb,
  particles: createParticles(), reducedMotion: false, motion: createOrbMotion(), ...overrides
});

const allNumbers = (calls: Call[]): number[] => calls.flatMap((call) => call.args.filter((value): value is number => typeof value === "number"));

describe("orb renderer: every state in both themes", () => {
  for (const themeName of ["dark", "light"] as const) {
    for (const state of ORB_VISUAL_STATES) {
      it(`draws ${state} in the ${themeName} theme without throwing and with only finite numbers`, () => {
        const fake = createRecordingContext();
        const params = frame({ state }, themeName);
        for (let index = 0; index < 5; index += 1) drawOrbFrame(fake.context, { ...params, time: 3.2 + index / 60 });
        const numbers = allNumbers(fake.calls);
        expect(numbers.length).toBeGreaterThan(1000);
        expect(numbers.every(Number.isFinite)).toBe(true);
        for (const [property, value] of fake.sets) if (typeof value === "string") expect(value, property).not.toMatch(/NaN|Infinity|undefined/u);
        for (const call of fake.calls) if (call.name === "addColorStop") expect(String(call.args[1])).not.toMatch(/NaN|Infinity/u);
      });
    }
  }

  it("draws the expected primitives for one frame", () => {
    const fake = createRecordingContext();
    drawOrbFrame(fake.context, frame());
    // 56 ring segments + inner ring + core clip + rim.
    expect(fake.count("arc")).toBe(SEGMENTS + 3);
    // glow + one rectangle per particle.
    expect(fake.count("fillRect")).toBe(1 + PARTICLE_COUNT);
    // segments + inner ring + 112 ticks + 2 membranes + 5 latitudes x 48 + 12 meridians x 32 + rim.
    expect(fake.count("stroke")).toBe(SEGMENTS + 1 + TICKS + 2 + 5 * 48 + 12 * 32 + 1);
    expect(fake.count("clip")).toBe(1);
    expect(fake.count("save")).toBe(fake.count("restore"));
    expect(fake.count("createRadialGradient")).toBe(1);
  });

  it("scales all math with size / 440 so it looks the same at any window size", () => {
    for (const size of [220, 440, 880]) {
      const fake = createRecordingContext();
      drawOrbFrame(fake.context, frame({ size }));
      const scale = fake.calls.find((call) => call.name === "scale")!;
      expect(scale.args).toEqual([size / 440, size / 440]);
    }
    const fake = createRecordingContext();
    drawOrbFrame(fake.context, frame({ size: Number.NaN }));
    expect(allNumbers(fake.calls).every(Number.isFinite)).toBe(true);
  });

  it("uses additive particles in the dark theme only", () => {
    const dark = createRecordingContext();
    drawOrbFrame(dark.context, frame({}, "dark"));
    expect(dark.sets.filter(([name, value]) => name === "globalCompositeOperation" && value === "lighter")).toHaveLength(1);
    const light = createRecordingContext();
    drawOrbFrame(light.context, frame({}, "light"));
    expect(light.sets.some(([, value]) => value === "lighter")).toBe(false);
  });

  it("draws the number of particles it is given (the adaptive budget) and never more than exist", () => {
    for (const [requested, expected] of [[520, 520], [260, 260], [130, 130], [0, 0], [9999, 520], [-5, 0]] as const) {
      const fake = createRecordingContext();
      drawOrbFrame(fake.context, frame({ particleCount: requested }));
      expect(fake.count("fillRect")).toBe(1 + expected);
    }
  });

  it("uses the amber accent for the error state once the blend has settled", () => {
    const fake = createRecordingContext();
    const params = frame({ state: "error" });
    for (let index = 0; index < 120; index += 1) drawOrbFrame(fake.context, { ...params, time: index / 60 });
    const lastStroke = fake.sets.filter(([name]) => name === "strokeStyle").at(-1)![1] as string;
    expect(params.motion.amber).toBeGreaterThan(0.99);
    expect(lastStroke).toMatch(/^rgba?\(/u);
  });
});

describe("seeded particles and determinism", () => {
  it("builds the same particle field every time and a different one for another seed", () => {
    expect(createParticles()).toEqual(createParticles());
    expect(createParticles()).toHaveLength(PARTICLE_COUNT);
    expect(createParticles(520, 1)).not.toEqual(createParticles());
    for (const particle of createParticles()) {
      expect(particle.a).toBeGreaterThanOrEqual(0);
      expect(particle.z).toBeLessThan(1);
      expect(Math.abs(particle.s)).toBeGreaterThanOrEqual(0.2);
    }
  });

  it("produces identical drawing calls for identical inputs (no randomness while drawing)", () => {
    const record = () => {
      const fake = createRecordingContext();
      drawOrbFrame(fake.context, frame({ state: "listening" }));
      return JSON.stringify(fake.calls);
    };
    expect(record()).toBe(record());
  });
});

describe("level smoothing and the state to look mapping", () => {
  it("eases the level toward its target instead of jumping, and never leaves 0..1", () => {
    const motion = createOrbMotion();
    stepOrbMotion(motion, { dt: 1 / 60, time: 0, state: "listening", targetLevel: 1, reducedMotion: false });
    expect(motion.level).toBeGreaterThan(0);
    expect(motion.level).toBeLessThan(0.5);
    for (let index = 0; index < 200; index += 1) stepOrbMotion(motion, { dt: 1 / 60, time: index, state: "listening", targetLevel: 5, reducedMotion: false });
    expect(motion.level).toBeLessThanOrEqual(1);
    expect(motion.level).toBeGreaterThan(0.99);
    for (let index = 0; index < 400; index += 1) stepOrbMotion(motion, { dt: 1 / 60, time: index, state: "idle", targetLevel: -3, reducedMotion: false });
    expect(motion.level).toBeLessThan(0.01);
    expect(motion.level).toBeGreaterThanOrEqual(0);
  });

  it("ignores hostile numbers", () => {
    const motion = createOrbMotion();
    stepOrbMotion(motion, { dt: Number.NaN, time: Number.POSITIVE_INFINITY, state: "idle", targetLevel: Number.NaN, reducedMotion: false });
    expect([motion.level, motion.spin, motion.amber].every(Number.isFinite)).toBe(true);
  });

  it("caps a long pause between frames so the orb does not leap", () => {
    const motion = createOrbMotion();
    stepOrbMotion(motion, { dt: 10, time: 0, state: "listening", targetLevel: 1, reducedMotion: false });
    expect(motion.level).toBeLessThanOrEqual(0.05 * 9 + 1e-9);
  });

  it("gives every state a distinct spin and a bounded simulated envelope", () => {
    expect(new Set(ORB_VISUAL_STATES.map(spinTargetFor)).size).toBeGreaterThanOrEqual(4);
    expect(spinTargetFor("thinking")).toBeGreaterThan(spinTargetFor("idle"));
    for (const state of ORB_VISUAL_STATES) {
      for (let time = 0; time < 20; time += 0.37) {
        const level = simulatedLevel(state, time);
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("reduced motion", () => {
  const drawn = (state: OrbVisualState, time: number, reducedMotion: boolean) => {
    const fake = createRecordingContext();
    drawOrbFrame(fake.context, frame({ state, time, reducedMotion, level: 0.5 }));
    return JSON.stringify(fake.calls);
  };

  it("does not rotate, move particles or wobble: the picture does not depend on time", () => {
    for (const state of ORB_VISUAL_STATES) expect(drawn(state, 1, true), state).toBe(drawn(state, 9, true));
  });

  it("still animates when motion is allowed", () => {
    expect(drawn("listening", 1, false)).not.toBe(drawn("listening", 9, false));
  });

  it("keeps spin at rest so value changes are smooth rather than animated", () => {
    const motion = createOrbMotion();
    for (let index = 0; index < 300; index += 1) stepOrbMotion(motion, { dt: 1 / 30, time: index, state: "thinking", targetLevel: 0.4, reducedMotion: true });
    expect(Math.abs(motion.spin)).toBeLessThan(0.01);
  });
});

describe("hex grid layer", () => {
  it("strokes a grid inside the given size with finite coordinates and the theme color", () => {
    const fake = createRecordingContext();
    drawHexGrid(fake.context, 480, 740, THEMES.light.orb.hex);
    expect(fake.count("clearRect")).toBe(1);
    expect(fake.count("stroke")).toBeGreaterThan(300);
    expect(allNumbers(fake.calls).every(Number.isFinite)).toBe(true);
    expect(fake.sets.find(([name]) => name === "strokeStyle")![1]).toBe("rgba(11,138,127,0.12)");
  });
});
