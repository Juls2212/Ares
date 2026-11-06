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
    hide: vi.fn(() => { state.visible = false; }),
    on: (event, listener) => { listeners.set(event, listener); }
  };
  const close = () => {
    const event = { preventDefault: vi.fn() };
    listeners.get("close")?.(event);
    return event;
  };
  return { window, close, emit: (name: string) => listeners.get(name)?.({ preventDefault: vi.fn() }), state };
};

const createHarness = (options: { lock?: boolean; trayFails?: boolean; window?: ManagedWindow } = {}) => {
  const appListeners = new Map<string, () => void>();
  const tray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn()
  } satisfies ManagedTray;
  const menus: TrayMenuItem[][] = [];
  const app = {
    requestSingleInstanceLock: vi.fn(() => options.lock ?? true),
    quit: vi.fn(),
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
    logError
  });
  return { lifecycle, app, tray, menus, appListeners, createMainWindow, logError };
};

const createSimpleWindow = () => {
  const listeners = new Map<string, CloseListener>();
  const state = { visible: true };
  const window: ManagedWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => state.visible,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(() => { state.visible = false; }),
    on: (event, listener) => { listeners.set(event, listener); }
  };
  const close = () => {
    const event = { preventDefault: vi.fn() };
    listeners.get("close")?.(event);
    return event;
  };
  return { window, close };
};

const createLabelledHarness = (
  label: { current: string | undefined },
  options: { balloon?: "ok" | "throws" | "absent"; window?: ManagedWindow } = {}
) => {
  const tray: ManagedTray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    ...(options.balloon === "absent" ? {} : {
      displayBalloon: vi.fn(() => { if (options.balloon === "throws") throw new Error("private C:\\detail"); })
    })
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

  it("falls back to normal close behavior when the tray cannot be created", () => {
    const harness = createWindow();
    const { lifecycle, logError } = createHarness({ trayFails: true });
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    const event = harness.close();
    expect(lifecycle.isTrayAvailable()).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(harness.window.hide).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("Tray creation failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private|Users/);
  });
});

describe("close to tray and quitting", () => {
  it("hides the window instead of closing it, keeping the application running", () => {
    const harness = createWindow();
    const { lifecycle, app } = createHarness();
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    const event = harness.close();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(harness.window.hide).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("quits only from the tray menu, after which closing is no longer intercepted", () => {
    const harness = createWindow();
    const { lifecycle, app, menus } = createHarness();
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    const quit = menus[0]?.find((item) => "label" in item && item.label === "Salir") as { click: () => void };
    quit.click();
    expect(lifecycle.isQuitting()).toBe(true);
    expect(app.quit).toHaveBeenCalledOnce();
    const event = harness.close();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(harness.window.hide).not.toHaveBeenCalled();
  });

  it("stops intercepting close on application quit signals and on session end", () => {
    const viaBeforeQuit = createWindow();
    const first = createHarness();
    first.lifecycle.start();
    first.lifecycle.createTray();
    first.lifecycle.attachWindow(viaBeforeQuit.window);
    first.appListeners.get("before-quit")?.();
    expect(viaBeforeQuit.close().preventDefault).not.toHaveBeenCalled();
    expect(first.tray.destroy).toHaveBeenCalledOnce();

    const viaSession = createWindow();
    const second = createHarness();
    second.lifecycle.createTray();
    second.lifecycle.attachWindow(viaSession.window);
    viaSession.emit("session-end");
    expect(viaSession.close().preventDefault).not.toHaveBeenCalled();
  });

  it("does not hide on minimize: only the close event is intercepted", () => {
    const harness = createWindow();
    const { lifecycle } = createHarness();
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    expect(harness.emit("minimize")).toBeUndefined();
    expect(harness.window.hide).not.toHaveBeenCalled();
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

describe("first hide-to-tray notice", () => {
  it("is shown on the first hide only, naming the shortcut, while every close still hides", () => {
    const harness = createSimpleWindow();
    const { lifecycle, tray } = createLabelledHarness({ current: "Ctrl+Alt+Space" }, { window: harness.window });
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    harness.close();
    harness.close();
    harness.close();
    expect(harness.window.hide).toHaveBeenCalledTimes(3);
    expect(tray.displayBalloon).toHaveBeenCalledOnce();
    expect(tray.displayBalloon).toHaveBeenCalledWith({
      title: "Ares",
      content: "Ares sigue activo en la bandeja. Atajo: Ctrl+Alt+Space."
    });
  });

  it("omits the shortcut when none is registered", () => {
    const harness = createSimpleWindow();
    const { lifecycle, tray } = createLabelledHarness({ current: undefined }, { window: harness.window });
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    harness.close();
    expect(tray.displayBalloon).toHaveBeenCalledWith({ title: "Ares", content: "Ares sigue activo en la bandeja." });
  });

  it.each(["throws", "absent"] as const)("degrades silently when the notice %s", (balloon) => {
    const harness = createSimpleWindow();
    const { lifecycle } = createLabelledHarness({ current: "Ctrl+Alt+Space" }, { window: harness.window, balloon });
    lifecycle.createTray();
    lifecycle.attachWindow(harness.window);
    const event = harness.close();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(harness.window.hide).toHaveBeenCalledOnce();
  });

  it("is not shown when quitting for real or when there is no tray", () => {
    const quitting = createSimpleWindow();
    const first = createLabelledHarness({ current: "Ctrl+Alt+Space" }, { window: quitting.window });
    first.lifecycle.createTray();
    first.lifecycle.attachWindow(quitting.window);
    first.lifecycle.quit();
    quitting.close();
    expect(first.tray.displayBalloon).not.toHaveBeenCalled();

    const noTray = createSimpleWindow();
    const second = createLabelledHarness({ current: "Ctrl+Alt+Space" }, { window: noTray.window });
    second.lifecycle.attachWindow(noTray.window);
    noTray.close();
    expect(second.tray.displayBalloon).not.toHaveBeenCalled();
  });
});
