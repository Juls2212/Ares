import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { orbStateFor } from "../src/renderer/app/app-state";
import { GlassOrb, orbStyleFor } from "../src/renderer/components/glass-orb";
import {
  ORB_VISUALS,
  orbAllowsMotion,
  PALETTE,
  visualKeyFor,
  type OrbOverlay,
  type OrbState,
  type OrbVisualKey
} from "../src/renderer/components/orb-visuals";
import {
  AMPLITUDE_ATTACK_MS,
  AMPLITUDE_RANGE,
  AMPLITUDE_RELEASE_MS,
  amplitudeFromRms,
  blobPlaybackRate,
  clampAmplitude,
  createAmplitudeMapper,
  createOrbAmplitudeSource,
  NOISE_FLOOR_WINDOW_MS,
  SPEAKING_ATTENUATION,
  syntheticSpeechAmplitude
} from "../src/renderer/features/voice/orb-amplitude";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
const css = source("src/renderer/styles/ares-glass.css");
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing rule ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("amplitude mapping", () => {
  it("maps rms above the noise floor to 0..1 over a range of 0.25", () => {
    expect(AMPLITUDE_RANGE).toBe(0.25);
    expect(amplitudeFromRms(0.02, 0.02)).toBe(0);
    expect(amplitudeFromRms(0.145, 0.02)).toBeCloseTo(0.5, 6);
    expect(amplitudeFromRms(0.27, 0.02)).toBe(1);
    expect(amplitudeFromRms(5, 0.02)).toBe(1);
    expect(amplitudeFromRms(0, 0.02)).toBe(0);
    expect(clampAmplitude(Number.NaN)).toBe(0);
    expect(clampAmplitude(-3)).toBe(0);
    expect(clampAmplitude(4)).toBe(1);
  });

  it("measures the noise floor over the first 300 ms and then ignores later levels for the floor", () => {
    expect(NOISE_FLOOR_WINDOW_MS).toBe(300);
    const mapper = createAmplitudeMapper();
    // Quiet room at rms 0.02: the floor settles at 0.02 and the amplitude stays at zero.
    for (let time = 0; time < 300; time += 30) expect(mapper.push(0.02, time)).toBeCloseTo(0, 9);
    // Speech afterwards raises the amplitude and does not move the floor.
    let last = 0;
    for (let time = 330; time < 900; time += 30) last = mapper.push(0.27, time);
    expect(last).toBeGreaterThan(0.95);
    mapper.reset();
    expect(mapper.value()).toBe(0);
    // After a reset the next measurements define a new floor.
    for (let time = 5_000; time < 5_300; time += 30) mapper.push(0.1, time);
    expect(mapper.push(0.1, 5_330)).toBeCloseTo(0, 9);
  });

  it("smooths asymmetrically: a 60 ms attack and a 220 ms release", () => {
    expect(AMPLITUDE_ATTACK_MS).toBe(60);
    expect(AMPLITUDE_RELEASE_MS).toBe(220);
    const rising = createAmplitudeMapper();
    rising.push(0, 0);
    rising.push(0, 300);
    const afterAttack = rising.push(0.25, 360);
    // One attack time constant reaches about 63% of the step.
    expect(afterAttack).toBeCloseTo(1 - Math.exp(-1), 2);

    const falling = createAmplitudeMapper();
    falling.push(0, 0);
    falling.push(0, 300);
    for (let time = 330; time <= 1_500; time += 30) falling.push(0.25, time);
    const peak = falling.value();
    expect(peak).toBeGreaterThan(0.99);
    const afterRelease = falling.push(0, 1_500 + 220);
    expect(afterRelease).toBeCloseTo(peak * Math.exp(-1), 2);

    // Over the same 60 ms, the fall is much smaller than the rise: the release is slower than the attack.
    const slow = createAmplitudeMapper();
    slow.push(0, 0);
    slow.push(0, 300);
    for (let time = 330; time <= 1_500; time += 30) slow.push(0.25, time);
    const fall = 1 - slow.push(0, 1_560) / slow.value();
    expect(fall).toBeLessThan(afterAttack / 2);
  });

  it("ignores invalid measurements and non-advancing clocks", () => {
    const mapper = createAmplitudeMapper();
    expect(mapper.push(Number.NaN, 0)).toBe(0);
    expect(mapper.push(-1, 10)).toBe(0);
    expect(mapper.push(0.3, 10)).toBe(0);
  });

  it("computes the blob playback rate as stateSpeed × (1 + amp × 1.2)", () => {
    expect(blobPlaybackRate(2.2, 0)).toBeCloseTo(2.2, 6);
    expect(blobPlaybackRate(2.2, 1)).toBeCloseTo(2.2 * 2.2, 6);
    expect(blobPlaybackRate(1, 0.5)).toBeCloseTo(1.6, 6);
    expect(blobPlaybackRate(1, 9)).toBeCloseTo(2.2, 6);
    expect(blobPlaybackRate(3.6, -1)).toBeCloseTo(3.6, 6);
  });

  it("attenuates the speaking pulse by 0.55 and keeps it gentle and bounded", () => {
    expect(SPEAKING_ATTENUATION).toBe(0.55);
    for (let time = 0; time < 10; time += 0.05) {
      const value = syntheticSpeechAmplitude(time);
      expect(value).toBeGreaterThanOrEqual(0.3 * 0.55 - 1e-9);
      expect(value).toBeLessThanOrEqual(0.55 + 1e-9);
    }
  });

  it("publishes mapped amplitudes to subscribers, resets to zero, and unsubscribes cleanly", () => {
    let clock = 0;
    const source = createOrbAmplitudeSource(() => clock);
    const seen: number[] = [];
    const unsubscribe = source.subscribe((amplitude) => seen.push(amplitude));
    source.pushMicRms(0.02);
    clock = 400;
    source.pushMicRms(0.3);
    expect(seen.length).toBe(2);
    source.reset();
    expect(seen.at(-1)).toBe(0);
    unsubscribe();
    source.pushMicRms(0.3);
    expect(seen.length).toBe(3);
  });
});

describe("state to visual configuration", () => {
  const keys: OrbVisualKey[] = ["idle", "listening", "processing", "speaking", "confirm", "danger", "error", "cancelled"];
  const states: OrbState[] = ["idle", "recording", "transcribing", "interpreting", "acting", "speaking", "error"];
  const overlays: Array<OrbOverlay | undefined> = [undefined, "confirm", "reinforced", "cancelled"];

  it("has a complete configuration for every visual state", () => {
    expect(Object.keys(ORB_VISUALS).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const visual = ORB_VISUALS[key];
      expect(visual.colors).toHaveLength(4);
      for (const value of [visual.speed, visual.scale, visual.halo, visual.core, visual.flow]) expect(Number.isFinite(value)).toBe(true);
      expect(visual.halo).toBeGreaterThan(0);
      expect(visual.base).toMatch(/^#[0-9A-F]{6}$/u);
    }
  });

  it("maps every semantic state and overlay to a configured visual", () => {
    for (const state of states) {
      for (const overlay of overlays) expect(keys).toContain(visualKeyFor(state, overlay));
    }
    expect(visualKeyFor("recording")).toBe("listening");
    expect(visualKeyFor("transcribing")).toBe("processing");
    expect(visualKeyFor("interpreting")).toBe("processing");
    expect(visualKeyFor("acting")).toBe("processing");
    expect(visualKeyFor("speaking")).toBe("speaking");
    expect(visualKeyFor("idle", "confirm")).toBe("confirm");
    expect(visualKeyFor("idle", "reinforced")).toBe("danger");
    expect(visualKeyFor("idle", "cancelled")).toBe("cancelled");
    expect(visualKeyFor("recording", "cancelled")).toBe("listening");
    expect(orbStateFor("RECORDING", false)).toBe("recording");
    expect(orbStateFor("IDLE", true)).toBe("interpreting");
  });

  it("follows the prototype table for speed, scale, halo, core and flow", () => {
    expect(ORB_VISUALS.idle).toMatchObject({ speed: 1, scale: 1, halo: 0.5, core: 0.55, flow: 0, amplitude: "none" });
    expect(ORB_VISUALS.listening).toMatchObject({ speed: 2.2, scale: 1.06, halo: 0.78, core: 0.85, flow: 0.3, amplitude: "mic" });
    expect(ORB_VISUALS.processing).toMatchObject({ speed: 3.6, scale: 0.86, halo: 0.45, core: 0.9, flow: 0.75, amplitude: "none" });
    expect(ORB_VISUALS.speaking).toMatchObject({ speed: 1.4, scale: 0.98, halo: 0.6, core: 0.7, flow: 0.1, amplitude: "speech" });
    expect(ORB_VISUALS.confirm).toMatchObject({ speed: 0.8, halo: 0.45 });
    expect(ORB_VISUALS.danger).toMatchObject({ speed: 0.6, halo: 0.5, core: 0.5 });
    expect(ORB_VISUALS.error).toMatchObject({ speed: 0.3, scale: 0.88, halo: 0.16, core: 0.28 });
    expect(ORB_VISUALS.cancelled).toMatchObject({ scale: 0.95, halo: 0.4 });
  });

  it("uses the new palette for each state's blobs, base and glow", () => {
    expect(ORB_VISUALS.idle.colors).toEqual([PALETTE.emerald, PALETTE.sage, PALETTE.mist, PALETTE.lime]);
    expect(ORB_VISUALS.idle).toMatchObject({ base: "#1E8C7E", glow: PALETTE.sage });
    expect(ORB_VISUALS.listening.colors).toEqual([PALETTE.leaf, PALETTE.lime, PALETTE.emerald, PALETTE.mist]);
    expect(ORB_VISUALS.listening).toMatchObject({ base: "#0A9A6B", glow: PALETTE.lime });
    expect(ORB_VISUALS.processing.colors).toEqual([PALETTE.petrol, PALETTE.emerald, PALETTE.sage, PALETTE.mist]);
    expect(ORB_VISUALS.processing).toMatchObject({ base: "#1B6F73", glow: PALETTE.emerald });
    expect(ORB_VISUALS.speaking.colors).toEqual([PALETTE.lime, PALETTE.sage, PALETTE.emerald, PALETTE.mist]);
    expect(ORB_VISUALS.speaking).toMatchObject({ base: "#3AA38A", glow: PALETTE.lime });
    expect(ORB_VISUALS.error.colors).toEqual(["#9DB3B0", "#849C9A", "#BFD0CC", "#8FA6AB"]);
    expect(ORB_VISUALS.error).toMatchObject({ base: "#8AA09D", glow: "#8AA09D" });
  });

  it("writes the configuration as custom properties so colors cross-fade instead of restarting animations", () => {
    const style = orbStyleFor(ORB_VISUALS.listening);
    expect(style["--orb-c1"]).toBe(PALETTE.leaf);
    expect(style["--orb-base"]).toBe("#0A9A6B");
    expect(style["--orb-scale"]).toBe("1.06");
    for (const selector of [".glass-orb__blob", ".glass-orb__sphere", ".glass-orb__halo"]) {
      expect(rule(selector)).toContain("transition:");
      expect(rule(selector)).toContain("background-color");
    }
    expect(rule(".glass-orb__state-scale")).toContain("transform var(--t-orb)");
  });

  it("pauses motion for reduced motion and for hidden or minimized windows", () => {
    expect(orbAllowsMotion(false, false)).toBe(true);
    expect(orbAllowsMotion(true, false)).toBe(false);
    expect(orbAllowsMotion(false, true)).toBe(false);
  });
});

describe("orb construction", () => {
  const markup = renderToStaticMarkup(createElement(GlassOrb, { state: "idle", onActivate: vi.fn() }));

  it("has the prototype layers inside one native button and no canvas, particles or links", () => {
    for (const layer of ["halo--secondary", "halo--primary", "breathing", "state-scale", "amplitude", "sphere", "rotator--1", "rotator--4", "blob--1", "blob--4", "swirl", "core", "highlight", "edge", "ring"]) {
      expect(markup).toContain(`glass-orb__${layer}`);
    }
    expect(markup.match(/glass-orb__blob--\d/gu)).toHaveLength(4);
    expect(markup.match(/glass-orb__rotator--\d/gu)).toHaveLength(4);
    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup.match(/<span/gu)!.length).toBeLessThanOrEqual(24);
    expect(markup).not.toContain("<canvas");
    const component = source("src/renderer/components/glass-orb.tsx") + source("src/renderer/components/orb-visuals.ts");
    expect(component).not.toMatch(/canvas|particle|getContext|drawIntelligentCore|neural/iu);
    expect(css).not.toMatch(/particle-orb|neural-/u);
  });

  it("animates only transform, opacity and background-color, with static blurs", () => {
    const keyframesBlock = (name: string): string => {
      const start = css.indexOf(`@keyframes ${name} `);
      const lineEnd = css.indexOf("\n", start);
      const line = css.slice(start, lineEnd);
      const balanced = (line.match(/\{/gu)?.length ?? 0) === (line.match(/\}/gu)?.length ?? 0);
      return balanced ? line : css.slice(start, css.indexOf("\n}", start) + 2);
    };
    const animated = ["ares-spin", "ares-swirl", "ares-morph", "ares-breathe", "ares-contract", "ares-fade"].map(keyframesBlock);
    for (const frames of animated) expect(frames).toMatch(/transform|opacity/u);
    for (const frames of animated) expect(frames).not.toMatch(/\b(?:width|height|filter|top|left|margin|box-shadow|background(?!-color))\b\s*:/u);
    for (const selector of [".glass-orb__blob", ".glass-orb__halo", ".glass-orb__swirl", ".glass-orb__core"]) {
      expect(css.slice(css.indexOf(`${selector}`), css.indexOf("}", css.indexOf(`${selector}`)))).toMatch(/filter: blur\(\d+px\)/u);
    }
    expect(css).not.toMatch(/@keyframes[^{]*\{[^}]*filter:/u);
  });

  it("pauses its animations while hidden without touching recording, silence detection or speech", () => {
    const component = source("src/renderer/components/glass-orb.tsx");
    expect(component).toContain("data-paused={documentHidden || undefined}");
    expect(component).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(component).toContain('document.removeEventListener("visibilitychange", onVisibility)');
    expect(css).toMatch(/\.glass-orb\[data-paused\] \.glass-orb__stage \*[^{]*\{ animation-play-state: paused; \}/u);
    for (const forbidden of ["getUserMedia", "MediaRecorder", "response-playback", "speech-end-detector", "manual-voice-recorder", "recording-cancellation", "speak(", "window.ares", "AnalyserNode", "createMediaElementSource", "AudioContext"]) {
      expect(component).not.toContain(forbidden);
    }
    // The detector is not changed by pausing: it keeps its own timer fallback for hidden windows.
    expect(source("src/renderer/features/voice/speech-end-detector.ts")).toContain("document.hidden");
    expect(source("src/renderer/features/voice/recording-cancellation.ts")).not.toContain("visibilitychange");
  });

  it("uses the existing silence analyser for listening and a synthetic pulse for speaking", () => {
    const component = source("src/renderer/components/glass-orb.tsx");
    expect(component).toContain("orbAmplitudeSource.subscribe");
    expect(component).toContain("syntheticSpeechAmplitude(time / 1000)");
    expect(component).toContain('stage.style.setProperty("--amp"');
    expect(component).toContain("blobPlaybackRate(speedRef.current, amplitude)");
    expect(component).not.toMatch(/setAmplitude|useState<number>/u);
    expect(source("src/renderer/app/App.tsx")).toContain("orbAmplitudeSource.pushMicRms(rms)");
    expect(source("src/renderer/app/App.tsx").match(/getUserMedia\(/gu)).toHaveLength(1);
  });

  it("keeps activation semantics: a native button, no key handler, disabled while processing", () => {
    const busy = renderToStaticMarkup(createElement(GlassOrb, { state: "transcribing", disabled: true }));
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('disabled=""');
    expect(markup).not.toContain("onKeyDown");
    expect(markup).toContain('aria-label="Toca para hablar"');
  });
});

describe("reduced motion", () => {
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@keyframes ares-fade-in"));

  it("removes rotation and deformation and keeps only gentle opacity and scale", () => {
    for (const layer of [".glass-orb__rotator", ".glass-orb__blob", ".glass-orb__swirl", ".glass-orb__breathing"]) expect(block).toContain(layer);
    expect(block).toMatch(/\.glass-orb__rotator,[\s\S]*?animation: none !important;/u);
    expect(block).toContain("ares-fade 6s ease-in-out infinite");
    expect(block).toContain("ares-fade 1.6s ease-in-out infinite");
    expect(block).toContain("--amp-gain: 0.03");
    expect(block).not.toMatch(/ares-spin|ares-morph|ares-swirl|rotate/u);
    expect(css).toMatch(/@keyframes ares-fade \{ 0%, 100% \{ opacity: 0\.84; \} 50% \{ opacity: 1; \} \}/u);
  });

  it("keeps every transition at or below 200 ms", () => {
    for (const match of block.matchAll(/--t-[a-z]+: (\d+)ms/gu)) expect(Number(match[1])).toBeLessThanOrEqual(200);
    for (const match of block.matchAll(/transition-duration: (\d+)ms/gu)) expect(Number(match[1])).toBeLessThanOrEqual(200);
    for (const match of block.matchAll(/animation: ares-fade-in (\d+)ms/gu)) expect(Number(match[1])).toBeLessThanOrEqual(200);
  });

  it("shows text at once through the existing reveal controller", () => {
    expect(source("src/renderer/features/assistant/response-core-reveal.ts")).toContain("prefersReducedMotion");
  });

  it("falls back to opaque surfaces for reduced transparency and system colors for high contrast", () => {
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?--glass-tint: var\(--surface-opaque\)/u);
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    for (const keyword of ["Canvas", "CanvasText", "ButtonFace", "ButtonText", "Highlight"]) expect(forced).toContain(keyword);
    expect(forced).toContain("display: none");
  });
});
