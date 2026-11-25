import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import forgeConfig from "../forge.config";
import packageJson from "../package.json";
import {
  APP_USER_MODEL_ID,
  EXECUTABLE_NAME,
  PRODUCT_NAME,
  SETUP_EXE_NAME,
  SQUIRREL_PACKAGE_NAME
} from "../src/main/app-identity";
import { createBackgroundLifecycle } from "../src/main/background/background-lifecycle";
import {
  SQUIRREL_EVENT_FLAGS,
  handleSquirrelStartup,
  parseSquirrelEvent,
  updateExeArguments,
  type SquirrelChild
} from "../src/main/squirrel-startup";
import { listSourceFiles, readSource } from "./helpers/read-source";

type MakerLike = { configOrConfigFetcher: Record<string, unknown>; constructor: { name: string } };
const makers = forgeConfig.makers as unknown as MakerLike[];

describe("Forge configuration shape", () => {
  it("builds a Squirrel installer and a win32 zip, in that order, and nothing else", () => {
    expect(makers.map((maker) => maker.constructor.name)).toEqual(["MakerSquirrel", "MakerZIP"]);
  });

  it("fixes the installer name, skips the MSI and uses a letters-only package id", () => {
    const squirrel = makers[0].configOrConfigFetcher;
    expect(SETUP_EXE_NAME).toBe("Ares-Setup.exe");
    expect(squirrel.setupExe).toBe("Ares-Setup.exe");
    expect(squirrel.noMsi).toBe(true);
    expect(squirrel.name).toBe(SQUIRREL_PACKAGE_NAME);
    expect(String(squirrel.name)).toMatch(/^[A-Za-z]+$/u);
    expect(squirrel.title).toBe(PRODUCT_NAME);
    expect(squirrel.exe).toBe(`${EXECUTABLE_NAME}.exe`);
    expect(squirrel.description).toBe(packageJson.description);
    expect(String(squirrel.authors).length).toBeGreaterThan(0);
  });

  it("keeps the executable and folder name, names the product Ares and keeps asar and the shipped resources", () => {
    const packager = forgeConfig.packagerConfig as Record<string, unknown>;
    expect(packager.asar).toBe(true);
    expect(packager.executableName).toBe("ares-desktop");
    expect((packager.win32metadata as Record<string, string>).ProductName).toBe("Ares");
    expect(packager.name).toBeUndefined();
    expect(packager.extraResource).toContain("./drizzle");
    expect((packager.extraResource as string[]).length).toBe(4);
    expect(packager.icon).toBeUndefined(); // The repository has no icon asset; none is invented.
  });
});

describe("app identity", () => {
  it("derives the AppUserModelID from the same constants that configure Squirrel", () => {
    expect(APP_USER_MODEL_ID).toBe(`com.squirrel.${SQUIRREL_PACKAGE_NAME}.${EXECUTABLE_NAME}`);
    expect(APP_USER_MODEL_ID).toBe("com.squirrel.Ares.ares-desktop");
    expect(APP_USER_MODEL_ID).toMatch(/^[a-z]+(\.[A-Za-z0-9-]+)+$/u);
    expect(readSource("forge.config.ts")).toContain('from "./src/main/app-identity"');
    const main = readSource("src/main/main.ts");
    expect(main).toContain("app.setAppUserModelId(APP_USER_MODEL_ID)");
    expect(main).not.toContain("com.squirrel");
    expect(readSource("forge.config.ts")).not.toContain("com.squirrel");
  });

  it("calls the Squirrel handler and sets the id before anything else in Main starts", () => {
    const main = readSource("src/main/main.ts");
    const squirrel = main.indexOf("handleSquirrelStartup(");
    expect(squirrel).toBeGreaterThan(-1);
    for (const later of ["markPackagedRuntime(app.isPackaged", "configureRuntimeLocations({", "createBackgroundLifecycle({", "app.whenReady()", "new BrowserWindow("]) {
      expect(squirrel, later).toBeLessThan(main.indexOf(later));
    }
    expect(main.indexOf("app.setAppUserModelId(")).toBeLessThan(main.indexOf("createBackgroundLifecycle({"));
  });

  it("stores data only in userData and never under the install folder", () => {
    const text = listSourceFiles("src/main").map((file) => readSource(file)).join("\n");
    expect(text).not.toMatch(/getPath\("exe"\)|getAppPath\(\)\s*,\s*["'`]\.\.|path\.dirname\(process\.execPath\)\s*,\s*["'`](data|database)/u);
    expect(readSource("src/main/database/pglite-assets.mjs")).toContain("path.relative(base, target)");
    expect(readSource("src/main/config/development-environment.ts")).toContain("ARES_ENV_FILE_NAME");
  });
});

describe("Squirrel lifecycle events", () => {
  it("accepts exactly five flags and nothing else", () => {
    expect(Object.keys(SQUIRREL_EVENT_FLAGS).sort()).toEqual(["--squirrel-firstrun", "--squirrel-install", "--squirrel-obsolete", "--squirrel-uninstall", "--squirrel-updated"]);
    expect(parseSquirrelEvent(["ares.exe", "--squirrel-install", "0.1.0"])).toBe("install");
    expect(parseSquirrelEvent(["ares.exe", "--squirrel-updated", "0.2.0"])).toBe("updated");
    expect(parseSquirrelEvent(["ares.exe", "--squirrel-uninstall", "0.1.0"])).toBe("uninstall");
    expect(parseSquirrelEvent(["ares.exe", "--squirrel-obsolete", "0.1.0"])).toBe("obsolete");
    expect(parseSquirrelEvent(["ares.exe", "--squirrel-firstrun"])).toBe("firstrun");
    for (const other of [[], ["ares.exe"], ["ares.exe", "--squirrel-evil"], ["ares.exe", "squirrel-install"], ["ares.exe", "--squirrel-install=1"], ["ares.exe", "toString"], ["ares.exe", "__proto__"], ["ares.exe", "x", "--squirrel-install"]]) {
      expect(parseSquirrelEvent(other)).toBeUndefined();
    }
  });

  it("builds fixed Update.exe arguments from the closed table", () => {
    expect(updateExeArguments("install", "ares-desktop.exe")).toEqual(["--createShortcut=ares-desktop.exe", "--shortcut-locations=Desktop,StartMenu"]);
    expect(updateExeArguments("updated", "ares-desktop.exe")).toEqual(["--createShortcut=ares-desktop.exe", "--shortcut-locations=Desktop,StartMenu"]);
    expect(updateExeArguments("uninstall", "ares-desktop.exe")).toEqual(["--removeShortcut=ares-desktop.exe"]);
    expect(updateExeArguments("obsolete", "ares-desktop.exe")).toBeUndefined();
    expect(updateExeArguments("firstrun", "ares-desktop.exe")).toBeUndefined();
    for (const bad of ["", "ares desktop.exe", "a&b.exe", "x.exe --evil", "..\\x.exe", "ares-desktop", "a".repeat(80) + ".exe"]) {
      expect(updateExeArguments("install", bad)).toBeUndefined();
    }
  });

  const run = (argv: string[], overrides: { platform?: string; execPath?: string } = {}) => {
    const listeners = new Map<string, () => void>();
    const child: SquirrelChild = { on: (event, listener) => { listeners.set(event, listener); } };
    const spawnUpdate = vi.fn(() => child);
    const onFinished = vi.fn();
    const execPath = overrides.execPath ?? path.join("C:", "Users", "x", "AppData", "Local", "Ares", "app-0.1.0", "ares-desktop.exe");
    const handled = handleSquirrelStartup(onFinished, { platform: overrides.platform ?? "win32", argv, execPath, spawnUpdate });
    return { handled, spawnUpdate, onFinished, listeners, execPath };
  };

  it("creates shortcuts through the sibling Update.exe at install and quits only when it has finished", () => {
    const { handled, spawnUpdate, onFinished, listeners, execPath } = run(["ares-desktop.exe", "--squirrel-install", "0.1.0"]);
    expect(handled).toBe(true);
    expect(spawnUpdate).toHaveBeenCalledTimes(1);
    expect(spawnUpdate).toHaveBeenCalledWith(path.resolve(path.dirname(execPath), "..", "Update.exe"), ["--createShortcut=ares-desktop.exe", "--shortcut-locations=Desktop,StartMenu"]);
    expect(onFinished).not.toHaveBeenCalled();
    listeners.get("close")?.();
    listeners.get("error")?.();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("removes shortcuts at uninstall, quits even if Update.exe fails, and does nothing for obsolete", () => {
    const uninstall = run(["ares-desktop.exe", "--squirrel-uninstall", "0.1.0"]);
    expect(uninstall.handled).toBe(true);
    expect(uninstall.spawnUpdate.mock.calls[0]).toEqual([expect.stringMatching(/Update\.exe$/u), ["--removeShortcut=ares-desktop.exe"]]);
    uninstall.listeners.get("error")?.();
    expect(uninstall.onFinished).toHaveBeenCalledTimes(1);

    const obsolete = run(["ares-desktop.exe", "--squirrel-obsolete", "0.1.0"]);
    expect(obsolete.handled).toBe(true);
    expect(obsolete.spawnUpdate).not.toHaveBeenCalled();
    expect(obsolete.onFinished).toHaveBeenCalledTimes(1);
  });

  it("lets a normal launch and the first run start the app, and ignores other platforms and unsafe names", () => {
    for (const argv of [["ares-desktop.exe"], ["ares-desktop.exe", "--squirrel-firstrun"], ["ares-desktop.exe", "--squirrel-bogus"]]) {
      const outcome = run(argv);
      expect(outcome.handled).toBe(false);
      expect(outcome.spawnUpdate).not.toHaveBeenCalled();
      expect(outcome.onFinished).not.toHaveBeenCalled();
    }
    expect(run(["x", "--squirrel-install"], { platform: "linux" }).handled).toBe(false);
    const unsafe = run(["x", "--squirrel-install"], { execPath: path.join("C:", "app", "bad name&.exe") });
    expect(unsafe.handled).toBe(true);
    expect(unsafe.spawnUpdate).not.toHaveBeenCalled();
    expect(unsafe.onFinished).toHaveBeenCalledTimes(1);
  });

  it("does not add a launch capability: only Main uses it, from the process command line, with no shell", () => {
    const source = readSource("src/main/squirrel-startup.ts");
    expect(source).toContain("shell: false");
    expect(source).not.toMatch(/ipcMain|ipcRenderer|contextBridge|window\.ares/u);
    const users = listSourceFiles("src").filter((file) => /squirrel-startup/u.test(readSource(file)) && file !== "src/main/squirrel-startup.ts");
    expect(users).toEqual(["src/main/main.ts"]);
    expect(readSource("src/preload/preload.ts")).not.toMatch(/squirrel|Update\.exe/iu);
  });
});

describe("single instance", () => {
  const harness = (lock: boolean) => {
    const listeners = new Map<string, () => void>();
    const window = { isDestroyed: () => false, isMinimized: () => true, isVisible: () => false, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), on: vi.fn() };
    const app = { requestSingleInstanceLock: vi.fn(() => lock), quit: vi.fn(), on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener); }) };
    const lifecycle = createBackgroundLifecycle({
      app: app as never,
      getMainWindow: () => window,
      createMainWindow: async () => undefined,
      createTray: () => ({ setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() }),
      buildMenu: () => ({}),
      logError: vi.fn()
    });
    return { lifecycle, app, window, listeners };
  };

  it("lets the first instance run and restores and focuses its window when a second one starts", () => {
    const { lifecycle, window, listeners } = harness(true);
    expect(lifecycle.start()).toBe(true);
    listeners.get("second-instance")?.();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it("tells a second instance to exit when the lock is taken, and Main quits it", () => {
    const { lifecycle } = harness(false);
    expect(lifecycle.start()).toBe(false);
    const main = readSource("src/main/main.ts");
    expect(main).toContain("requestSingleInstanceLock: () => app.requestSingleInstanceLock()");
    expect(main).toContain('if (event === "second-instance") app.on("second-instance", () => listener());');
    expect(main).toContain("if (!isPrimaryInstance && !squirrelHandled) app.quit();");
    expect(main).toContain("if (!isPrimaryInstance) return;");
  });
});
