import { describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  DEFAULT_THEME_PREFERENCE,
  initializeThemePreference,
  readThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY
} from "../src/renderer/features/settings/theme-preference";

const createRoot = () => ({ setAttribute: vi.fn() });

describe("renderer color scheme preference", () => {
  it("uses the green scheme when there is no saved preference", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };

    expect(initializeThemePreference(root, storage)).toBe(DEFAULT_THEME_PREFERENCE);
    expect(DEFAULT_THEME_PREFERENCE).toBe("green");
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "green");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("restores a valid saved blue scheme", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(() => "blue"), setItem: vi.fn() };

    expect(initializeThemePreference(root, storage)).toBe("blue");
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "blue");
  });

  it("migrates the old light and dark values to the green and blue schemes", () => {
    expect(readThemePreference({ getItem: () => "light", setItem: vi.fn() })).toBe("green");
    expect(readThemePreference({ getItem: () => "dark", setItem: vi.fn() })).toBe("blue");
    const root = createRoot();
    expect(initializeThemePreference(root, { getItem: () => "dark", setItem: vi.fn() })).toBe("blue");
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "blue");
  });

  it("falls back to green when storage is malformed or unavailable", () => {
    expect(readThemePreference({ getItem: () => "midnight", setItem: vi.fn() })).toBe("green");
    expect(readThemePreference({ getItem: () => { throw new Error("blocked"); }, setItem: vi.fn() })).toBe("green");
    expect(readThemePreference(undefined)).toBe("green");
  });

  it("applies and persists only the selected scheme id", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(), setItem: vi.fn() };

    saveThemePreference(root, storage, "blue");
    saveThemePreference(root, storage, "green");
    saveThemePreference(root, storage, "unknown");

    expect(root.setAttribute).toHaveBeenNthCalledWith(1, "data-theme", "blue");
    expect(root.setAttribute).toHaveBeenNthCalledWith(2, "data-theme", "green");
    expect(root.setAttribute).toHaveBeenNthCalledWith(3, "data-theme", "green");
    expect(storage.setItem).toHaveBeenNthCalledWith(1, THEME_STORAGE_KEY, "blue");
    expect(storage.setItem).toHaveBeenNthCalledWith(2, THEME_STORAGE_KEY, "green");
    expect(storage.setItem).toHaveBeenNthCalledWith(3, THEME_STORAGE_KEY, "green");
  });

  it("keeps the active appearance when persistence is unavailable", () => {
    const root = createRoot();
    const storage = { getItem: vi.fn(), setItem: () => { throw new Error("blocked"); } };

    saveThemePreference(root, storage, "blue");

    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "blue");
  });

  it("does nothing special for a root without a style object", () => {
    expect(() => applyThemePreference(createRoot(), "blue")).not.toThrow();
  });
});
