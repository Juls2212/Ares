import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { orbStateFor } from "../src/renderer/app/app-state";
import {
  createParticleOrbLoop,
  PARTICLE_CORE_DENSITY,
  PARTICLE_LAYER_COUNTS,
  particleOrbAllowsMotion
} from "../src/renderer/components/particle-orb";

describe("particle orb state and lifecycle", () => {
  it("renders a static dotted fallback and a bounded canvas network independently from animation", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/renderer/components/particle-orb.tsx"), "utf8");

    expect(source).toContain("particle-orb__fallback");
    expect(source).toContain("fallbackDots.map");
    expect(source).toContain("drawNeuralNetwork");
    expect(source).toContain("context.clip()");
    expect(source).toContain("connectionDistance");
    expect(source).toContain("radius * 1.04");
    expect(source).toContain("context.setLineDash");
    expect(source).toContain("particle.focal");
    expect(source).toContain('aria-hidden="true"');
  });

  it("uses a bounded layered particle field rather than one sparse point population", () => {
    expect(PARTICLE_LAYER_COUNTS.contour).toBeGreaterThan(0);
    expect(PARTICLE_LAYER_COUNTS.interior).toBeGreaterThan(PARTICLE_LAYER_COUNTS.contour);
    expect(PARTICLE_LAYER_COUNTS.foreground).toBeGreaterThan(0);
    expect(PARTICLE_CORE_DENSITY).toBeGreaterThanOrEqual(120);
    expect(PARTICLE_CORE_DENSITY).toBeGreaterThanOrEqual(250);
    expect(PARTICLE_CORE_DENSITY).toBeLessThanOrEqual(300);
  });

  it("keeps neural colors configurable and avoids a solid or target-like core", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(styles).toContain("--accent-rgb");
    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain("--accent: #2fcbed");
    expect(styles).toContain("--neural-primary-rgb");
    expect(styles).toContain("--neural-focal-rgb");
    expect(styles).not.toContain("particle-orb__fallback::before");
  });

  it("scopes the light command surface to the approved navy-blue palette", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(styles).toContain("background-color: #E0E0E0");
    expect(styles).toContain("--core-active: #2f7fda");
    expect(styles).toContain("--neural-primary-rgb: 31 71 124");
    expect(styles).toContain("--neural-focal-rgb: 48 126 222");
  });

  it("maps only real voice and interpretation states to visual motion states", () => {
    expect(orbStateFor("IDLE", false)).toBe("idle");
    expect(orbStateFor("RECORDING", false)).toBe("recording");
    expect(orbStateFor("PROCESSING", false)).toBe("transcribing");
    expect(orbStateFor("RECORDING", true)).toBe("interpreting");
  });

  it("disables motion for reduced motion and hidden documents", () => {
    expect(particleOrbAllowsMotion(false, false)).toBe(true);
    expect(particleOrbAllowsMotion(true, false)).toBe(false);
    expect(particleOrbAllowsMotion(false, true)).toBe(false);
  });

  it("pauses decorative motion when the document is hidden and cleans up window listeners", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/renderer/components/particle-orb.tsx"), "utf8");
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(source).toContain('data-paused={isDocumentHidden || undefined}');
    expect(source).toContain("setIsDocumentHidden(document.hidden)");
    expect(source).toContain('window.addEventListener("resize", onResize)');
    expect(source).toContain('window.removeEventListener("resize", onResize)');
    expect(source).toContain("resizeObserver?.disconnect()");
    expect(source).toContain("Math.min(window.devicePixelRatio || 1, 2)");
  });

  it("cancels the pending animation frame during cleanup", () => {
    const draw = vi.fn();
    const requestFrame = vi.fn(() => 41);
    const cancelFrame = vi.fn();
    const loop = createParticleOrbLoop({ canAnimate: () => true, draw, requestFrame, cancelFrame });

    loop.start();
    loop.start();
    loop.stop();

    expect(draw).toHaveBeenCalledOnce();
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(41);
  });
});
