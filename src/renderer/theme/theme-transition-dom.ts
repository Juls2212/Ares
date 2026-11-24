import { flushSync } from "react-dom";

import { ignoreOrbLayoutChanges, isOrbLayoutSettling } from "../orb/orb-layout";
import { orbSignal } from "../orb/orb-runtime";
import { paintThemeNow, themeStore } from "./theme-store";
import { applyThemeToElement } from "./themes";
import {
  createFramePacer,
  waveClip,
  type PacingStats,
  type ThemeTransitionDependencies,
  type ViewTransitionLike,
  type WaveGeometry,
  type WaveHandle
} from "./theme-transition";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** The element whose displayed rect is the orb: the canvas itself (or the CSS orb that replaces it). The sphere is drawn at its center. */
const ORB_SELECTOR = ".orb-canvas, .orb-fallback";

/**
 * The wave ring: an aria-hidden, pointer-events-none overlay in the NEW state, with its own view transition name so it
 * sits above the root. It is three concentric strokes (a wide faint one, a medium one and a thin bright one) with no
 * glow effect at all, and only its transform and opacity are animated.
 */
const createWaveElement = (geometry: WaveGeometry): WaveHandle => {
  // Two elements with the same view transition name make the browser abort the transition, so no ring may ever be left behind.
  for (const stale of document.querySelectorAll(".theme-wave")) stale.remove();
  const wrapper = document.createElement("div");
  wrapper.className = "theme-wave";
  wrapper.setAttribute("aria-hidden", "true");
  const size = Math.max(2, geometry.rMax * 2);
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("class", "theme-wave__ring");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("focusable", "false");
  svg.style.left = `${geometry.x - geometry.rMax}px`;
  svg.style.top = `${geometry.y - geometry.rMax}px`;
  for (const className of ["theme-wave__halo", "theme-wave__mid", "theme-wave__line"]) {
    const circle = document.createElementNS(SVG_NAMESPACE, "circle");
    circle.setAttribute("class", className);
    circle.setAttribute("cx", String(size / 2));
    circle.setAttribute("cy", String(size / 2));
    circle.setAttribute("r", String(Math.max(1, size / 2 - 6)));
    circle.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(circle);
  }
  wrapper.append(svg);
  document.body.append(wrapper);
  let animation: Animation | undefined;
  return {
    animate: (keyframes, options) => { try { animation = svg.animate(keyframes, options); } catch { /* no ring animation */ } },
    remove: () => { try { animation?.cancel(); } catch { /* already finished */ } wrapper.remove(); }
  };
};

/** Counts requestAnimationFrame deltas. It reads a timestamp and nothing from the layout. */
const startFramePacing = (): (() => PacingStats) => {
  const pacer = createFramePacer();
  let handle = 0;
  let active = true;
  const tick = (now: number): void => {
    if (!active) return;
    pacer.record(now);
    handle = window.requestAnimationFrame(tick);
  };
  handle = window.requestAnimationFrame(tick);
  return () => {
    active = false;
    window.cancelAnimationFrame(handle);
    return pacer.stats();
  };
};

/** The real browser wiring of the theme transition. */
export const createDomThemeTransitionDependencies = (): ThemeTransitionDependencies => ({
  startViewTransition: typeof (document as { startViewTransition?: unknown }).startViewTransition === "function"
    ? (update) => (document as unknown as { startViewTransition: (callback: () => void) => ViewTransitionLike }).startViewTransition(update)
    : undefined,
  isHidden: () => document.hidden,
  prefersReducedMotion: () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } },
  isWindowResizing: () => isOrbLayoutSettling(),
  ignoreLayoutChanges: (milliseconds) => ignoreOrbLayoutChanges(milliseconds),
  hasOrb: () => document.querySelector(ORB_SELECTOR) !== null,
  apply: (theme) => {
    applyThemeToElement(document.documentElement, theme);
    // flushSync commits the React views (the toggle bulb) now, so they are part of the new snapshot. It runs once, before the animation.
    try { flushSync(() => themeStore.set(theme)); } catch { themeStore.set(theme); }
  },
  redraw: paintThemeNow,
  measureCanvas: () => {
    const rect = document.querySelector(ORB_SELECTOR)?.getBoundingClientRect();
    return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined;
  },
  getViewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
  setWaveVariables: (geometry) => {
    const style = document.documentElement.style;
    style.removeProperty("--wave-clip");
    if (geometry) style.setProperty("--wave-clip", waveClip(geometry.r0, geometry));
  },
  createWave: createWaveElement,
  animateRoot: (keyframes, options) => {
    try { document.documentElement.animate(keyframes, { ...options, pseudoElement: "::view-transition-new(root)" }); } catch { /* the CSS clip-path stays at the sphere until the transition ends */ }
  },
  startPulse: () => { orbSignal.pulseStart = performance.now(); },
  setLowCost: (enabled) => { orbSignal.lowCost = enabled; },
  startPacing: startFramePacing,
  log: (line) => console.info(line),
  setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
  clearTimer: (handle) => window.clearTimeout(handle as number)
});
