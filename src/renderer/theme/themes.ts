/**
 * The two themes of Ares as plain data. The CSS custom properties and the canvas orb both read this one table, so a
 * color is never written twice. "dark" follows the dark Windows theme and "light" is the mint-gray theme.
 */
import { HEADER_BACKGROUND } from "../../shared/theme-colors";

export type Rgb = readonly [number, number, number];

export type OrbTheme = {
  accent: Rgb;
  accent2: Rgb;
  amber: Rgb;
  /** True draws the particles with additive blending ("lighter"); false uses plain source-over. */
  additive: boolean;
  hex: string;
  glowA: number;
  coreFill: string;
  rim: string;
  rimGlow: number;
  chunkBase: number;
  tickBase: number;
  memA: number;
  wireBase: number;
  partK: number;
  partSizeK: number;
};

export type Theme = {
  css: Readonly<Record<string, string>>;
  orb: OrbTheme;
  /** Solid window background for this theme; Main uses the same two values. */
  windowBackground: string;
};

export type ThemeName = "dark" | "light";

export const THEMES: Readonly<Record<ThemeName, Theme>> = {
  dark: {
    windowBackground: "#02090b",
    css: {
      bgc: "#07272b", bgm: "#041a1e", bge: "#02090b", hbg: HEADER_BACKGROUND.dark, line: "#0f3a40", line2: "#12484e",
      text: "#bff3ee", dim: "#6fa39f", accent: "#35e0d0", "accent-strong": "#35e0d0", "on-accent": "#02090b", accent2: "#1f9ed8", amber: "#f2b34a",
      plate: "linear-gradient(#031317,#02090b)", micbg: "radial-gradient(circle,#0a3a40,#031317)",
      micglow: "0 0 24px #35e0d055", brandglow: "0 0 14px #35e0d066",
      "toggle-fill": "rgba(53,224,208,.06)", "toggle-fill-hover": "rgba(53,224,208,.16)", "toggle-glass-on": "rgba(53,224,208,.28)",
      "label-error": "#f2b34a", "label-clarify": "#1f9ed8"
    },
    orb: {
      accent: [53, 224, 208], accent2: [31, 158, 216], amber: [242, 179, 74], additive: true,
      hex: "rgba(53,224,208,0.07)", glowA: 0.2, coreFill: "rgba(5,28,32,.92)", rim: "rgba(235,255,252,.92)", rimGlow: 0.9,
      chunkBase: 0.12, tickBase: 0.18, memA: 0.22, wireBase: 0.12, partK: 1, partSizeK: 1
    }
  },
  light: {
    windowBackground: "#d4e4df",
    css: {
      bgc: "#eaf2ef", bgm: "#d4e4df", bge: "#b9d0ca", hbg: HEADER_BACKGROUND.light, line: "#a3bfb8", line2: "#93b3ab",
      // dim is a hair darker than the prototype (#3f6560) and accent-strong is the accent darkened, both to pass WCAG on the mint-gray surfaces.
      text: "#0b2b27", dim: "#395c57", accent: "#0b8a7f", "accent-strong": "#086159", "on-accent": "#eaf2ef", accent2: "#17679c", amber: "#a35f00",
      plate: "linear-gradient(#dcebe7,#c3d9d3)", micbg: "radial-gradient(circle,#f3faf8,#d2e5e0)",
      micglow: "0 4px 16px #0b8a7f33", brandglow: "none",
      "toggle-fill": "rgba(11,138,127,.08)", "toggle-fill-hover": "rgba(11,138,127,.20)", "toggle-glass-on": "rgba(11,138,127,.30)",
      "label-error": "#7a4600", "label-clarify": "#124f78"
    },
    orb: {
      accent: [11, 138, 127], accent2: [23, 103, 156], amber: [163, 95, 0], additive: false,
      hex: "rgba(11,138,127,0.12)", glowA: 0.18, coreFill: "rgba(248,253,251,.80)", rim: "#0a4a44", rimGlow: 0.35,
      chunkBase: 0.2, tickBase: 0.26, memA: 0.38, wireBase: 0.22, partK: 1.25, partSizeK: 1.25
    }
  }
};

export const FONT_STACK = '"Bahnschrift", "Segoe UI", system-ui, sans-serif';

/** The CSS custom properties of a theme, as `--name` to value. */
export const cssVariablesFor = (name: ThemeName): Record<string, string> =>
  Object.fromEntries(Object.entries(THEMES[name].css).map(([key, value]) => [`--${key}`, value]));

type StyleTarget = { style: Pick<CSSStyleDeclaration, "setProperty">; setAttribute: (name: string, value: string) => void };

export const applyThemeToElement = (element: StyleTarget, name: ThemeName): void => {
  for (const [key, value] of Object.entries(cssVariablesFor(name))) element.style.setProperty(key, value);
  element.setAttribute("data-theme", name);
};

export const themeNameFromQuery = (prefersDark: boolean): ThemeName => (prefersDark ? "dark" : "light");
