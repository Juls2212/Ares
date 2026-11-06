import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createGlobalVoiceShortcutLifecycle, DEFAULT_VOICE_SHORTCUT } from "../src/main/voice/global-voice-shortcut";
import { IPC_CHANNELS } from "../src/shared/contracts";
import { VOICE_SHORTCUTS, formatShortcutForDisplay } from "../src/shared/settings-contracts";

const source = (file: string): string => readFileSync(file, "utf8");

describe("the registered shortcut and its fixed list", () => {
  it("is selected from a fixed list and shown in its display form", () => {
    expect([...VOICE_SHORTCUTS]).toEqual(["CommandOrControl+Alt+Space", "CommandOrControl+Shift+Space", "CommandOrControl+Alt+V"]);
    expect(VOICE_SHORTCUTS.map(formatShortcutForDisplay)).toEqual(["Ctrl+Alt+Space", "Ctrl+Shift+Space", "Ctrl+Alt+V"]);
    expect(DEFAULT_VOICE_SHORTCUT).toBe("CommandOrControl+Alt+Space");
    expect(source("src/main/settings/voice-preferences-service.ts")).toContain("enabled: true");
  });

  it("reports the active accelerator and notifies on every apply and stop", () => {
    const onChange = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
      getMainWindow: () => undefined,
      logError: vi.fn(),
      onChange
    });
    expect(lifecycle.getActiveShortcut()).toBeUndefined();
    lifecycle.apply({ enabled: true, shortcut: DEFAULT_VOICE_SHORTCUT });
    expect(lifecycle.getActiveShortcut()).toBe("CommandOrControl+Alt+Space");
    lifecycle.apply({ enabled: false, shortcut: DEFAULT_VOICE_SHORTCUT });
    expect(lifecycle.getActiveShortcut()).toBeUndefined();
    lifecycle.stop();
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("reports no shortcut when registration failed and survives a throwing listener", () => {
    const logError = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register: vi.fn(() => false), unregister: vi.fn() },
      getMainWindow: () => undefined,
      logError,
      onChange: () => { throw new Error("private C:\\detail"); }
    });
    expect(lifecycle.apply({ enabled: true, shortcut: DEFAULT_VOICE_SHORTCUT })).toEqual({ ok: false, effectiveStatus: "UNAVAILABLE" });
    expect(lifecycle.getActiveShortcut()).toBeUndefined();
    expect(logError).toHaveBeenCalledWith("Voice global shortcut registration failed.");
    expect(logError).toHaveBeenCalledWith("Voice global shortcut change notification failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private|Users/);
  });
});

describe("global shortcut activation and failure handling", () => {
  const enabled = { enabled: true, shortcut: DEFAULT_VOICE_SHORTCUT } as const;

  it("shows a hidden window and sends the same no-payload activation signal", () => {
    let callback: (() => void) | undefined;
    const send = vi.fn();
    const show = vi.fn();
    const focus = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register: vi.fn((_accelerator: string, next: () => void) => { callback = next; return true; }), unregister: vi.fn() },
      getMainWindow: () => ({
        isDestroyed: () => false, isMinimized: () => false, isVisible: () => false,
        restore: vi.fn(), show, focus, webContents: { isDestroyed: () => false, send }
      }),
      logError: vi.fn()
    });
    expect(lifecycle.apply(enabled)).toEqual({ ok: true, effectiveStatus: "ACTIVE" });
    callback?.();
    expect(show).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.voice.globalShortcutActivated);
    expect(send.mock.calls[0]).toHaveLength(1);
  });

  it("uses the existing fixed default accelerator, defined as a Main constant", () => {
    expect(DEFAULT_VOICE_SHORTCUT).toBe("CommandOrControl+Alt+Space");
  });

  it.each([
    ["registration returns false", () => false],
    ["registration throws", () => { throw new Error("private C:\\detail"); }]
  ])("degrades gracefully when %s", (_name, register) => {
    const logError = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register, unregister: vi.fn() },
      getMainWindow: () => undefined,
      logError
    });
    expect(lifecycle.apply(enabled)).toEqual({ ok: false, effectiveStatus: "UNAVAILABLE" });
    expect(lifecycle.getEffectiveStatus()).toBe("UNAVAILABLE");
    expect(logError).toHaveBeenCalledWith("Voice global shortcut registration failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/private|Users/);
  });

  it("is cleaned up when the application quits", () => {
    const unregister = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register: vi.fn(() => true), unregister },
      getMainWindow: () => undefined,
      logError: vi.fn()
    });
    lifecycle.apply(enabled);
    lifecycle.stop();
    expect(unregister).toHaveBeenCalledWith(DEFAULT_VOICE_SHORTCUT);
  });
});
