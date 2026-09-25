import { useCallback, useState } from "react";

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
  if (!root) return "light";
  return initializeThemePreference(root, getBrowserThemeStorage());
};

export const useThemePreference = (): {
  theme: ThemePreference;
  toggleTheme: () => void;
} => {
  const [theme, setTheme] = useState<ThemePreference>(getInitialTheme);

  const toggleTheme = useCallback((): void => {
    const nextTheme: ThemePreference = theme === "light" ? "dark" : "light";
    const root = getThemeRoot();
    if (root) saveThemePreference(root, getBrowserThemeStorage(), nextTheme);
    setTheme(nextTheme);
  }, [theme]);

  return { theme, toggleTheme };
};
