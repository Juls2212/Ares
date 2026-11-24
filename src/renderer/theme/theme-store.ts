import { THEMES, themeNameFromQuery, type ThemeName } from "./themes";

/**
 * The effective theme as a tiny external store, plus the list of painters that redraw a canvas immediately. The theme
 * is changed in one place (the transition controller), which sets this store, writes the CSS custom properties and then
 * asks every painter to redraw, all synchronously, so a view transition snapshot always contains the repainted canvases.
 */
export const readSystemTheme = (): ThemeName => {
  try {
    return themeNameFromQuery(window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  } catch {
    return "light";
  }
};

let current: ThemeName = readSystemTheme();
const listeners = new Set<() => void>();

export const themeStore = {
  get: (): ThemeName => current,
  getServerSnapshot: (): ThemeName => "light",
  set: (name: ThemeName): void => {
    if (!(name in THEMES) || name === current) return;
    current = name;
    for (const listener of [...listeners]) listener();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }
};

const painters = new Set<() => void>();

/** Registers a function that redraws one canvas right now with the store theme. */
export const registerThemePainter = (painter: () => void): (() => void) => {
  painters.add(painter);
  return () => { painters.delete(painter); };
};

/** Redraws every registered canvas synchronously. A painter that throws never stops the others. */
export const paintThemeNow = (): void => {
  for (const painter of [...painters]) {
    try { painter(); } catch { /* a failed repaint must not break the theme change */ }
  }
};
