/**
 * Canvas 2D orb, ported from the approved HUD prototype (v2). Everything here is pure: drawing receives a context and
 * explicit parameters, and the only randomness is a seeded generator used once to build the particles. All math is in
 * normalized units (a 440 x 440 design box) scaled by size / 440, so the orb looks the same at any window size.
 */
import type { OrbTheme, Rgb } from "../theme/themes";

export const TAU = Math.PI * 2;
export const DESIGN_SIZE = 440;
export const SEGMENTS = 56;
export const TICKS = 112;
export const PARTICLE_COUNT = 520;
export const PARTICLE_SEED = 1337;

export type OrbVisualState = "idle" | "listening" | "thinking" | "speaking" | "error";
export const ORB_VISUAL_STATES: readonly OrbVisualState[] = ["idle", "listening", "thinking", "speaking", "error"];

export type Particle = { a: number; r: number; s: number; p: number; z: number };

/** The same linear congruential generator as the prototype, seeded, so the particle field is identical every time. */
export const createParticles = (count = PARTICLE_COUNT, seed = PARTICLE_SEED): Particle[] => {
  let value = seed >>> 0;
  const random = (): number => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  return Array.from({ length: count }, () => ({ a: random() * TAU, r: random(), s: (random() * 0.6 + 0.2) * (random() < 0.5 ? -1 : 1), p: random() * TAU, z: random() }));
};

/** State that carries over between frames (smoothing). It belongs to one orb; nothing is global. */
export type OrbMotion = { level: number; spin: number; amber: number; time: number; segments: Float32Array };

export const createOrbMotion = (): OrbMotion => ({ level: 0, spin: 1, amber: 0, time: 0, segments: new Float32Array(SEGMENTS) });

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
/** Blends two colors. With `out` it writes into that array instead of allocating one (used inside the per-frame loops). */
const mix = (a: Rgb, b: Rgb, t: number, out: number[] = [0, 0, 0]): Rgb => {
  for (let index = 0; index < 3; index += 1) out[index] = Math.round(a[index]! + (b[index]! - a[index]!) * t);
  return out as unknown as Rgb;
};
const rgba = (color: Rgb, alpha: number): string => `rgba(${color[0]},${color[1]},${color[2]},${Number.isFinite(alpha) ? Math.max(0, alpha) : 0})`;
const wobbleOf = (angle: number, time: number): number => Math.sin(angle * 3 + time * 0.8) + 0.6 * Math.sin(angle * 5 - time * 1.1) + 0.4 * Math.sin(angle * 2 + time * 0.5);

/** The state-driven envelope used when no real level is available, so the orb never looks dead. */
export const simulatedLevel = (state: OrbVisualState, time: number): number => {
  switch (state) {
    case "listening": return Math.min(1, 0.28 + 0.5 * Math.abs(Math.sin(time * 7) * Math.sin(time * 2.9)) + 0.12 * Math.sin(time * 23));
    case "speaking": return Math.min(1, 0.15 + 0.7 * Math.abs(Math.sin(time * 9) * Math.sin(time * 2.3)));
    case "thinking": return 0.18;
    case "error": return 0.22;
    default: return 0.05 + 0.03 * Math.sin(time * 0.9);
  }
};

/** How fast the whole orb turns in each state. */
export const spinTargetFor = (state: OrbVisualState): number =>
  state === "thinking" ? 3.2 : state === "listening" ? 1.1 : state === "speaking" ? 1.5 : 0.35;

/** Smooths the level, spin and amber blend toward their targets (the prototype's exponential easing). */
export const stepOrbMotion = (motion: OrbMotion, input: { dt: number; time: number; state: OrbVisualState; targetLevel: number; reducedMotion: boolean }): void => {
  const dt = Number.isFinite(input.dt) ? Math.min(0.05, Math.max(0, input.dt)) : 0;
  motion.time = Number.isFinite(input.time) ? input.time : motion.time;
  // Reduced motion keeps the value changes smooth but slow: nothing jumps and nothing moves on its own.
  const rate = input.reducedMotion ? 3 : 9;
  motion.level += (clamp01(input.targetLevel) - motion.level) * Math.min(1, dt * rate);
  motion.spin += ((input.reducedMotion ? 0 : spinTargetFor(input.state)) - motion.spin) * Math.min(1, dt * 3);
  motion.amber += ((input.state === "error" ? 1 : 0) - motion.amber) * Math.min(1, dt * 6);
};

export type OrbFrameParams = {
  /** Side of the square canvas in CSS pixels. */
  size: number;
  /** Seconds since start. Frozen by the caller (or ignored here) under reduced motion. */
  time: number;
  dt: number;
  state: OrbVisualState;
  /** The target level, 0..1, from the analyser or from simulatedLevel. */
  level: number;
  theme: OrbTheme;
  particles: readonly Particle[];
  /** How many of the particles to draw (adaptive budget). Defaults to all of them. */
  particleCount?: number;
  reducedMotion: boolean;
  motion: OrbMotion;
  /** A short glow and size bump of the sphere, 0..1, used while the theme changes. Ignored under reduced motion. */
  pulse?: number;
  /** Low-cost drawing: no shadow blur on the rim (the most expensive effect). Everything else is drawn as usual. */
  cheap?: boolean;
};

export const drawOrbFrame = (ctx: CanvasRenderingContext2D, params: OrbFrameParams): void => {
  const { theme, state, reducedMotion, motion } = params;
  const size = Number.isFinite(params.size) && params.size > 0 ? params.size : DESIGN_SIZE;
  stepOrbMotion(motion, { dt: params.dt, time: params.time, state, targetLevel: params.level, reducedMotion });
  const W = DESIGN_SIZE;
  const CX = W / 2;
  const CY = W / 2;
  const t = reducedMotion ? 0 : motion.time;
  const level = motion.level;
  const pulse = reducedMotion ? 0 : clamp01(params.pulse ?? 0);
  const spin = motion.spin;
  const dt = Math.min(0.05, Math.max(0, Number.isFinite(params.dt) ? params.dt : 0));
  const accent = mix(theme.accent, theme.amber, motion.amber);
  const accent2 = mix(theme.accent2, theme.amber, motion.amber);
  const wobble = (angle: number, time: number): number => (reducedMotion ? 0 : wobbleOf(angle, time));

  ctx.save();
  ctx.scale(size / DESIGN_SIZE, size / DESIGN_SIZE);
  ctx.clearRect(0, 0, W, W);

  // Layer 1: glow.
  const glow = ctx.createRadialGradient(CX, CY, 10, CX, CY, 200);
  glow.addColorStop(0, rgba(accent, theme.glowA + level * 0.18 + pulse * 0.3));
  glow.addColorStop(0.55, rgba(accent2, 0.06));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, W);

  // Layer 2: the 56 chunky ring segments.
  for (let i = 0; i < SEGMENTS; i += 1) {
    const a = (i / SEGMENTS) * TAU;
    let v: number;
    if (reducedMotion) {
      v = state === "idle" ? 0.2 : state === "error" ? 0.5 : state === "thinking" ? 0.45 : 0.15 + level * 0.7;
    } else if (state === "thinking") {
      const head = (t * 1.7) % TAU;
      let d = (head - a) % TAU;
      if (d < 0) d += TAU;
      v = Math.max(0, 1 - d / 1.7) * 0.92 + 0.12;
    } else if (state === "listening") v = level * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(i * 1.7 + t * 9) * Math.sin(i * 0.6 - t * 5)));
    else if (state === "speaking") v = level * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(i * 0.55 - t * 6))) + 0.05;
    else if (state === "error") v = 0.35 + 0.35 * Math.sin(t * 6) * Math.sin(t * 6);
    else v = 0.2 + 0.09 * Math.sin(t * 0.8 + i * 0.35);
    motion.segments[i]! += (v - motion.segments[i]!) * Math.min(1, dt * (reducedMotion ? 5 : 14));
  }
  ctx.lineCap = "butt";
  const segmentColor = [0, 0, 0];
  const arcWidth = (TAU / SEGMENTS) * 0.72;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const a = (i / SEGMENTS) * TAU - Math.PI / 2 + t * 0.05 * spin;
    const v = clamp01(motion.segments[i]!);
    ctx.beginPath();
    ctx.arc(CX, CY, 96, a - arcWidth / 2, a + arcWidth / 2);
    ctx.lineWidth = 16;
    ctx.strokeStyle = rgba(mix(accent2, accent, v, segmentColor), theme.chunkBase + v * (1 - theme.chunkBase));
    ctx.stroke();
  }

  // Layer 3: the thin inner ring.
  ctx.beginPath();
  ctx.arc(CX, CY, 82, 0, TAU);
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(accent, theme.additive ? 0.35 : 0.5);
  ctx.stroke();

  // Layer 4: 112 radial ticks.
  ctx.lineWidth = 2;
  for (let i = 0; i < TICKS; i += 1) {
    const f = (i / TICKS) * SEGMENTS;
    const i0 = Math.floor(f) % SEGMENTS;
    const i1 = (i0 + 1) % SEGMENTS;
    const v = motion.segments[i0]! * 0.6 + motion.segments[i1]! * 0.4;
    const a = (i / TICKS) * TAU - Math.PI / 2 + t * 0.05 * spin;
    const r1 = 112;
    const r2 = r1 + 3 + v * 24;
    ctx.beginPath();
    ctx.moveTo(CX + Math.cos(a) * r1, CY + Math.sin(a) * r1);
    ctx.lineTo(CX + Math.cos(a) * r2, CY + Math.sin(a) * r2);
    ctx.strokeStyle = rgba(accent, theme.tickBase + v * 0.7);
    ctx.stroke();
  }

  // Layer 5: two wobbling membrane curves.
  for (let k = 0; k < 2; k += 1) {
    ctx.beginPath();
    for (let i = 0; i <= 180; i += 1) {
      const a = (i / 180) * TAU;
      const r = 150 + k * 9 + wobble(a + k * 0.7, t * (1 + k * 0.3)) * (4 + level * 16);
      const x = CX + Math.cos(a) * r;
      const y = CY + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(accent, theme.memA - k * 0.1);
    ctx.stroke();
  }

  // Layer 6: the particles (additive in the dark theme, plain in the light one).
  if (theme.additive) ctx.globalCompositeOperation = "lighter";
  const count = Math.max(0, Math.min(params.particles.length, Math.floor(params.particleCount ?? params.particles.length)));
  for (let i = 0; i < count; i += 1) {
    const p = params.particles[i]!;
    const a = p.a + (reducedMotion ? 0 : t * 0.06 * p.s * spin);
    const r = 152 + p.r * 18 + wobble(a, t) * (4 + level * 18) + (reducedMotion ? 0 : Math.sin(t * 1.3 + p.p) * 2);
    const x = CX + Math.cos(a) * r;
    const y = CY + Math.sin(a) * r;
    const alpha = (0.18 + 0.6 * p.z) * (0.6 + level * 0.7) * theme.partK;
    ctx.fillStyle = rgba(i % 7 === 0 ? accent : accent2, Math.min(0.95, alpha));
    const s = (p.z > 0.85 ? 2 : 1.2) * theme.partSizeK;
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalCompositeOperation = "source-over";

  // Layer 7: the wireframe sphere with depth fade, tilt and rotation.
  const R = 58 * (1 + level * 0.06 + pulse * 0.08);
  const tilt = 0.38;
  const ry = t * 0.28 * spin;
  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, TAU);
  ctx.fillStyle = theme.coreFill;
  ctx.fill();
  ctx.clip();
  // Two scratch points, reused for all 624 wireframe segments of the frame instead of allocating an array per point.
  const bufferA: [number, number, number] = [0, 0, 0];
  const bufferB: [number, number, number] = [0, 0, 0];
  const tiltCos = Math.cos(tilt);
  const tiltSin = Math.sin(tilt);
  const projectInto = (out: [number, number, number], lat: number, lon: number): [number, number, number] => {
    const x = R * Math.cos(lat) * Math.cos(lon);
    const y = R * Math.sin(lat);
    const z = R * Math.cos(lat) * Math.sin(lon);
    out[0] = x;
    out[1] = y * tiltCos - z * tiltSin;
    out[2] = y * tiltSin + z * tiltCos;
    return out;
  };
  for (let lat = -60; lat <= 60; lat += 30) {
    const L = (lat * Math.PI) / 180;
    for (let i = 0; i < 48; i += 1) {
      const p0 = projectInto(bufferA, L, (i / 48) * TAU + ry);
      const p1 = projectInto(bufferB, L, ((i + 1) / 48) * TAU + ry);
      const depth = (p0[2] + R) / (2 * R);
      ctx.beginPath();
      ctx.moveTo(CX + p0[0], CY + p0[1]);
      ctx.lineTo(CX + p1[0], CY + p1[1]);
      ctx.strokeStyle = rgba(accent, theme.wireBase + depth * 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  for (let m = 0; m < 12; m += 1) {
    const lon = (m / 12) * TAU + ry;
    for (let i = 0; i < 32; i += 1) {
      const p0 = projectInto(bufferA, -Math.PI / 2 + (i / 32) * Math.PI, lon);
      const p1 = projectInto(bufferB, -Math.PI / 2 + ((i + 1) / 32) * Math.PI, lon);
      const depth = (p0[2] + R) / (2 * R);
      ctx.beginPath();
      ctx.moveTo(CX + p0[0], CY + p0[1]);
      ctx.lineTo(CX + p1[0], CY + p1[1]);
      ctx.strokeStyle = rgba(accent, theme.wireBase - 0.02 + depth * 0.62);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();

  // Layer 8: the bright rim with its glow.
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.rim;
  if (params.cheap) {
    ctx.stroke();
  } else {
    ctx.shadowColor = rgba(accent, theme.rimGlow);
    ctx.shadowBlur = (theme.additive ? 14 : 8) + level * (theme.additive ? 16 : 8) + pulse * 20;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
};

/** The hex-grid background, drawn once per resize or theme change on its own canvas. */
export const drawHexGrid = (ctx: CanvasRenderingContext2D, width: number, height: number, color: string): void => {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const r = 22;
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  for (let row = -1; row < height / dy + 1; row += 1) {
    for (let col = -1; col < width / dx + 1; col += 1) {
      const x = col * dx + (row % 2 ? dx / 2 : 0);
      const y = row * dy;
      ctx.beginPath();
      for (let k = 0; k < 6; k += 1) {
        const a = (TAU / 6) * k + TAU / 12;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
};
