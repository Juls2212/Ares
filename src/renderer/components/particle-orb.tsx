import { type CSSProperties, useEffect, useRef, useState } from "react";

export type ParticleOrbState = "idle" | "recording" | "transcribing" | "interpreting" | "speaking";

type Particle = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  size: number;
  opacity: number;
  focal: boolean;
};

type ParticleOrbProps = {
  state: ParticleOrbState;
  label: string;
  responseText?: string;
  responsePhase?: "REVEALING" | "COMPLETED" | "FADING";
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
  contour: 48,
  interior: 180,
  foreground: 40
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
    if (dependencies.canAnimate()) frame = dependencies.requestFrame(tick);
    else frame = undefined;
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

const particleFor = (layer: "contour" | "interior" | "foreground", index: number, count: number): Particle => {
  const angle = layer === "contour"
    ? (index / count) * Math.PI * 2 + Math.sin(index * 1.7) * 0.08
    : Math.random() * Math.PI * 2;
  const radius = layer === "contour"
    ? 0.7 + Math.random() * 0.19
    : Math.sqrt(Math.random()) * (layer === "foreground" ? 0.7 : 0.83);
  const speed = layer === "foreground" ? 0.035 : layer === "contour" ? 0.018 : 0.028;
  const direction = Math.random() * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    velocityX: Math.cos(direction) * speed,
    velocityY: Math.sin(direction) * speed,
    size: layer === "foreground" ? 2.1 + Math.random() * 1.35 : layer === "contour" ? 1.12 + Math.random() * 1.08 : 0.96 + Math.random() * 1.1,
    opacity: layer === "foreground" ? 0.88 : layer === "contour" ? 0.68 : 0.57,
    focal: layer === "foreground" && index % 8 === 0
  };
};

const createParticles = (): Particle[] => [
  ...Array.from({ length: PARTICLE_LAYER_COUNTS.contour }, (_, index) => particleFor("contour", index, PARTICLE_LAYER_COUNTS.contour)),
  ...Array.from({ length: PARTICLE_LAYER_COUNTS.interior }, (_, index) => particleFor("interior", index, PARTICLE_LAYER_COUNTS.interior)),
  ...Array.from({ length: PARTICLE_LAYER_COUNTS.foreground }, (_, index) => particleFor("foreground", index, PARTICLE_LAYER_COUNTS.foreground))
];

const fallbackDots: DotStyle[] = Array.from({ length: PARTICLE_CORE_DENSITY }, (_, index) => {
  const angle = index * 2.399963229728653;
  const radius = Math.sqrt((index + 0.5) / PARTICLE_CORE_DENSITY) * (40 + Math.sin(index * 1.9) * 3.5);
  return {
    "--dot-x": `${50 + Math.cos(angle) * radius}%`,
    "--dot-y": `${50 + Math.sin(angle) * radius}%`,
    "--dot-size": `${0.9 + (index % 5) * 0.24}px`,
    "--dot-opacity": `${0.3 + (index % 7) * 0.055}`
  };
});

const speedFor = (state: ParticleOrbState): number => {
  switch (state) {
    case "recording": return 1.85;
    case "transcribing": return 1.3;
    case "interpreting": return 1.5;
    case "speaking": return 1.15;
    default: return 0.72;
  }
};

const updateParticles = (particles: Particle[], elapsedSeconds: number, speed: number): void => {
  for (const particle of particles) {
    particle.x += particle.velocityX * elapsedSeconds * speed;
    particle.y += particle.velocityY * elapsedSeconds * speed;
    const distance = Math.hypot(particle.x, particle.y);
    if (distance <= 0.9) continue;
    const normalX = particle.x / distance;
    const normalY = particle.y / distance;
    particle.x = normalX * 0.9;
    particle.y = normalY * 0.9;
    const radialVelocity = particle.velocityX * normalX + particle.velocityY * normalY;
    particle.velocityX -= 2 * radialVelocity * normalX;
    particle.velocityY -= 2 * radialVelocity * normalY;
  }
};

const getColor = (canvas: HTMLCanvasElement, name: "--neural-primary-rgb" | "--neural-focal-rgb", fallback: string): string => {
  try {
    return getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
};

const drawNeuralNetwork = (
  canvas: HTMLCanvasElement,
  particles: Particle[],
  state: ParticleOrbState,
  previousTime: { value: number }
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
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);

  const now = performance.now();
  const elapsedSeconds = Math.min((now - previousTime.value) / 1000, 0.05);
  previousTime.value = now;
  updateParticles(particles, elapsedSeconds, speedFor(state));

  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;
  const radius = Math.min(bounds.width, bounds.height) * 0.43;
  const positions = particles.map((particle) => ({
    ...particle,
    x: centerX + particle.x * radius,
    y: centerY + particle.y * radius
  }));
  const primaryBlue = getColor(canvas, "--neural-primary-rgb", "16 61 118");
  const focalBlue = getColor(canvas, "--neural-focal-rgb", "45 124 222");
  const connectionDistance = radius * 0.22;

  context.save();
  context.strokeStyle = `rgb(${primaryBlue} / 0.72)`;
  context.lineWidth = 0.8;
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.04, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = `rgb(${primaryBlue} / 0.34)`;
  context.lineWidth = 0.55;
  context.setLineDash([2, 6]);
  context.beginPath();
  context.arc(centerX, centerY, radius * 0.78, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([1, 8]);
  context.beginPath();
  context.arc(centerX, centerY, radius * 0.57, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.clip();
  context.lineWidth = 0.55;
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const distance = Math.hypot(positions[left].x - positions[right].x, positions[left].y - positions[right].y);
      if (distance > connectionDistance) continue;
      const strength = 1 - distance / connectionDistance;
      const color = positions[left].focal || positions[right].focal ? focalBlue : primaryBlue;
      context.strokeStyle = `rgb(${color} / ${0.34 * strength})`;
      context.beginPath();
      context.moveTo(positions[left].x, positions[left].y);
      context.lineTo(positions[right].x, positions[right].y);
      context.stroke();
    }
  }
  for (const particle of positions) {
    context.fillStyle = `rgb(${particle.focal ? focalBlue : primaryBlue} / ${particle.opacity})`;
    context.shadowBlur = particle.focal ? 8 : 0;
    context.shadowColor = `rgb(${focalBlue} / 0.72)`;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size * (particle.focal ? 1.35 : 1), 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
  context.restore();
};

/** Decorative bounded canvas network driven only by existing renderer state. */
export const ParticleOrb = ({ state, label, responseText, responsePhase }: ParticleOrbProps) => {
  const canvasReference = useRef<HTMLCanvasElement>(null);
  const stateReference = useRef(state);
  const [isDocumentHidden, setIsDocumentHidden] = useState(() =>
    typeof document !== "undefined" && document.hidden
  );
  stateReference.current = state;

  useEffect(() => {
    const canvas = canvasReference.current;
    if (!canvas) return;
    try {
      const requestFrame = window.requestAnimationFrame?.bind(window);
      const cancelFrame = window.cancelAnimationFrame?.bind(window);
      if (!requestFrame || !cancelFrame || !canvas.getContext("2d")) return;
      const particles = createParticles();
      const previousTime = { value: performance.now() };
      const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      const loop = createParticleOrbLoop({
        canAnimate: () => particleOrbAllowsMotion(mediaQuery?.matches ?? true, document.hidden),
        draw: () => drawNeuralNetwork(canvas, particles, stateReference.current, previousTime),
        requestFrame,
        cancelFrame
      });
      const refresh = (): void => {
        loop.stop();
        loop.start();
      };
      const resizeObserver = window.ResizeObserver ? new window.ResizeObserver(refresh) : undefined;
      resizeObserver?.observe(canvas);
      const onResize = (): void => refresh();
      const onVisibilityChange = (): void => {
        setIsDocumentHidden(document.hidden);
        refresh();
      };
      window.addEventListener("resize", onResize);
      document.addEventListener("visibilitychange", onVisibilityChange);
      mediaQuery?.addEventListener?.("change", refresh);
      loop.start();
      return () => {
        loop.stop();
        resizeObserver?.disconnect();
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        mediaQuery?.removeEventListener?.("change", refresh);
      };
    } catch {
      // The static dot field remains available when optional visual APIs fail.
      return;
    }
  }, []);

  return (
    <div aria-hidden="true" className={`particle-orb particle-orb--${state}`} data-paused={isDocumentHidden || undefined} data-state={state}>
      <div className="particle-orb__fallback">
        {fallbackDots.map((style, index) => <i key={index} style={style} />)}
      </div>
      <canvas ref={canvasReference} />
      {responseText && <p className={`particle-orb__response${responsePhase ? ` particle-orb__response--${responsePhase.toLowerCase()}` : ""}`}>{responseText}</p>}
      <span className="particle-orb__label">{label}</span>
    </div>
  );
};
