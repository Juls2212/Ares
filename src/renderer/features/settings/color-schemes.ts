import { ORB_VISUALS, ORB_VISUALS_BLUE, type OrbVisual, type OrbVisualKey } from "../../components/orb-visuals";

export type OrbVisualTable = Readonly<Record<OrbVisualKey, OrbVisual>>;

/**
 * A color scheme is data: its orb palette table, a swatch color for the switch button, the CSS `color-scheme`
 * mode, and optional token overrides applied on the root. The built-in schemes get their surface tokens from the
 * stylesheet through `data-theme`; a new scheme can supply every token here instead.
 */
export type ColorScheme = {
  id: string;
  /** Spanish name shown to the user. */
  label: string;
  /** Swatch color shown on the button while this scheme is the next one. */
  accent: string;
  mode: "light" | "dark";
  orb: OrbVisualTable;
  tokens?: Readonly<Record<string, string>>;
};

export const COLOR_SCHEMES: readonly ColorScheme[] = [
  { id: "green", label: "Verde", accent: "#027C68", mode: "light", orb: ORB_VISUALS },
  { id: "blue", label: "Azul", accent: "#2F82C4", mode: "dark", orb: ORB_VISUALS_BLUE }
];

export const DEFAULT_SCHEME_ID = COLOR_SCHEMES[0]!.id;

/** The scheme for an id; an unknown id falls back to the first (default) scheme. */
export const findScheme = (id: string | null | undefined, schemes: readonly ColorScheme[] = COLOR_SCHEMES): ColorScheme =>
  schemes.find((scheme) => scheme.id === id) ?? schemes[0]!;

/** The scheme after the given one, in list order, wrapping around. */
export const nextScheme = (id: string, schemes: readonly ColorScheme[] = COLOR_SCHEMES): ColorScheme => {
  const index = schemes.findIndex((scheme) => scheme.id === id);
  return schemes[(index + 1) % schemes.length]!;
};

/** Reads a stored value: the old "light"/"dark" values map to the first two schemes; anything unknown is the default. */
export const migrateStoredScheme = (value: unknown, schemes: readonly ColorScheme[] = COLOR_SCHEMES): string => {
  if (value === "light") return schemes[0]!.id;
  if (value === "dark") return (schemes[1] ?? schemes[0]!).id;
  return typeof value === "string" && schemes.some((scheme) => scheme.id === value) ? value : schemes[0]!.id;
};

export const orbVisualsFor = (id: string | undefined, schemes: readonly ColorScheme[] = COLOR_SCHEMES): OrbVisualTable =>
  findScheme(id, schemes).orb;

/** Spanish text announced after a change, for example «Color azul». */
export const colorChangeAnnouncement = (scheme: ColorScheme): string => `Color ${scheme.label.toLowerCase()}`;

/** Tooltip for the switch button, for example «Color: Verde. Toca para cambiar a Azul.». */
export const colorButtonTitle = (current: ColorScheme, next: ColorScheme): string =>
  `Color: ${current.label}. Toca para cambiar a ${next.label}.`;
