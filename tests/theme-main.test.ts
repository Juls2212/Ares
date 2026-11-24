import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() }, nativeTheme: {} }));

import { THEME_MENU_CHOICES, createBackgroundLifecycle, type ManagedTray, type TrayMenuItem } from "../src/main/background/background-lifecycle";
import { THEME_PREFERENCE_SETTING_KEY, createThemePreferenceService, type ThemePreferenceStore } from "../src/main/settings/theme-preference-service";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCES,
  TITLE_BAR_OVERLAY_HEIGHT,
  USE_CUSTOM_TITLE_BAR,
  WINDOW_THEME_COLORS,
  getTitleBarOverlay,
  getWindowChrome,
  isThemePreference,
  supportsTitleBarOverlay,
  type ThemePreference
} from "../src/main/window-theme";

const mainSource = readFileSync("src/main/main.ts", "utf8");

describe("window colors and title bar", () => {
  it("uses solid theme backgrounds and the documented overlay colors", () => {
    expect(WINDOW_THEME_COLORS).toEqual({ dark: { background: "#02090b", overlaySymbol: "#bff3ee" }, light: { background: "#d4e4df", overlaySymbol: "#0b2b27" } });
    // The overlay color is the header background, so the Windows buttons area is the same color as the header.
    expect(getTitleBarOverlay(true)).toEqual({ color: "#041a1e", symbolColor: "#bff3ee", height: TITLE_BAR_OVERLAY_HEIGHT });
    expect(getTitleBarOverlay(false)).toEqual({ color: "#dcebe7", symbolColor: "#0b2b27", height: TITLE_BAR_OVERLAY_HEIGHT });
    for (const dark of [true, false]) {
      const options = getWindowChrome({ platform: "win32", electronVersion: "44.4.0", shouldUseDarkColors: dark }).options;
      expect(options.backgroundColor).toBe(dark ? "#02090b" : "#d4e4df");
      expect(options.titleBarOverlay?.color).toBe(dark ? "#041a1e" : "#dcebe7");
      expect(JSON.stringify(options)).not.toMatch(/acrylic|vibrancy|transparent|#00000000/iu);
    }
  });

  it("hides the native title bar behind one constant, and falls back to the native frame when the API is missing", () => {
    expect(USE_CUSTOM_TITLE_BAR).toBe(true);
    const custom = getWindowChrome({ platform: "win32", electronVersion: "44.4.0", shouldUseDarkColors: true });
    expect(custom.customTitleBar).toBe(true);
    expect(custom.options).toMatchObject({ titleBarStyle: "hidden", titleBarOverlay: { height: 54 } });
    const switchedOff = getWindowChrome({ platform: "win32", electronVersion: "44.4.0", shouldUseDarkColors: true, useCustomTitleBar: false });
    expect(switchedOff.customTitleBar).toBe(false);
    expect(Object.keys(switchedOff.options)).toEqual(["backgroundColor"]);
    for (const [platform, version] of [["win32", "19.0.0"], ["win32", undefined], ["win32", "garbage"], ["darwin", "44.4.0"], ["linux", "44.4.0"]] as const) {
      expect(supportsTitleBarOverlay(platform, version), `${platform} ${version}`).toBe(false);
      expect(getWindowChrome({ platform, electronVersion: version, shouldUseDarkColors: false }).options).toEqual({ backgroundColor: "#d4e4df" });
    }
    expect(supportsTitleBarOverlay("win32", "21.0.0")).toBe(true);
  });

  it("wires the portrait HUD window, the menu rule and the theme updates in main.ts without touching security options", () => {
    expect(mainSource).toContain("width: 480, height: 740, minWidth: 420, minHeight: 620");
    expect(mainSource).not.toMatch(/setAspectRatio|backgroundMaterial|setBackgroundMaterial|vibrancy|transparent:\s*true/u);
    expect(mainSource).toMatch(/if \(app\.isPackaged\) \{\s*Menu\.setApplicationMenu\(null\);/u);
    expect(mainSource).toContain('nativeTheme.on("updated", applyWindowTheme)');
    expect(mainSource).toContain("window.setTitleBarOverlay(getTitleBarOverlay(nativeTheme.shouldUseDarkColors))");
    expect(mainSource).toContain("window.setBackgroundColor(chrome.backgroundColor)");
    // The theme is read before the window is created.
    expect(mainSource.indexOf("themePreferenceService.initialize()")).toBeLessThan(mainSource.indexOf("await createMainWindow()"));
    for (const option of ["contextIsolation: true", "nodeIntegration: false", "sandbox: true", "webSecurity: true", "backgroundThrottling: false"]) expect(mainSource).toContain(option);
  });
});

describe("theme preference", () => {
  const createFixture = (stored: unknown, behavior: { read?: "ok" | "throws"; write?: "ok" | "throws" } = {}) => {
    const saved: ThemePreference[] = [];
    const store: ThemePreferenceStore = {
      get: async () => { if (behavior.read === "throws") throw new Error("database is down C:\\private"); return stored; },
      save: async (preference) => { if (behavior.write === "throws") throw new Error("database is down"); saved.push(preference); }
    };
    const nativeTheme = { themeSource: "system" as ThemePreference };
    const applied = vi.fn();
    const logError = vi.fn();
    const service = createThemePreferenceService({ store: () => store, nativeTheme, onApplied: applied, logError });
    return { service, nativeTheme, saved, applied, logError };
  };

  it("reads the saved preference at startup and applies it to nativeTheme", async () => {
    for (const choice of THEME_PREFERENCES) {
      const { service, nativeTheme, applied } = createFixture(choice);
      expect(await service.initialize()).toBe(choice);
      expect(nativeTheme.themeSource).toBe(choice);
      expect(service.get()).toBe(choice);
      expect(applied).toHaveBeenCalledOnce();
    }
  });

  it("falls back to the system theme when nothing valid is saved", async () => {
    for (const stored of [undefined, null, "", "blue", "DARK", 1, {}, ["dark"], "constructor"]) {
      const { service, nativeTheme } = createFixture(stored);
      expect(await service.initialize(), String(stored)).toBe("system");
      expect(nativeTheme.themeSource).toBe("system");
    }
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
  });

  it("never fails startup when the database is unavailable, and logs one fixed line without the cause", async () => {
    const { service, nativeTheme, logError } = createFixture("dark", { read: "throws" });
    await expect(service.initialize()).resolves.toBe("system");
    expect(nativeTheme.themeSource).toBe("system");
    expect(logError.mock.calls).toEqual([["Theme preference could not be read."]]);
    const throwingStore = createThemePreferenceService({ store: () => { throw new Error("no database client"); }, nativeTheme: { themeSource: "system" }, onApplied: vi.fn(), logError: vi.fn() });
    await expect(throwingStore.initialize()).resolves.toBe("system");
  });

  it("applies a choice at once, updates the window, and persists it", async () => {
    const { service, nativeTheme, applied, saved } = createFixture(undefined);
    await service.initialize();
    applied.mockClear();
    expect(await service.set("dark")).toBe("SAVED");
    expect(nativeTheme.themeSource).toBe("dark");
    expect(applied).toHaveBeenCalledOnce();
    expect(saved).toEqual(["dark"]);
    expect(service.get()).toBe("dark");
    expect(THEME_PREFERENCE_SETTING_KEY).toMatch(/^[a-z][a-z0-9_]*$/u);
  });

  it("keeps the choice for this session when saving fails, and rejects anything that is not a preference", async () => {
    const { service, nativeTheme, logError, saved } = createFixture(undefined, { write: "throws" });
    await service.initialize();
    expect(await service.set("light")).toBe("NOT_SAVED");
    expect(nativeTheme.themeSource).toBe("light");
    expect(logError).toHaveBeenCalledWith("Theme preference could not be saved.");
    for (const hostile of ["", "blue", "toString", null, undefined, 3, {}]) expect(await service.set(hostile)).toBe("INVALID");
    expect(nativeTheme.themeSource).toBe("light");
    expect(saved).toEqual([]);
    expect(isThemePreference("system") && !isThemePreference("auto")).toBe(true);
  });
});

describe("tray theme submenu", () => {
  const createHarness = () => {
    const tray: ManagedTray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() };
    const menus: TrayMenuItem[][] = [];
    const state = { current: "system" as ThemePreference };
    const choose = vi.fn(async (preference: ThemePreference) => { state.current = preference; });
    const lifecycle = createBackgroundLifecycle({
      app: { requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn(), on: vi.fn() },
      getMainWindow: () => undefined,
      createMainWindow: vi.fn(async () => undefined),
      createTray: () => tray,
      buildMenu: (items) => { menus.push(items); return { menu: items }; },
      logError: vi.fn(),
      theme: { current: () => state.current, choose: (preference) => { void choose(preference); } }
    });
    lifecycle.start();
    lifecycle.createTray();
    return { menus, choose, state, lifecycle };
  };
  const themeItem = (items: TrayMenuItem[] | undefined) => items?.find((item) => "submenu" in item) as { label: string; submenu: Array<{ label: string; type: string; checked: boolean; click: () => void }> } | undefined;

  it("adds a «Tema» submenu with three radio items: Automático, Claro and Oscuro", () => {
    const { menus } = createHarness();
    const item = themeItem(menus[0]);
    expect(item?.label).toBe("Tema");
    expect(item?.submenu.map((entry) => [entry.label, entry.type, entry.checked])).toEqual([["Automático", "radio", true], ["Claro", "radio", false], ["Oscuro", "radio", false]]);
    expect(THEME_MENU_CHOICES.map((choice) => choice.value)).toEqual(["system", "light", "dark"]);
    // The two original items and the separator are still there, in the same order.
    expect(menus[0]!.map((entry) => ("label" in entry ? entry.label : entry.type))).toEqual(["Abrir Ares", "Tema", "separator", "Salir"]);
  });

  it("choosing an item applies and persists the preference and rebuilds the menu with the new radio checked", () => {
    const { menus, choose, state } = createHarness();
    themeItem(menus[0])!.submenu[2]!.click();
    expect(choose).toHaveBeenCalledWith("dark");
    expect(state.current).toBe("dark");
    expect(themeItem(menus.at(-1))!.submenu.map((entry) => entry.checked)).toEqual([false, false, true]);
    themeItem(menus.at(-1))!.submenu[1]!.click();
    expect(choose).toHaveBeenLastCalledWith("light");
    expect(themeItem(menus.at(-1))!.submenu.map((entry) => entry.checked)).toEqual([false, true, false]);
  });

  it("is wired in main.ts through the existing tray, with no new IPC channel", () => {
    expect(mainSource).toContain("theme: { current: () => themePreferenceService.get(), choose: (preference) => { void themePreferenceService.set(preference); } }");
    expect(mainSource).toContain('"submenu" in item ? { label: item.label, submenu: item.submenu }');
    expect(mainSource).not.toMatch(/ipcMain\.handle\(/u);
    // The only theme IPC is the closed setter of the toggle button (see theme-ipc.test.ts).
    expect(readFileSync("src/preload/preload.ts", "utf8").match(/theme/giu)?.length).toBeGreaterThan(0);
    expect(readFileSync("src/preload/preload.ts", "utf8").match(/setPreference:/gu)).toHaveLength(1);
  });
});
