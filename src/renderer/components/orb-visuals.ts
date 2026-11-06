/** The only colors of the interface: tropical monstera greens (green scheme) and deep agave blues (blue scheme). */
export const PALETTE = {
  abyss: "#003333",
  night: "#0F2A33",
  petrol: "#2C5E66",
  emerald: "#027C68",
  leaf: "#009933",
  sage: "#6FA6A0",
  mist: "#A5C8CC",
  lime: "#B0E892",
  mint: "#E9F4F0",
  navy: "#0A1F33",
  ocean: "#0F3D66",
  cobalt: "#1B5C94",
  azure: "#2F82C4",
  sky: "#6FB6E6"
} as const;

export type OrbState = "idle" | "recording" | "transcribing" | "interpreting" | "acting" | "speaking" | "error";
export type OrbOverlay = "confirm" | "reinforced" | "cancelled";
export type OrbVisualKey = "idle" | "listening" | "processing" | "speaking" | "confirm" | "danger" | "error" | "cancelled";

export type OrbVisual = {
  /** Four blob colors, base color and glow color. */
  colors: readonly [string, string, string, string];
  base: string;
  glow: string;
  /** Multiplier of the blob rotation and morph speed. */
  speed: number;
  /** State scale of the whole sphere. */
  scale: number;
  halo: number;
  core: number;
  /** Opacity of the swirl layer used while thinking. */
  flow: number;
  /** Where the amplitude comes from, if anywhere. */
  amplitude: "mic" | "speech" | "none";
};

const IDLE: OrbVisual = {
  colors: [PALETTE.emerald, PALETTE.sage, PALETTE.mist, PALETTE.lime],
  base: "#1E8C7E",
  glow: PALETTE.sage,
  speed: 1,
  scale: 1,
  halo: 0.5,
  core: 0.55,
  flow: 0,
  amplitude: "none"
};

/**
 * Per-state configuration (prototype table, new palette). Listening is more saturated and open, thinking
 * contracts and swirls, speaking is soft, reinforced confirmation is deeper, and error is desaturated.
 */
export const ORB_VISUALS: Readonly<Record<OrbVisualKey, OrbVisual>> = {
  idle: IDLE,
  listening: {
    colors: [PALETTE.leaf, PALETTE.lime, PALETTE.emerald, PALETTE.mist],
    base: "#0A9A6B",
    glow: PALETTE.lime,
    speed: 2.2,
    scale: 1.06,
    halo: 0.78,
    core: 0.85,
    flow: 0.3,
    amplitude: "mic"
  },
  processing: {
    colors: [PALETTE.petrol, PALETTE.emerald, PALETTE.sage, PALETTE.mist],
    base: "#1B6F73",
    glow: PALETTE.emerald,
    speed: 3.6,
    scale: 0.86,
    halo: 0.45,
    core: 0.9,
    flow: 0.75,
    amplitude: "none"
  },
  speaking: {
    colors: [PALETTE.lime, PALETTE.sage, PALETTE.emerald, PALETTE.mist],
    base: "#3AA38A",
    glow: PALETTE.lime,
    speed: 1.4,
    scale: 0.98,
    halo: 0.6,
    core: 0.7,
    flow: 0.1,
    amplitude: "speech"
  },
  confirm: { ...IDLE, speed: 0.8, halo: 0.45 },
  danger: {
    colors: [PALETTE.petrol, PALETTE.night, PALETTE.emerald, PALETTE.sage],
    base: "#1F5A60",
    glow: PALETTE.petrol,
    speed: 0.6,
    scale: 1,
    halo: 0.5,
    core: 0.5,
    flow: 0,
    amplitude: "none"
  },
  error: {
    colors: ["#9DB3B0", "#849C9A", "#BFD0CC", "#8FA6AB"],
    base: "#8AA09D",
    glow: "#8AA09D",
    speed: 0.3,
    scale: 0.88,
    halo: 0.16,
    core: 0.28,
    flow: 0,
    amplitude: "none"
  },
  cancelled: { ...IDLE, scale: 0.95, halo: 0.4 }
};

const BLUE_IDLE: OrbVisual = {
  ...IDLE,
  colors: [PALETTE.cobalt, PALETTE.ocean, PALETTE.azure, PALETTE.petrol],
  base: "#0C3355",
  glow: PALETTE.cobalt
};

/**
 * The deep blue scheme: same speed, scale, halo, core, flow and amplitude as the green table, only the colors
 * change. The orb reads as a sapphire sphere; sky appears as a single small accent at most, and the error
 * state is a desaturated blue-grey.
 */
export const ORB_VISUALS_BLUE: Readonly<Record<OrbVisualKey, OrbVisual>> = {
  idle: BLUE_IDLE,
  listening: { ...ORB_VISUALS.listening, colors: [PALETTE.azure, PALETTE.cobalt, PALETTE.sky, PALETTE.ocean], base: "#1B5C94", glow: PALETTE.azure },
  processing: { ...ORB_VISUALS.processing, colors: [PALETTE.navy, PALETTE.ocean, PALETTE.cobalt, PALETTE.petrol], base: "#0D2A47", glow: PALETTE.ocean },
  speaking: { ...ORB_VISUALS.speaking, colors: [PALETTE.cobalt, PALETTE.azure, PALETTE.ocean, PALETTE.sky], base: "#154B7A", glow: PALETTE.azure },
  confirm: { ...BLUE_IDLE, speed: 0.8, halo: 0.45 },
  danger: { ...ORB_VISUALS.danger, colors: [PALETTE.navy, PALETTE.ocean, PALETTE.petrol, PALETTE.cobalt], base: "#0B2A44", glow: PALETTE.ocean },
  error: { ...ORB_VISUALS.error, colors: ["#8DA2AD", "#7890A0", "#B4C5CE", "#8499A8"], base: "#8499A8", glow: "#8499A8" },
  cancelled: { ...BLUE_IDLE, scale: 0.95, halo: 0.4 }
};

/** Maps the existing semantic orb state, plus an optional overlay, to one visual configuration. */
export const visualKeyFor = (state: OrbState, overlay?: OrbOverlay): OrbVisualKey => {
  if (overlay === "reinforced") return "danger";
  if (overlay === "confirm") return "confirm";
  if (overlay === "cancelled" && (state === "idle" || state === "error")) return "cancelled";
  switch (state) {
    case "recording": return "listening";
    case "transcribing":
    case "interpreting":
    case "acting": return "processing";
    case "speaking": return "speaking";
    case "error": return "error";
    default: return "idle";
  }
};

/** One Spanish accessible name per orb state; it always says what activating the orb will do. */
export const orbAccessibleName = (state: OrbState, reviewOpen = false): string => {
  if (reviewOpen) return "Esperando tu confirmación";
  switch (state) {
    case "recording": return "Escuchando. Toca para cancelar";
    case "speaking": return "Hablando. Toca para detener";
    case "transcribing":
    case "interpreting": return "Procesando";
    case "acting": return "Actuando";
    case "error": return "Error. Toca para reintentar";
    default: return "Toca para hablar";
  }
};

/** Whether the orb animates at all. Hidden or minimized windows pause the visuals only. */
export const orbAllowsMotion = (reducedMotion: boolean, documentHidden: boolean): boolean =>
  !reducedMotion && !documentHidden;
