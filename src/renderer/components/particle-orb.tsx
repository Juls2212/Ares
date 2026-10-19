import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";

export type ParticleOrbState = "idle" | "recording" | "transcribing" | "interpreting" | "acting" | "speaking" | "error";

type CoreParticle = {
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
  voiceLevel?: number;
  responseText?: string;
  responsePhase?: "REVEALING" | "COMPLETED" | "FADING";
  onActivate?: () => void;
  accessibleLabel?: string;
  disabled?: boolean;
  controlRef?: RefObject<HTMLButtonElement | null>;
};

type DotStyle = CSSProperties & Record<"--dot-x" | "--dot-y" | "--dot-size" | "--dot-opacity", string>;
type VoiceReactiveStyle = CSSProperties & Record<
  "--voice-level" | "--voice-nucleus-scale" | "--voice-halo-scale" | "--voice-link-opacity" | "--voice-ripple-scale",
  string
>;

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

export const clampVoiceLevel = (level: number): number =>
  Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;

export const voiceReactiveStyleFor = (
  state: ParticleOrbState,
  level: number,
  reducedMotion = false
): VoiceReactiveStyle => {
  const activeLevel = state === "recording" && !reducedMotion ? clampVoiceLevel(level) : 0;
  return {
    "--voice-level": activeLevel.toFixed(3),
    "--voice-nucleus-scale": (1 + activeLevel * 0.16).toFixed(3),
    "--voice-halo-scale": (1.08 + activeLevel * 0.2).toFixed(3),
    "--voice-link-opacity": (0.72 + activeLevel * 0.26).toFixed(3),
    "--voice-ripple-scale": (1 + activeLevel * 0.16).toFixed(3)
  };
};

export const PARTICLE_CORE_DENSITY = 32;
export const PARTICLE_CONNECTION_LIMIT = 28;

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

const createParticles = (): CoreParticle[] => Array.from({ length: PARTICLE_CORE_DENSITY }, (_, index) => {
  const angle = (index / PARTICLE_CORE_DENSITY) * Math.PI * 2 + Math.sin(index * 1.9) * 0.2;
  const distance = 0.06 + Math.sqrt((index + 1) / PARTICLE_CORE_DENSITY) * 0.58;
  const direction = angle + (index % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
  const focal = index === 2 || index === 11 || index === 22;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    velocityX: Math.cos(direction) * (0.012 + (index % 4) * 0.003),
    velocityY: Math.sin(direction) * (0.012 + (index % 4) * 0.003),
    size: focal ? 2.35 : 1 + (index % 4) * 0.28,
    opacity: focal ? 0.96 : 0.43 + (index % 5) * 0.08,
    focal
  };
});

const fallbackDots: DotStyle[] = Array.from({ length: PARTICLE_CORE_DENSITY }, (_, index) => {
  const angle = index * 2.399963229728653;
  const radius = 8 + Math.sqrt((index + 0.5) / PARTICLE_CORE_DENSITY) * 29;
  return {
    "--dot-x": `${50 + Math.cos(angle) * radius}%`,
    "--dot-y": `${50 + Math.sin(angle) * radius}%`,
    "--dot-size": `${1 + (index % 4) * 0.28}px`,
    "--dot-opacity": `${0.42 + (index % 5) * 0.08}`
  };
});

const motionSpeedFor = (state: ParticleOrbState, voiceLevel: number): number => {
  switch (state) {
    case "recording": return 0.78 + voiceLevel * 1.75;
    case "transcribing": return 0.9;
    case "interpreting": return 1.05;
    case "acting": return 1.28;
    case "speaking": return 1.12;
    case "error": return 0.15;
    default: return 0.42;
  }
};

const updateParticles = (particles: CoreParticle[], elapsedSeconds: number, state: ParticleOrbState, voiceLevel: number): void => {
  const speed = motionSpeedFor(state, voiceLevel);
  const convergence = state === "transcribing" || state === "interpreting" ? 0.024 : 0;
  for (const particle of particles) {
    particle.x += particle.velocityX * elapsedSeconds * speed;
    particle.y += particle.velocityY * elapsedSeconds * speed;
    if (convergence) {
      particle.velocityX -= particle.x * convergence * elapsedSeconds;
      particle.velocityY -= particle.y * convergence * elapsedSeconds;
    }
    const distance = Math.hypot(particle.x, particle.y);
    if (distance <= 0.72) continue;
    const normalX = particle.x / distance;
    const normalY = particle.y / distance;
    particle.x = normalX * 0.72;
    particle.y = normalY * 0.72;
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

const drawIntelligentCore = (
  canvas: HTMLCanvasElement,
  particles: CoreParticle[],
  state: ParticleOrbState,
  voiceLevel: number,
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
  const activeVoiceLevel = state === "recording" ? clampVoiceLevel(voiceLevel) : 0;
  updateParticles(particles, elapsedSeconds, state, activeVoiceLevel);

  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;
  const radius = Math.min(bounds.width, bounds.height) * 0.39;
  const primaryBlue = getColor(canvas, "--neural-primary-rgb", "22 66 116");
  const focalBlue = getColor(canvas, "--neural-focal-rgb", "48 112 190");
  const voiceDispersion = 1 + activeVoiceLevel * 0.12;
  const positions = particles.map((particle) => ({
    ...particle,
    x: centerX + particle.x * radius * voiceDispersion,
    y: centerY + particle.y * radius * voiceDispersion
  }));

  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.clip();

  const nucleus = context.createRadialGradient(centerX, centerY, 1, centerX, centerY, radius * 0.74);
  nucleus.addColorStop(0, `rgb(${focalBlue} / ${0.42 + activeVoiceLevel * 0.18})`);
  nucleus.addColorStop(0.36, `rgb(${primaryBlue} / ${0.2 + activeVoiceLevel * 0.1})`);
  nucleus.addColorStop(0.7, `rgb(${primaryBlue} / 0.08)`);
  nucleus.addColorStop(1, `rgb(${primaryBlue} / 0)`);
  context.fillStyle = nucleus;
  context.beginPath();
  context.arc(centerX, centerY, radius * 0.76, 0, Math.PI * 2);
  context.fill();

  let connections = 0;
  const maximumConnectionDistance = radius * 0.42;
  for (let startIndex = 0; startIndex < positions.length && connections < PARTICLE_CONNECTION_LIMIT; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < positions.length && connections < PARTICLE_CONNECTION_LIMIT; endIndex += 1) {
      const start = positions[startIndex];
      const end = positions[endIndex];
      const distance = Math.hypot(start.x - end.x, start.y - end.y);
      if (distance > maximumConnectionDistance) continue;
      context.strokeStyle = `rgb(${primaryBlue} / ${0.1 + (1 - distance / maximumConnectionDistance) * 0.24 + activeVoiceLevel * 0.16})`;
      context.lineWidth = 0.65;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      connections += 1;
    }
  }

  for (const particle of positions) {
    context.fillStyle = `rgb(${particle.focal ? focalBlue : primaryBlue} / ${Math.min(1, particle.opacity + activeVoiceLevel * 0.16)})`;
    context.shadowBlur = particle.focal ? 10 + activeVoiceLevel * 5 : 2 + activeVoiceLevel * 2;
    context.shadowColor = `rgb(${focalBlue} / ${particle.focal ? 0.55 : 0.2})`;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size * (1 + activeVoiceLevel * 0.42), 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
  context.restore();
};

/** Decorative bounded canvas core driven only by existing renderer state and transient local voice level. */
export const ParticleOrb = ({ state, label, voiceLevel = 0, responseText, responsePhase, onActivate, accessibleLabel = "Hablar con Ares", disabled, controlRef }: ParticleOrbProps) => {
  const canvasReference = useRef<HTMLCanvasElement>(null);
  const stateReference = useRef(state);
  const voiceLevelReference = useRef(0);
  const [isDocumentHidden, setIsDocumentHidden] = useState(() =>
    typeof document !== "undefined" && document.hidden
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  stateReference.current = state;
  voiceLevelReference.current = state === "recording" && !prefersReducedMotion ? clampVoiceLevel(voiceLevel) : 0;

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
      setPrefersReducedMotion(mediaQuery?.matches ?? false);
      const loop = createParticleOrbLoop({
        canAnimate: () => particleOrbAllowsMotion(mediaQuery?.matches ?? true, document.hidden),
        draw: () => drawIntelligentCore(canvas, particles, stateReference.current, voiceLevelReference.current, previousTime),
        requestFrame,
        cancelFrame
      });
      const refresh = (): void => {
        setPrefersReducedMotion(mediaQuery?.matches ?? false);
        loop.stop();
        loop.start();
      };
      const resizeObserver = window.ResizeObserver ? new window.ResizeObserver(refresh) : undefined;
      resizeObserver?.observe(canvas);
      const themeObserver = window.MutationObserver ? new window.MutationObserver(refresh) : undefined;
      themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
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
        themeObserver?.disconnect();
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        mediaQuery?.removeEventListener?.("change", refresh);
      };
    } catch {
      // The static dot field remains available when optional visual APIs fail.
      return;
    }
  }, []);

  const reactiveStyle = voiceReactiveStyleFor(state, voiceLevel, prefersReducedMotion);
  const activeVoiceLevel = state === "recording" && !prefersReducedMotion ? clampVoiceLevel(voiceLevel) : 0;

  return (
    <button
      type="button"
      aria-label={accessibleLabel}
      aria-busy={state === "transcribing" || state === "interpreting" || state === "acting"}
      disabled={disabled}
      onClick={onActivate}
      ref={controlRef}
      className={`particle-orb particle-orb--${state}`}
      data-paused={isDocumentHidden || undefined}
      data-state={state}
      data-voice-level={activeVoiceLevel.toFixed(3)}
      style={reactiveStyle}
    >
      <span aria-hidden="true" className="particle-orb__halo" />
      <span aria-hidden="true" className="particle-orb__nucleus" />
      <span aria-hidden="true" className="particle-orb__ripple" />
      <span aria-hidden="true" className="particle-orb__fallback">
        {fallbackDots.map((style, index) => <i key={index} style={style} />)}
      </span>
      <canvas aria-hidden="true" ref={canvasReference} />
      {responseText && <span aria-hidden="true" className={`particle-orb__response${responsePhase ? ` particle-orb__response--${responsePhase.toLowerCase()}` : ""}`}>{responseText}</span>}
      {label && <span aria-hidden="true" className="particle-orb__label">{label}</span>}
    </button>
  );
};
