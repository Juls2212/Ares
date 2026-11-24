import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { registerThemePainter, themeStore } from "../theme/theme-store";
import { THEMES, type ThemeName } from "../theme/themes";
import { THEME_PULSE_MS, pulseAt } from "../theme/theme-transition";
import { createOrbMotion, createParticles, drawHexGrid, drawOrbFrame, PARTICLE_COUNT } from "./orb-renderer";
import { ORB_SIZE_TOLERANCE_PX, markOrbLayoutChange, registerOrbLayoutProbe } from "./orb-layout";
import { MINIMUM_PARTICLES, createFrameLoop, createParticleBudget, orbSignal, targetLevelFor, type OrbSignal } from "./orb-runtime";

/** Device pixel ratio is capped so a large display does not make the orb expensive. */
export const MAXIMUM_PIXEL_RATIO = 2;

const queryMatches = (query: string): boolean => {
  try { return window.matchMedia?.(query).matches ?? false; } catch { return false; }
};

/** True while the media query matches; follows its change events. */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => queryMatches(query));
  useEffect(() => {
    let list: MediaQueryList | undefined;
    try { list = window.matchMedia?.(query); } catch { list = undefined; }
    if (!list) return undefined;
    const onChange = (): void => setMatches(list!.matches);
    onChange();
    list.addEventListener?.("change", onChange);
    return () => list!.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
};

/** The effective theme. It is set by the theme transition controller (from prefers-color-scheme), never by a component. */
export const useThemeName = (): ThemeName => useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.getServerSnapshot);

const sizeCanvas = (canvas: HTMLCanvasElement, width: number, height: number): { ratio: number; ctx: CanvasRenderingContext2D | null } => {
  const ratio = Math.min(window.devicePixelRatio || 1, MAXIMUM_PIXEL_RATIO);
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ratio, ctx };
};

/**
 * The static hexagon grid on its own layer, redrawn when the size changes and, synchronously, when the theme changes
 * (so a theme transition snapshot already contains the new grid).
 */
export const HexBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let sized = false;
    let dirty = false;
    const paint = (): void => {
      dirty = false;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const { ctx } = sizeCanvas(canvas, rect.width, rect.height);
      sized = true;
      if (ctx) drawHexGrid(ctx, rect.width, rect.height, THEMES[themeStore.get()].orb.hex);
    };
    paint();
    // The theme painter also repaints a grid that was left stale by a resize during a transition.
    const unregister = registerThemePainter(() => { if (sized || dirty) paint(); });
    // While a theme transition runs the static grid is not redrawn (it would cost a full-window repaint); it catches up afterwards.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => { if (orbSignal.lowCost) dirty = true; else paint(); });
    observer?.observe(canvas);
    return () => { unregister(); observer?.disconnect(); };
  }, []);
  return <canvas aria-hidden="true" className="hex-background" ref={canvasRef} />;
};

type OrbCanvasProps = { signal?: OrbSignal; onActivate?: () => void };

/**
 * The orb. It draws with Canvas 2D from the shared signal and never re-renders for a level change. It reads the theme
 * from the store on every frame, and registers a painter so a theme change repaints it immediately. With forced colors,
 * or when no 2D context exists, it shows a plain CSS orb instead. The canvas is hidden from assistive technology: the
 * state is announced by the status text.
 */
export const OrbCanvas = ({ signal = orbSignal, onActivate }: OrbCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const forcedColors = useMediaQuery("(forced-colors: active)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [noContext, setNoContext] = useState(false);
  const fallback = forcedColors || noContext;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (fallback || !canvas || !container) return undefined;
    let probe: CanvasRenderingContext2D | null = null;
    try { probe = canvas.getContext("2d"); } catch { probe = null; }
    if (!probe) { setNoContext(true); return undefined; }

    const particles = createParticles(PARTICLE_COUNT);
    const motion = createOrbMotion();
    const budget = createParticleBudget(PARTICLE_COUNT);
    let size = 0;
    let ctx: CanvasRenderingContext2D | null = probe;
    let time = 0;
    let particleCount = PARTICLE_COUNT;

    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      const side = Math.floor(Math.min(rect.width, rect.height));
      if (side < 1 || side === size) return;
      size = side;
      ctx = sizeCanvas(canvas, side, side).ctx;
      // Redraw at once so a resize is crisp even while the loop is paused.
      if (ctx) paint(0);
    };
    const paint = (dt: number): void => {
      if (!ctx || size < 1) return;
      time += reducedMotion ? 0 : dt;
      const now = performance.now();
      const pulse = reducedMotion || signal.pulseStart === undefined ? 0 : pulseAt(now - signal.pulseStart);
      // During a theme transition the orb is drawn at low cost: the minimum particle count and no shadow blur.
      const cheap = signal.lowCost;
      drawOrbFrame(ctx, {
        size, time, dt, state: signal.state, level: targetLevelFor(signal, time, now), theme: THEMES[themeStore.get()].orb,
        particles, particleCount: cheap ? MINIMUM_PARTICLES : particleCount, reducedMotion, motion, pulse, cheap
      });
    };
    const pulsing = (): boolean => signal.pulseStart !== undefined && performance.now() - signal.pulseStart <= THEME_PULSE_MS;
    // The slow (about 30 fps) rate also applies while a theme transition runs, to leave the main thread to the animation.
    const idle = (): boolean => reducedMotion || signal.lowCost || (signal.state === "idle" && !pulsing());
    const loop = createFrameLoop({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      isHidden: () => document.hidden,
      isIdle: idle,
      draw: (now, frameMs) => {
        // Idle frames are slow on purpose, so only active frames say anything about the device.
        if (!idle()) particleCount = budget.record(frameMs, now);
        paint(frameMs / 1000);
      }
    });
    const onVisibility = (): void => { if (document.hidden) loop.stop(); else loop.start(); };
    // A theme change repaints at once (dt 0), so the new snapshot of a view transition has the new palette and the pulse.
    const unregister = registerThemePainter(() => paint(0));
    // A canvas whose displayed size differs from the size it was drawn at is a resize that has not been handled yet.
    const unregisterProbe = registerOrbLayoutProbe(() => {
      const rect = container.getBoundingClientRect();
      return size > 0 && Math.abs(Math.floor(Math.min(rect.width, rect.height)) - size) >= ORB_SIZE_TOLERANCE_PX;
    });
    const onWindowResize = (): void => markOrbLayoutChange();
    window.addEventListener("resize", onWindowResize);

    resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(container);
    document.addEventListener("visibilitychange", onVisibility);
    loop.start();
    return () => {
      loop.stop();
      unregister();
      unregisterProbe();
      window.removeEventListener("resize", onWindowResize);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fallback, reducedMotion, signal]);

  return <div aria-hidden="true" className="orb-stage" onClick={onActivate} ref={containerRef}>
    {fallback ? <OrbFallback signal={signal} /> : <canvas className="orb-canvas" ref={canvasRef} />}
  </div>;
};

/** A plain CSS orb for forced colors and for a missing 2D context: a circle with a border and a ring that shows the state. */
export const OrbFallback = ({ signal }: { signal: OrbSignal }) => {
  const [state, setState] = useState(signal.state);
  useEffect(() => {
    const timer = window.setInterval(() => setState((current) => (current === signal.state ? current : signal.state)), 250);
    return () => window.clearInterval(timer);
  }, [signal]);
  return <span className="orb-fallback" data-state={state}><span className="orb-fallback__ring" /></span>;
};

