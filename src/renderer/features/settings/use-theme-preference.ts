import { useCallback, useState } from "react";

import { findScheme, nextScheme, type ColorScheme } from "./color-schemes";
import {
  getBrowserThemeStorage,
  initializeThemePreference,
  saveThemePreference,
  type ThemePreference
} from "./theme-preference";

const getThemeRoot = (): HTMLElement | undefined =>
  typeof document === "undefined" ? undefined : document.documentElement;

const getInitialTheme = (): ThemePreference => {
  const root = getThemeRoot();
  if (!root) return findScheme(undefined).id;
  return initializeThemePreference(root, getBrowserThemeStorage());
};

/** The active color scheme and a function that moves to the next one in the list, persisting the choice. */
export const useThemePreference = (): {
  scheme: ColorScheme;
  next: ColorScheme;
  /** Moves to the next scheme and returns it. */
  cycleScheme: () => ColorScheme;
} => {
  const [schemeId, setSchemeId] = useState<ThemePreference>(getInitialTheme);

  const cycleScheme = useCallback((): ColorScheme => {
    const target = nextScheme(schemeId);
    const root = getThemeRoot();
    if (root) saveThemePreference(root, getBrowserThemeStorage(), target.id);
    setSchemeId(target.id);
    return target;
  }, [schemeId]);

  return { scheme: findScheme(schemeId), next: nextScheme(schemeId), cycleScheme };
};
