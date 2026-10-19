import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  TRAY_LABELS,
  createBackgroundLifecycle,
  createTrayIconBitmap,
  type ManagedTray,
  type ManagedWindow,
  type TrayMenuItem
} from "../src/main/background/background-lifecycle";
import { createGlobalVoiceShortcutLifecycle, DEFAULT_VOICE_SHORTCUT } from "../src/main/voice/global-voice-shortcut";
import { createGlobalVoiceShortcutController } from "../src/renderer/features/voice/global-voice-shortcut-controller";
import { bindRecordingCancellation } from "../src/renderer/features/voice/recording-cancellation";
import { createSpeechEndDetector, SPEECH_END_SILENCE_MS } from "../src/renderer/features/voice/speech-end-detector";
import { IPC_CHANNELS } from "../src/shared/contracts";

const source = (file: string): string => readFileSync(file, "utf8");

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

describe("main window wiring", () => {
  const main = source("src/main/main.ts");

  it("disables background throttling without touching security, size, or frame options", () => {
    expect(main).toContain("backgroundThrottling: false");
    for (const option of ["contextIsolation: true", "nodeIntegration: false", "sandbox: true", "webSecurity: true", "width: 440", "height: 440", "maximizable: false", "fullscreenable: false"]) {
      expect(main).toContain(option);
    }
    expect(main).not.toMatch(/frame:\s*false|alwaysOnTop|skipTaskbar/);
  });

});

describe("global shortcut in background operation", () => {
  const enabled = { enabled: true, shortcut: DEFAULT_VOICE_SHORTCUT } as const;

  it("triggers the same renderer start path as tapping the orb", () => {
    const app = source("src/renderer/app/App.tsx");
    expect(app).toContain("startRecording: () => { void startRecording(true); }");
    expect(app).toContain("onStartRecording={() => void startRecording()}");
    const start = vi.fn();
    const stop = vi.fn();
    const controller = createGlobalVoiceShortcutController({ getState: () => "IDLE", startRecording: start, stopRecording: stop });
    controller.activate();
    expect(start).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("microphone opens only after an explicit activation", () => {
  const app = source("src/renderer/app/App.tsx");

  it("requests the microphone in exactly one place, inside the start path", () => {
    expect(app.match(/browserMedia.getUserMedia/g)).toHaveLength(1);
    const startIndex = app.indexOf("const startRecording");
    const mediaIndex = app.indexOf("browserMedia.getUserMedia");
    const nextBlock = app.indexOf("const updateVoicePreferences");
    expect(mediaIndex).toBeGreaterThan(startIndex);
    expect(mediaIndex).toBeLessThan(nextBlock);
  });

  it("starts only from the orb tap or the shortcut event, never automatically", () => {
    const callers = app.match(/startRecording\(/g) ?? [];
    expect(callers.length).toBe(2);
    expect(app).toContain("onStartRecording={() => void startRecording()}");
    expect(app).toContain("void startRecording(true)");
    expect(app).not.toMatch(/useEffect\(\(\) => \{\s*void startRecording/u);
    for (const file of ["src/renderer/features/voice/manual-voice-recorder.ts", "src/renderer/features/voice/speech-end-detector.ts"]) {
      expect(source(file)).not.toMatch(/wake word|wakeWord|continuous/i);
    }
  });

  it("keeps the bounded recording duration and the silence timeout", () => {
    expect(app).toContain("maximumDurationMs: 10_000");
    expect(SPEECH_END_SILENCE_MS).toBe(1_700);
  });
});

describe("minimize and hide do not cancel an active session", () => {
  it("ignores visibility and blur, while Escape and teardown still cancel and discard", () => {
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    const cancel = vi.fn();
    const cleanup = bindRecordingCancellation(documentTarget, windowTarget, cancel);
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("blur"));
    windowTarget.dispatchEvent(new Event("resize"));
    expect(cancel).not.toHaveBeenCalled();
    documentTarget.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    documentTarget.dispatchEvent(Object.assign(new Event("keydown"), { key: "Enter" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    windowTarget.dispatchEvent(new Event("pagehide"));
    expect(cancel).toHaveBeenCalledTimes(2);
    cleanup();
    windowTarget.dispatchEvent(new Event("pagehide"));
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("keeps the explicit orb cancel wired and no longer passes a hidden-state callback", () => {
    const app = source("src/renderer/app/App.tsx");
    expect(app).toContain("bindRecordingCancellation(document, window, cancelRecording)");
    expect(app).not.toContain("document.hidden");
    expect(app).toContain("onCancelRecording={cancelRecording}");
  });

  it("keeps spoken responses playing while minimized, stopping only on Escape or teardown", () => {
    const controls = source("src/renderer/features/voice/response-speech-controls.tsx");
    expect(controls).not.toContain("visibilitychange");
    expect(controls).not.toContain("document.hidden");
    expect(controls).toContain('event.key === "Escape"');
    expect(controls).toContain('window.addEventListener("pagehide", controller.stop)');
    expect(controls).toContain("hidden: false");
  });
});
