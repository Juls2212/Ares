import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  TRAY_LABELS,
  createBackgroundLifecycle,
  createTrayIconBitmap,
  type ManagedTray,
  type ManagedWindow,
  type TrayMenuItem
} from "../src/main/background/background-lifecycle";
import { DEFAULT_VOICE_SHORTCUT } from "../src/main/voice/global-voice-shortcut";
import { formatShortcutForDisplay } from "../src/shared/settings-contracts";

type CloseListener = (event: { preventDefault: () => void }) => void;

const createWindow = (overrides: Partial<{ minimized: boolean; visible: boolean; destroyed: boolean }> = {}) => {
  const listeners = new Map<string, CloseListener>();
  const state = { minimized: false, visible: true, destroyed: false, ...overrides };
  const window: ManagedWindow = {
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    isVisible: () => state.visible,
    restore: vi.fn(() => { state.minimized = false; }),
    show: vi.fn(() => { state.visible = true; }),
    focus: vi.fn(),
    on: (event, listener) => { listeners.set(event, listener); }
  };
  const close = () => {
    const event = { preventDefault: vi.fn() };
    listeners.get("close")?.(event);
    return event;
  };
  return { window, close, emit: (name: string) => listeners.get(name)?.({ preventDefault: vi.fn() }), state };
};

const createHarness = (options: { lock?: boolean; trayFails?: boolean; window?: ManagedWindow; steps?: Array<() => void> } = {}) => {
  const appListeners = new Map<string, () => void>();
  /** Order of the shutdown-relevant calls, so tests can assert the sequence. */
  const calls: string[] = [];
  const tray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(() => { calls.push("tray.destroy"); })
  } satisfies ManagedTray;
  const menus: TrayMenuItem[][] = [];
  const app = {
    requestSingleInstanceLock: vi.fn(() => options.lock ?? true),
    quit: vi.fn(() => { calls.push("app.quit"); }),
    on: vi.fn((event: "second-instance" | "before-quit", listener: () => void) => { appListeners.set(event, listener); })
  };
  const createMainWindow = vi.fn(async () => undefined);
  const logError = vi.fn();
  const lifecycle = createBackgroundLifecycle({
    app,
    getMainWindow: () => options.window,
    createMainWindow,
    createTray: () => {
      if (options.trayFails) throw new Error("private tray detail C:\\Users\\Juli");
      return tray;
    },
    buildMenu: (items) => { menus.push(items); return { menu: items }; },
    logError,
    shutdownSteps: options.steps
  });
  return { lifecycle, app, tray, menus, appListeners, createMainWindow, logError, calls };
};

const createLabelledHarness = (
  label: { current: string | undefined },
  options: { window?: ManagedWindow } = {}
) => {
  const tray: ManagedTray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn()
  };
  const menus: TrayMenuItem[][] = [];
  const lifecycle = createBackgroundLifecycle({
    app: { requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn(), on: vi.fn() },
    getMainWindow: () => options.window,
    createMainWindow: vi.fn(async () => undefined),
    createTray: () => tray,
    buildMenu: (items) => { menus.push(items); return { menu: items }; },
    logError: vi.fn(),
    getShortcutLabel: () => label.current
  });
  return { lifecycle, tray, menus };
};

const labelsOf = (items: TrayMenuItem[] | undefined) => items?.map((item) => ("label" in item ? item.label : item.type));


describe("tray", () => {
  it("creates a tray with exactly the Spanish menu «Abrir Ares» and «Salir»", () => {
    const { lifecycle, tray, menus } = createHarness();
    lifecycle.start();
    lifecycle.createTray();
    expect(TRAY_LABELS).toMatchObject({ open: "Abrir Ares", quit: "Salir" });
    expect(tray.setToolTip).toHaveBeenCalledWith("Ares");
    expect(menus).toHaveLength(1);
    expect(menus[0]?.map((item) => ("label" in item ? item.label : item.type))).toEqual(["Abrir Ares", "separator", "Salir"]);
    expect(tray.setContextMenu).toHaveBeenCalledOnce();
    expect(lifecycle.isTrayAvailable()).toBe(true);
  });

  it("creates the tray only once", () => {
    const { lifecycle, tray } = createHarness();
    lifecycle.createTray();
    lifecycle.createTray();
    expect(tray.setContextMenu).toHaveBeenCalledOnce();
  });

  it("opens the window from the menu item and from a tray click", () => {
    const harness = createWindow({ minimized: true, visible: false });
    const { lifecycle, tray, menus } = createHarness({ window: harness.window });
    lifecycle.createTray();
    const open = menus[0]?.find((item) => "label" in item && item.label === "Abrir Ares") as { click: () => void };
    open.click();
    expect(harness.window.restore).toHaveBeenCalledOnce();
    expect(harness.window.show).toHaveBeenCalledOnce();
    expect(harness.window.focus).toHaveBeenCalledOnce();
    const clickListener = tray.on.mock.calls.find(([event]) => event === "click")?.[1] as () => void;
    harness.state.visible = false;
    clickListener();
    expect(harness.window.show).toHaveBeenCalledTimes(2);
  });

  it("recreates the window when it no longer exists", () => {
    const { lifecycle, createMainWindow } = createHarness({ window: createWindow({ destroyed: true }).window });
    lifecycle.showMainWindow();
    expect(createMainWindow).toHaveBeenCalledOnce();
  });

  it("logs a controlled message and never throws when recreating or showing fails", async () => {
    const throwing = createWindow().window;
    throwing.focus = () => { throw new Error("private C:\\detail"); };
    const first = createHarness({ window: throwing });
    expect(() => first.lifecycle.showMainWindow()).not.toThrow();
    expect(first.logError).toHaveBeenCalledWith("Showing the main window failed.");

    const second = createHarness();
    second.createMainWindow.mockRejectedValueOnce(new Error("private"));
    second.lifecycle.showMainWindow();
    await Promise.resolve();
    await Promise.resolve();
    expect(second.logError).toHaveBeenCalledWith("Main window recreation failed.");
    expect(JSON.stringify([first.logError.mock.calls, second.logError.mock.calls])).not.toMatch(/private|Users/);
  });

  it("still quits on close when the tray cannot be created", () => {
    const harness = createWindow();
    const { lifecycle, logError, app } = createHarness({ trayFails: true });
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    const event = harness.close();
    expect(lifecycle.isTrayAvailable()).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("Tray creation failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private|Users/);
  });
});

describe("close quits the application, minimize keeps it running", () => {
  const attach = (options: Parameters<typeof createHarness>[0] = {}) => {
    const window = createWindow();
    const harness = createHarness(options);
    harness.lifecycle.start();
    harness.lifecycle.createTray();
    harness.lifecycle.attachWindow(window.window);
    return { ...harness, window };
  };

  it("quits the application when the window is closed, without intercepting the close event", () => {
    const { window, app, tray, lifecycle } = attach();
    const event = window.close();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(lifecycle.isQuitting()).toBe(true);
  });

  it("runs the shutdown steps in order, then destroys the tray, then quits, all exactly once", () => {
    const order: string[] = [];
    const steps = [() => order.push("shortcut"), () => order.push("messaging"), () => order.push("spotify")];
    const { window, calls } = attach({ steps });
    window.close();
    expect(order).toEqual(["shortcut", "messaging", "spotify"]);
    expect(calls).toEqual(["tray.destroy", "app.quit"]);
  });

  it("keeps the steps before the tray: the full sequence is steps, tray, quit", () => {
    const sequence: string[] = [];
    const harness = createHarness({ steps: [() => sequence.push("step")] });
    harness.tray.destroy.mockImplementation(() => { sequence.push("tray"); });
    harness.app.quit.mockImplementation(() => { sequence.push("quit"); });
    harness.lifecycle.createTray();
    harness.lifecycle.quit();
    expect(sequence).toEqual(["step", "tray", "quit"]);
  });

  it("is idempotent: closing twice, closing after the tray quit, or quitting twice runs everything once", () => {
    const step = vi.fn();
    const { window, app, tray, lifecycle, menus } = attach({ steps: [step] });
    const quit = menus[0]?.find((item) => "label" in item && item.label === "Salir") as { click: () => void };
    window.close();
    window.close();
    quit.click();
    lifecycle.quit();
    expect(step).toHaveBeenCalledOnce();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("quits from the tray «Salir» entry through the very same path", () => {
    const step = vi.fn();
    const { app, tray, menus, window } = attach({ steps: [step] });
    const quit = menus[0]?.find((item) => "label" in item && item.label === "Salir") as { click: () => void };
    quit.click();
    expect(step).toHaveBeenCalledOnce();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(window.close().preventDefault).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("does nothing on minimize: the app, the tray and the services keep running", () => {
    const step = vi.fn();
    const { window, app, tray, lifecycle } = attach({ steps: [step] });
    expect(window.emit("minimize")).toBeUndefined();
    expect(window.emit("hide")).toBeUndefined();
    expect(app.quit).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
    expect(tray.destroy).not.toHaveBeenCalled();
    expect(lifecycle.isTrayAvailable()).toBe(true);
    expect(lifecycle.isQuitting()).toBe(false);
  });

  it("restores a minimized or hidden window from the tray «Abrir Ares» entry and from a tray click", () => {
    const window = createWindow({ minimized: true, visible: false });
    const { lifecycle, menus, tray, app } = createHarness({ window: window.window });
    lifecycle.createTray();
    const open = menus[0]?.find((item) => "label" in item && item.label === "Abrir Ares") as { click: () => void };
    open.click();
    expect(window.window.restore).toHaveBeenCalledOnce();
    expect(window.window.show).toHaveBeenCalledOnce();
    expect(window.window.focus).toHaveBeenCalledOnce();
    expect((tray.on.mock.calls.find(([event]) => event === "click") ?? [])[1]).toBeTypeOf("function");
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("runs the same shutdown once when Electron quits for another reason (before-quit)", () => {
    const step = vi.fn();
    const { appListeners, tray, app, window } = attach({ steps: [step] });
    appListeners.get("before-quit")?.();
    appListeners.get("before-quit")?.();
    expect(step).toHaveBeenCalledOnce();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(window.close().preventDefault).not.toHaveBeenCalled();
    expect(step).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("runs the synchronous shutdown on Windows session end without waiting for anything", () => {
    const step = vi.fn();
    const { window, tray, lifecycle } = attach({ steps: [step] });
    window.emit("session-end");
    expect(step).toHaveBeenCalledOnce();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(lifecycle.isQuitting()).toBe(true);
  });

  it("logs a failing step with a fixed message, still runs the next step and still quits", () => {
    const next = vi.fn();
    const { window, logError, app, tray } = attach({ steps: [() => { throw new Error("private C:\\Users\\detail"); }, next] });
    window.close();
    expect(next).toHaveBeenCalledOnce();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("Shutdown step failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private|Users/);
  });

  it("cleans the tray up exactly once and tolerates a failing destroy", () => {
    const { lifecycle, tray, logError } = createHarness();
    lifecycle.createTray();
    tray.destroy.mockImplementationOnce(() => { throw new Error("private"); });
    lifecycle.dispose();
    lifecycle.dispose();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("Tray cleanup failed.");
    expect(lifecycle.isTrayAvailable()).toBe(false);
  });

  it("no longer hides the window or shows a hide-to-tray notice", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/main/background/background-lifecycle.ts"), "utf8");
    expect(source).not.toMatch(/preventDefault\(|\.hide\(|displayBalloon|sigue activo/u);
  });
});

describe("single instance", () => {
  it("lets the first instance run and focuses it when a second one is launched", () => {
    const harness = createWindow({ minimized: true, visible: false });
    const { lifecycle, app, appListeners } = createHarness({ window: harness.window });
    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.start()).toBe(true);
    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce();
    appListeners.get("second-instance")?.();
    expect(harness.window.restore).toHaveBeenCalledOnce();
    expect(harness.window.show).toHaveBeenCalledOnce();
    expect(harness.window.focus).toHaveBeenCalledOnce();
  });

  it("tells a second instance to exit without registering anything", () => {
    const { lifecycle, app } = createHarness({ lock: false });
    expect(lifecycle.start()).toBe(false);
    expect(app.on).not.toHaveBeenCalled();
  });
});

describe("tray icon", () => {
  it("is generated in code as a deterministic BGRA bitmap with a transparent border", () => {
    const first = createTrayIconBitmap(32);
    expect(first.length).toBe(32 * 32 * 4);
    expect(first.equals(createTrayIconBitmap(32))).toBe(true);
    expect(first.readUInt8(3)).toBe(0);
    expect(first.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  });
});

describe("tray label and tooltip", () => {
  it("put the real accelerator in the menu label and the tooltip", () => {
    const { lifecycle, tray, menus } = createLabelledHarness({ current: formatShortcutForDisplay(DEFAULT_VOICE_SHORTCUT) });
    lifecycle.createTray();
    expect(labelsOf(menus[0])).toEqual(["Abrir Ares (Ctrl+Alt+Space)", "separator", "Salir"]);
    expect(tray.setToolTip).toHaveBeenCalledWith("Ares — Atajo: Ctrl+Alt+Space");
  });

  it("keep the plain labels when no shortcut is registered", () => {
    const { lifecycle, tray, menus } = createLabelledHarness({ current: undefined });
    lifecycle.createTray();
    expect(labelsOf(menus[0])).toEqual(["Abrir Ares", "separator", "Salir"]);
    expect(tray.setToolTip).toHaveBeenCalledWith("Ares");
  });

  it("refresh when the shortcut changes, and tolerate a failing refresh", () => {
    const label = { current: "Ctrl+Alt+Space" as string | undefined };
    const { lifecycle, tray, menus } = createLabelledHarness(label);
    lifecycle.refreshTray();
    expect(menus).toHaveLength(0);
    lifecycle.createTray();
    label.current = "Ctrl+Shift+Space";
    lifecycle.refreshTray();
    expect(labelsOf(menus.at(-1))?.[0]).toBe("Abrir Ares (Ctrl+Shift+Space)");
    expect(tray.setToolTip).toHaveBeenLastCalledWith("Ares — Atajo: Ctrl+Shift+Space");
    label.current = undefined;
    lifecycle.refreshTray();
    expect(labelsOf(menus.at(-1))?.[0]).toBe("Abrir Ares");
    vi.mocked(tray.setContextMenu).mockImplementationOnce(() => { throw new Error("private"); });
    expect(() => lifecycle.refreshTray()).not.toThrow();
  });
});
