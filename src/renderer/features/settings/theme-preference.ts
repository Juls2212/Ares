import { COLOR_SCHEMES, DEFAULT_SCHEME_ID, findScheme, migrateStoredScheme, type ColorScheme } from "./color-schemes";

export const THEME_STORAGE_KEY = "ares-theme-preference";

/** The id of a color scheme (the stored value is still under the original key). */
export type ThemePreference = string;

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

type ThemeRoot = Pick<Element, "setAttribute"> & { style?: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> };

export const DEFAULT_THEME_PREFERENCE: ThemePreference = DEFAULT_SCHEME_ID;

export const isThemePreference = (value: unknown, schemes: readonly ColorScheme[] = COLOR_SCHEMES): value is ThemePreference =>
  typeof value === "string" && schemes.some((scheme) => scheme.id === value);

export const getBrowserThemeStorage = (): ThemeStorage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** Old "light"/"dark" values become the green/blue schemes; unknown, missing or unreadable values are green. */
export const readThemePreference = (storage: ThemeStorage | undefined, schemes: readonly ColorScheme[] = COLOR_SCHEMES): ThemePreference => {
  try {
    return migrateStoredScheme(storage?.getItem(THEME_STORAGE_KEY), schemes);
  } catch {
    return schemes[0]!.id;
  }
};

let appliedTokens: string[] = [];

/** Sets the data-theme attribute and any inline tokens of the scheme, removing the previous scheme's tokens. */
export const applyThemePreference = (root: ThemeRoot, id: ThemePreference, schemes: readonly ColorScheme[] = COLOR_SCHEMES): void => {
  const scheme = findScheme(id, schemes);
  root.setAttribute("data-theme", scheme.id);
  for (const name of appliedTokens) root.style?.removeProperty(name);
  appliedTokens = [];
  for (const [name, value] of Object.entries(scheme.tokens ?? {})) {
    root.style?.setProperty(name, value);
    appliedTokens.push(name);
  }
};

export const initializeThemePreference = (
  root: ThemeRoot,
  storage: ThemeStorage | undefined,
  schemes: readonly ColorScheme[] = COLOR_SCHEMES
): ThemePreference => {
  const id = readThemePreference(storage, schemes);
  applyThemePreference(root, id, schemes);
  return id;
};

export const saveThemePreference = (
  root: ThemeRoot,
  storage: ThemeStorage | undefined,
  id: ThemePreference,
  schemes: readonly ColorScheme[] = COLOR_SCHEMES
): void => {
  applyThemePreference(root, id, schemes);
  try {
    storage?.setItem(THEME_STORAGE_KEY, findScheme(id, schemes).id);
  } catch {
    // Appearance remains usable when browser storage is unavailable.
  }
};
