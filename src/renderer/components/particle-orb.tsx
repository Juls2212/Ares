import { type CSSProperties, useEffect, useRef } from "react";

export type ParticleOrbState = "idle" | "recording" | "transcribing" | "interpreting" | "speaking";

type Particle = {
  angle: number;
  layer: "contour" | "interior" | "foreground";
  radius: number;
  size: number;
  phase: number;
};

type ParticleOrbProps = {
  state: ParticleOrbState;
  label: string;
};

type DotStyle = CSSProperties & Record<"--dot-x" | "--dot-y" | "--dot-size" | "--dot-opacity", string>;

type ParticleOrbLoopDependencies = {
  canAnimate: () => boolean;
  draw: () => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
};

export const particleOrbAllowsMotion = (
  reducedMotion: boolean,
  documentHidden: boolean
): boolean => !reducedMotion && !documentHidden;

export const PARTICLE_LAYER_COUNTS = {
  contour: 220,
  interior: 360,
  foreground: 56
} as const;

export const PARTICLE_CORE_DENSITY = Object.values(PARTICLE_LAYER_COUNTS)
  .reduce((total, count) => total + count, 0);

/** Schedules one renderer-only canvas loop and always releases its pending frame. */
export const createParticleOrbLoop = (
  dependencies: ParticleOrbLoopDependencies
): { start: () => void; stop: () => void } => {
  let frame: number | undefined;
  let running = false;

  const tick = (): void => {
    if (!running) return;
    dependencies.draw();
    if (dependencies.canAnimate()) {
      frame = dependencies.requestFrame(tick);
    } else {
      frame = undefined;
    }
  };

  return {
    start: (): void => {
      if (running) return;
      running = true;
      dependencies.draw();
      if (dependencies.canAnimate()) frame = dependencies.requestFrame(tick);
    },
    stop: (): void => {
      running = false;
      if (frame !== undefined) dependencies.cancelFrame(frame);
      frame = undefined;
    }
  };
};

const createParticles = (): Particle[] => {
  const contour = Array.from({ length: PARTICLE_LAYER_COUNTS.contour }, (_, index) => ({
    angle: (index / PARTICLE_LAYER_COUNTS.contour) * Math.PI * 2 + (Math.random() - 0.5) * 0.035,
    layer: "contour" as const,
    radius: 0.68 + Math.random() * 0.29,
    size: 0.85 + Math.random() * 1.25,
    phase: Math.random() * Math.PI * 2
  }));
  const interior = Array.from({ length: PARTICLE_LAYER_COUNTS.interior }, () => ({
    angle: Math.random() * Math.PI * 2,
    layer: "interior" as const,
    radius: Math.sqrt(Math.random()) * 0.87,
    size: 0.78 + Math.random() * 1.45,
    phase: Math.random() * Math.PI * 2
  }));
  const foreground = Array.from({ length: PARTICLE_LAYER_COUNTS.foreground }, () => ({
    angle: Math.random() * Math.PI * 2,
    layer: "foreground" as const,
    radius: 0.12 + Math.sqrt(Math.random()) * 0.7,
    size: 1.6 + Math.random() * 1.65,
    phase: Math.random() * Math.PI * 2
  }));

  return [...contour, ...interior, ...foreground];
};

const createFallbackDots = (): DotStyle[] => {
  const contour = Array.from({ length: 112 }, (_, index) => {
    const angle = (index / 112) * Math.PI * 2 + Math.sin(index * 1.41) * 0.035;
    const radius = 39 + Math.sin(index * 1.91) * 4.3 + Math.sin(index * 0.47) * 2.1;
    return {
      "--dot-x": `${50 + Math.cos(angle) * radius}%`,
      "--dot-y": `${50 + Math.sin(angle) * radius}%`,
      "--dot-size": `${1.15 + (index % 4) * 0.24}px`,
      "--dot-opacity": `${0.31 + (index % 5) * 0.055}`
    };
  });
  const interior = Array.from({ length: 216 }, (_, index) => {
    const fraction = (index + 0.5) / 216;
    const angle = index * 2.399963229728653;
    const radius = Math.sqrt(fraction) * (41 + Math.sin(index * 1.73) * 3);
    return {
      "--dot-x": `${50 + Math.cos(angle) * radius}%`,
      "--dot-y": `${50 + Math.sin(angle) * radius}%`,
      "--dot-size": `${1.05 + (index % 5) * 0.23}px`,
      "--dot-opacity": `${0.31 + (index % 7) * 0.055}`
    };
  });
  const foreground = Array.from({ length: 32 }, (_, index) => {
    const angle = index * 2.399963229728653 + 0.55;
    const radius = 12 + ((index * 19) % 59);
    return {
      "--dot-x": `${50 + Math.cos(angle) * radius}%`,
      "--dot-y": `${50 + Math.sin(angle) * radius}%`,
      "--dot-size": `${1.8 + (index % 4) * 0.35}px`,
      "--dot-opacity": `${0.56 + (index % 5) * 0.06}`
    };
  });

  return [...contour, ...interior, ...foreground];
};

const fallbackDots = createFallbackDots();

const motionFor = (state: ParticleOrbState, now: number): { pulse: number; rotation: number; drift: number; twinkle: number } => {
  switch (state) {
    case "recording":
      return { pulse: 1 + Math.sin(now * 0.008) * 0.11, rotation: now * 0.0002, drift: 0.105, twinkle: 0.36 };
    case "transcribing":
      return { pulse: 0.985 + Math.sin(now * 0.004) * 0.038, rotation: now * 0.00048, drift: 0.06, twinkle: 0.26 };
    case "interpreting":
      return { pulse: 0.99 + Math.sin(now * 0.005) * 0.045, rotation: -now * 0.00041, drift: 0.052, twinkle: 0.3 };
    case "speaking":
      return { pulse: 1 + Math.sin(now * 0.011) * 0.08, rotation: now * 0.00026, drift: 0.08, twinkle: 0.33 };
    default:
      return { pulse: 1 + Math.sin(now * 0.00085) * 0.018, rotation: now * 0.000065, drift: 0.026, twinkle: 0.17 };
  }
};

const drawOrb = (
  canvas: HTMLCanvasElement,
  particles: Particle[],
  state: ParticleOrbState,
  accentRgb: string
): void => {
  const context = canvas.getContext("2d");
  if (!context) return;
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(bounds.width * scale));
  const height = Math.max(1, Math.floor(bounds.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform?.(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);

  const now = performance.now();
  const motion = motionFor(state, now);
  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;
  const radius = Math.min(bounds.width, bounds.height) * 0.43 * motion.pulse;
  const positions = particles.map((particle) => {
    const layerDrift = particle.layer === "contour" ? motion.drift * 0.42 : motion.drift;
    const shimmer = Math.sin(now * 0.0012 + particle.phase) * layerDrift;
    const densityBreath = Math.sin(now * 0.0008 + particle.phase * 0.7) * (particle.layer === "interior" ? 0.022 : 0.012);
    const particleRadius = radius * Math.max(0.08, particle.radius + shimmer + densityBreath);
    const angle = particle.angle + motion.rotation + Math.sin(now * 0.0007 + particle.phase) * layerDrift;
    const layerAlpha = particle.layer === "contour" ? 0.5 : particle.layer === "foreground" ? 0.72 : 0.42;
    const twinkle = Math.max(0, Math.sin(now * 0.0033 + particle.phase * 2.7)) * motion.twinkle;
    return {
      x: centerX + Math.cos(angle) * particleRadius,
      y: centerY + Math.sin(angle) * particleRadius,
      alpha: Math.min(0.98, layerAlpha + twinkle),
      layer: particle.layer,
      size: particle.size * (1 + twinkle * 0.18)
    };
  });

  context.lineWidth = 0.45;
  const connectedPositions = positions.filter((point, index) => point.layer !== "contour" && index % 3 === 0);
  for (let left = 0; left < connectedPositions.length; left += 1) {
    for (let right = left + 1; right < connectedPositions.length; right += 1) {
      const xDistance = connectedPositions[left].x - connectedPositions[right].x;
      const yDistance = connectedPositions[left].y - connectedPositions[right].y;
      const distance = Math.hypot(xDistance, yDistance);
      if (distance > radius * 0.23) continue;
      context.strokeStyle = `rgb(${accentRgb} / ${0.08 * (1 - distance / (radius * 0.23))})`;
      context.beginPath();
      context.moveTo(connectedPositions[left].x, connectedPositions[left].y);
      context.lineTo(connectedPositions[right].x, connectedPositions[right].y);
      context.stroke();
    }
  }

  for (const point of positions) {
    const alpha = point.layer === "foreground" ? Math.min(1, point.alpha + 0.08) : point.alpha;
    context.fillStyle = `rgb(${accentRgb} / ${alpha})`;
    context.beginPath();
    context.arc(point.x, point.y, point.size, 0, Math.PI * 2);
    context.fill();
  }
};

const getAccentRgb = (canvas: HTMLCanvasElement): string => {
  try {
    return getComputedStyle(canvas).getPropertyValue("--accent-rgb").trim() || "0 129 166";
  } catch {
    return "0 129 166";
  }
};

/** A decorative command-center field driven only by existing renderer state. */
export const ParticleOrb = ({ state, label }: ParticleOrbProps) => {
  const canvasReference = useRef<HTMLCanvasElement>(null);
  const stateReference = useRef(state);
  stateReference.current = state;

  useEffect(() => {
    const canvas = canvasReference.current;
    if (!canvas) return;
    try {
      const requestFrame = window.requestAnimationFrame?.bind(window);
      const cancelFrame = window.cancelAnimationFrame?.bind(window);
      if (!requestFrame || !cancelFrame || !canvas.getContext("2d")) return;
      const particles = createParticles();
      let accentRgb = getAccentRgb(canvas);
      const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      const loop = createParticleOrbLoop({
        canAnimate: () => particleOrbAllowsMotion(mediaQuery?.matches ?? true, document.hidden),
        draw: () => drawOrb(canvas, particles, stateReference.current, accentRgb),
        requestFrame,
        cancelFrame
      });
      const refresh = (): void => {
        loop.stop();
        loop.start();
      };
      const ResizeObserverConstructor = window.ResizeObserver;
      const resizeObserver = ResizeObserverConstructor ? new ResizeObserverConstructor(refresh) : undefined;
      resizeObserver?.observe(canvas);
      const MutationObserverConstructor = window.MutationObserver;
      const themeObserver = MutationObserverConstructor
        ? new MutationObserverConstructor(() => {
          accentRgb = getAccentRgb(canvas);
          refresh();
        })
        : undefined;
      themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      document.addEventListener("visibilitychange", refresh);
      mediaQuery?.addEventListener?.("change", refresh);
      loop.start();
      return () => {
        loop.stop();
        resizeObserver?.disconnect();
        themeObserver?.disconnect();
        document.removeEventListener("visibilitychange", refresh);
        mediaQuery?.removeEventListener?.("change", refresh);
      };
    } catch {
      // The static dot field remains available when an optional visual API fails.
      return;
    }
  }, [state]);

  return (
    <div className={`particle-orb particle-orb--${state}`} data-state={state}>
      <div aria-hidden="true" className="particle-orb__fallback">
        {fallbackDots.map((style, index) => <i key={index} style={style} />)}
      </div>
      <canvas aria-hidden="true" ref={canvasReference} />
      <span className="particle-orb__label">{label}</span>
    </div>
  );
};
