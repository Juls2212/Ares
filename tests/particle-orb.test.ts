import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { orbStateFor } from "../src/renderer/app/app-state";
import {
  clampVoiceLevel,
  createParticleOrbLoop,
  PARTICLE_CONNECTION_LIMIT,
  PARTICLE_CORE_DENSITY,
  particleOrbAllowsMotion,
  voiceReactiveStyleFor
} from "../src/renderer/components/particle-orb";

describe("particle orb state and lifecycle", () => {
  it("renders a static fallback and a bounded intelligent core independently from animation", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/renderer/components/particle-orb.tsx"), "utf8");

    expect(source).toContain("particle-orb__fallback");
    expect(source).toContain("fallbackDots.map");
    expect(source).toContain("particle-orb__halo");
    expect(source).toContain("particle-orb__nucleus");
    expect(source).toContain("particle-orb__ripple");
    expect(source).toContain("drawIntelligentCore");
    expect(source).toContain("context.clip()");
    expect(source).toContain("PARTICLE_CONNECTION_LIMIT");
    expect(source).toContain("particle.focal");
    expect(source).not.toContain("drawNeuralNetwork");
    expect(source).not.toContain("context.setLineDash");
    expect(source).toContain('aria-hidden="true"');
  });

  it("uses a bounded, readable particle core with only short connection fragments", () => {
    expect(PARTICLE_CORE_DENSITY).toBeGreaterThanOrEqual(24);
    expect(PARTICLE_CORE_DENSITY).toBeLessThanOrEqual(40);
    expect(PARTICLE_CONNECTION_LIMIT).toBeGreaterThan(0);
    expect(PARTICLE_CONNECTION_LIMIT).toBeLessThanOrEqual(32);
  });

  it("keeps the compact core navy-blue and removes the active grid and framed treatment", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(styles).toContain(':root[data-theme="dark"]');
    const compactCore = styles.slice(styles.lastIndexOf("/* The active voice shell"));

    expect(compactCore).toContain("--neural-primary-rgb: 63 141 213");
    expect(compactCore).toContain("--neural-focal-rgb: 143 220 255");
    expect(compactCore).toContain(".particle-orb__halo");
    expect(compactCore).toContain(".particle-orb__nucleus");
    expect(compactCore).toContain("background-image: var(--glass-atmosphere)");
    expect(compactCore).toMatch(/\.particle-orb::after\s*\{\s*display: none;/);
    expect(compactCore).toContain("background-size: auto;");
    expect(compactCore).toContain("backdrop-filter: blur(18px)");
  });

  it("keeps the compact shell within its responsive no-scroll bounds", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    const glassShell = styles.slice(styles.lastIndexOf("/* The active voice shell"));
    expect(glassShell).toContain("--glass-background: #101c2c");
    expect(glassShell).toContain("background-color: var(--glass-background)");
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("overflow: hidden");
    expect(glassShell).toContain("width: clamp(230px, min(66vw, 72dvh), 290px)");
    expect(styles).toContain("@media (max-height: 600px)");
  });

  it("clamps transient microphone levels and maps only listening to visible reaction", () => {
    expect(clampVoiceLevel(-1)).toBe(0);
    expect(clampVoiceLevel(0.46)).toBe(0.46);
    expect(clampVoiceLevel(8)).toBe(1);
    expect(clampVoiceLevel(Number.NaN)).toBe(0);

    const low = voiceReactiveStyleFor("recording", 0.1);
    const high = voiceReactiveStyleFor("recording", 0.9);
    expect(Number(high["--voice-nucleus-scale"])).toBeGreaterThan(Number(low["--voice-nucleus-scale"]));
    expect(Number(high["--voice-halo-scale"])).toBeGreaterThan(Number(low["--voice-halo-scale"]));
    expect(Number(high["--voice-link-opacity"])).toBeGreaterThan(Number(low["--voice-link-opacity"]));
    expect(voiceReactiveStyleFor("idle", 0.9)["--voice-level"]).toBe("0.000");
    expect(voiceReactiveStyleFor("recording", 0.9, true)["--voice-level"]).toBe("0.000");
  });

  it("keeps all semantic orb states explicit without changing voice-state logic", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/renderer/components/particle-orb.tsx"), "utf8");

    for (const state of ["idle", "recording", "transcribing", "interpreting", "acting", "speaking", "error"]) {
      expect(source).toContain(`"${state}"`);
    }
    expect(source).toContain('data-voice-level={activeVoiceLevel.toFixed(3)}');
    expect(source).toContain('state === "recording" && !prefersReducedMotion');
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
    const requestFrame = vi.fn();
    const draw = vi.fn();
    const loop = createParticleOrbLoop({ canAnimate: () => particleOrbAllowsMotion(true, false), draw, requestFrame, cancelFrame: vi.fn() });
    loop.start();
    expect(draw).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
    loop.stop();
  });

  it("pauses decorative motion when the document is hidden and cleans up window listeners", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/renderer/components/particle-orb.tsx"), "utf8");
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(source).toContain('data-paused={isDocumentHidden || undefined}');
    expect(source).toContain("setIsDocumentHidden(document.hidden)");
    expect(source).toContain('window.addEventListener("resize", onResize)');
    expect(source).toContain('window.removeEventListener("resize", onResize)');
    expect(source).toContain("resizeObserver?.disconnect()");
    expect(source).toContain('themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })');
    expect(source).toContain("themeObserver?.disconnect()");
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
