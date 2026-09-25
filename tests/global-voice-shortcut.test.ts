import { describe, expect, it, vi } from "vitest";

import {
  createGlobalVoiceShortcutLifecycle,
  DEFAULT_VOICE_SHORTCUT
} from "../src/main/voice/global-voice-shortcut";
import { IPC_CHANNELS } from "../src/shared/contracts";
import type { VoicePreferences } from "../src/shared/settings-contracts";

const enabled = (shortcut = DEFAULT_VOICE_SHORTCUT): VoicePreferences => ({ enabled: true, shortcut });

describe("Main global voice shortcut", () => {
  it("registers an approved accelerator, focuses the trusted window, and sends only a no-payload signal", () => {
    let callback: (() => void) | undefined;
    const register = vi.fn((_accelerator: string, next: () => void) => { callback = next; return true; });
    const unregister = vi.fn();
    const send = vi.fn();
    const restore = vi.fn();
    const show = vi.fn();
    const focus = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register, unregister },
      getMainWindow: () => ({ isDestroyed: () => false, isMinimized: () => true, isVisible: () => false, restore, show, focus, webContents: { isDestroyed: () => false, send } }),
      logError: vi.fn()
    });
    expect(lifecycle.apply(enabled())).toEqual({ ok: true, effectiveStatus: "ACTIVE" });
    expect(lifecycle.apply(enabled())).toEqual({ ok: true, effectiveStatus: "ACTIVE" });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(DEFAULT_VOICE_SHORTCUT, expect.any(Function));
    callback?.();
    expect(restore).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.voice.globalShortcutActivated);
    expect(send.mock.calls[0]).toHaveLength(1);
    lifecycle.stop(); lifecycle.stop();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledWith(DEFAULT_VOICE_SHORTCUT);
  });

  it("preserves the working shortcut when a replacement registration fails", () => {
    const alternate = "CommandOrControl+Alt+V" as const;
    const register = vi.fn((shortcut: string) => shortcut !== alternate);
    const unregister = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register, unregister },
      getMainWindow: () => undefined,
      logError: vi.fn()
    });
    lifecycle.apply(enabled());
    expect(lifecycle.apply(enabled(alternate))).toEqual({ ok: false, effectiveStatus: "UNAVAILABLE" });
    expect(unregister).not.toHaveBeenCalled();
    expect(lifecycle.getEffectiveStatus()).toBe("ACTIVE");
  });

  it("unregisters only the active Ares shortcut when disabled", () => {
    const unregister = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register: vi.fn(() => true), unregister },
      getMainWindow: () => undefined,
      logError: vi.fn()
    });
    lifecycle.apply(enabled("CommandOrControl+Shift+Space"));
    expect(lifecycle.apply({ enabled: false, shortcut: "CommandOrControl+Shift+Space" })).toEqual({ ok: true, effectiveStatus: "DISABLED" });
    expect(unregister).toHaveBeenCalledWith("CommandOrControl+Shift+Space");
    expect(lifecycle.getEffectiveStatus()).toBe("DISABLED");
  });

  it("ignores missing or destroyed windows without invoking Electron window APIs", () => {
    let callback: (() => void) | undefined;
    const send = vi.fn();
    const show = vi.fn();
    const focus = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register: vi.fn((_accelerator, next) => { callback = next; return true; }), unregister: vi.fn() },
      getMainWindow: () => ({
        isDestroyed: () => true,
        isMinimized: () => false,
        isVisible: () => false,
        restore: vi.fn(),
        show,
        focus,
        webContents: { isDestroyed: () => true, send }
      }),
      logError: vi.fn()
    });
    lifecycle.apply(enabled());
    expect(() => callback?.()).not.toThrow();
    expect(show).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("contains shutdown exceptions without throwing", () => {
    const logError = vi.fn();
    const lifecycle = createGlobalVoiceShortcutLifecycle({
      globalShortcut: { register: vi.fn(() => true), unregister: vi.fn(() => { throw new Error("private"); }) },
      getMainWindow: () => undefined,
      logError
    });
    lifecycle.apply(enabled());
    expect(() => lifecycle.stop()).not.toThrow();
    expect(logError).toHaveBeenCalledWith("Voice global shortcut shutdown failed.");
  });
});
