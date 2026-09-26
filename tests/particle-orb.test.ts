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
  it("renders a static dotted fallback independently from canvas animation", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/renderer/components/particle-orb.tsx"), "utf8");

    expect(source).toContain("particle-orb__fallback");
    expect(source).toContain("fallbackDots.map");
    expect(source).toContain("particle-orb__hud");
    expect(source).toContain("particle-orb__ring--outer");
    expect(source).toContain("particle-orb__orbit--one");
    expect(source).toContain("particle-orb__ticks");
    expect(source).toContain("particle-orb__direction");
    expect(source).toContain("particle-orb__trace");
    expect(source).toContain("particle-orb__scan");
    expect(source).toContain('d="M17 17A46 46');
  });

  it("uses a dense layered particle field rather than one sparse point population", () => {
    expect(PARTICLE_LAYER_COUNTS.contour).toBeGreaterThan(100);
    expect(PARTICLE_LAYER_COUNTS.interior).toBeGreaterThan(PARTICLE_LAYER_COUNTS.contour);
    expect(PARTICLE_LAYER_COUNTS.foreground).toBeGreaterThan(0);
    expect(PARTICLE_CORE_DENSITY).toBeGreaterThanOrEqual(600);
  });

  it("keeps particle color configurable and avoids an idle target-ring outline", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(styles).toContain("--accent-rgb");
    expect(styles).toContain(':root[data-theme="dark"]');
    expect(styles).toContain("--accent: #2fcbed");
    expect(styles).toContain("background: var(--accent)");
    expect(styles).not.toContain("particle-orb__fallback::before");
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

  it("pauses decorative HUD motion when the document is hidden", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/renderer/components/particle-orb.tsx"), "utf8");
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(source).toContain('data-paused={isDocumentHidden || undefined}');
    expect(source).toContain("setIsDocumentHidden(document.hidden)");
    expect(styles).toContain('.particle-orb[data-paused="true"]');
    expect(styles).toContain(".particle-orb--recording .particle-orb__ring--outer");
    expect(styles).toContain(".particle-orb--transcribing .particle-orb__scan");
    expect(styles).toContain(".particle-orb--interpreting .particle-orb__scan");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
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
