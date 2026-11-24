/**
 * Window colors and title bar options for the two themes. Main decides them from facts it already has (the Electron
 * version, the platform and whether the system uses dark colors); the renderer only follows prefers-color-scheme.
 * No Acrylic, transparency or vibrancy is used: the window has a solid background that matches the active theme.
 */

import { HEADER_BACKGROUND } from "../shared/theme-colors";

/** One switch for the custom title bar. Set to false to return to the native frame; nothing else needs to change. */
export const USE_CUSTOM_TITLE_BAR = true;

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);

export const WINDOW_THEME_COLORS = {
  dark: { background: "#02090b", overlaySymbol: "#bff3ee" },
  light: { background: "#d4e4df", overlaySymbol: "#0b2b27" }
} as const;

/** Height of the renderer header; the overlay buttons are drawn at the same height. */
export const TITLE_BAR_OVERLAY_HEIGHT = 54;

/** titleBarOverlay and setTitleBarOverlay exist from this Electron major version on (Windows). */
export const TITLE_BAR_OVERLAY_MINIMUM_ELECTRON_MAJOR = 21;

export const supportsTitleBarOverlay = (platform: NodeJS.Platform, electronVersion: string | undefined): boolean => {
  if (platform !== "win32") return false;
  const major = Number(/^(\d+)\./u.exec(electronVersion ?? "")?.[1]);
  return Number.isFinite(major) && major >= TITLE_BAR_OVERLAY_MINIMUM_ELECTRON_MAJOR;
};

export type TitleBarOverlay = { color: string; symbolColor: string; height: number };

/** The overlay color is the header background of the renderer, so the buttons area and the header look like one bar. */
export const getTitleBarOverlay = (dark: boolean): TitleBarOverlay => {
  const colors = dark ? WINDOW_THEME_COLORS.dark : WINDOW_THEME_COLORS.light;
  return { color: dark ? HEADER_BACKGROUND.dark : HEADER_BACKGROUND.light, symbolColor: colors.overlaySymbol, height: TITLE_BAR_OVERLAY_HEIGHT };
};

export type WindowChromeInput = {
  platform: NodeJS.Platform;
  electronVersion: string | undefined;
  shouldUseDarkColors: boolean;
  useCustomTitleBar?: boolean;
};

export type WindowChrome = {
  backgroundColor: string;
  customTitleBar: boolean;
  /** Only the options that concern color and frame; size and web preferences stay in main.ts. */
  options: { backgroundColor: string; titleBarStyle?: "hidden"; titleBarOverlay?: TitleBarOverlay };
};

export const getWindowChrome = (input: WindowChromeInput): WindowChrome => {
  const backgroundColor = (input.shouldUseDarkColors ? WINDOW_THEME_COLORS.dark : WINDOW_THEME_COLORS.light).background;
  const customTitleBar = (input.useCustomTitleBar ?? USE_CUSTOM_TITLE_BAR) && supportsTitleBarOverlay(input.platform, input.electronVersion);
  return customTitleBar
    ? { backgroundColor, customTitleBar, options: { backgroundColor, titleBarStyle: "hidden", titleBarOverlay: getTitleBarOverlay(input.shouldUseDarkColors) } }
    : { backgroundColor, customTitleBar, options: { backgroundColor } };
};
