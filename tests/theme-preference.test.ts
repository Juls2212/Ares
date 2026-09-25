import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_THEME_PREFERENCE,
  initializeThemePreference,
  readThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY
} from "../src/renderer/features/settings/theme-preference";

const createRoot = () => ({ setAttribute: vi.fn() });

describe("renderer theme preference", () => {
  it("uses light mode when there is no saved preference", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };

    expect(initializeThemePreference(root, storage)).toBe(DEFAULT_THEME_PREFERENCE);
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "light");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("restores a valid saved dark preference", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(() => "dark"), setItem: vi.fn() };

    expect(initializeThemePreference(root, storage)).toBe("dark");
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "dark");
  });

  it("falls back to light when storage is malformed or unavailable", () => {
    expect(readThemePreference({ getItem: () => "midnight", setItem: vi.fn() })).toBe("light");
    expect(readThemePreference({ getItem: () => { throw new Error("blocked"); }, setItem: vi.fn() })).toBe("light");
    expect(readThemePreference(undefined)).toBe("light");
  });

  it("applies and persists only the selected light or dark value", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(), setItem: vi.fn() };

    saveThemePreference(root, storage, "dark");
    saveThemePreference(root, storage, "light");

    expect(root.setAttribute).toHaveBeenNthCalledWith(1, "data-theme", "dark");
    expect(root.setAttribute).toHaveBeenNthCalledWith(2, "data-theme", "light");
    expect(storage.setItem).toHaveBeenNthCalledWith(1, THEME_STORAGE_KEY, "dark");
    expect(storage.setItem).toHaveBeenNthCalledWith(2, THEME_STORAGE_KEY, "light");
  });

  it("keeps the active appearance when persistence is unavailable", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(), setItem: () => { throw new Error("blocked"); } };

    saveThemePreference(root, storage, "dark");

    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "dark");
  });
});
