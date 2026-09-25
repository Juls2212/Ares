export const THEME_STORAGE_KEY = "ares-theme-preference";

export type ThemePreference = "light" | "dark";

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

type ThemeRoot = Pick<Element, "setAttribute">;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "light" || value === "dark";

export const getBrowserThemeStorage = (): ThemeStorage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const readThemePreference = (storage: ThemeStorage | undefined): ThemePreference => {
  try {
    const storedTheme = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedTheme) ? storedTheme : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
};

export const applyThemePreference = (root: ThemeRoot, theme: ThemePreference): void => {
  root.setAttribute("data-theme", theme);
};

export const initializeThemePreference = (
  root: ThemeRoot,
  storage: ThemeStorage | undefined
): ThemePreference => {
  const theme = readThemePreference(storage);
  applyThemePreference(root, theme);
  return theme;
};

export const saveThemePreference = (
  root: ThemeRoot,
  storage: ThemeStorage | undefined,
  theme: ThemePreference
): void => {
  applyThemePreference(root, theme);
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Appearance remains usable when browser storage is unavailable.
  }
};
