import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createSettingsIpcRegistration,
  type SettingsIpcHandler
} from "../src/main/ipc/register-settings-ipc";
import { IPC_CHANNELS } from "../src/shared/contracts";
import type { VoicePreferencesService } from "../src/main/settings/voice-preferences-service";

describe("settings IPC registration", () => {
  it("registers only the explicit voice preference channels once and delegates", async () => {
    const handlers = new Map<string, SettingsIpcHandler>();
    const get = vi.fn(async () => ({ ok: true as const, data: { preferences: { enabled: true, shortcut: "CommandOrControl+Alt+Space" }, effectiveStatus: "ACTIVE" as const } }));
    const update = vi.fn(async () => ({ ok: true as const, data: { preferences: { enabled: false, shortcut: "CommandOrControl+Alt+V" }, effectiveStatus: "DISABLED" as const } }));
    const register = createSettingsIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ get, update } as unknown as VoicePreferencesService),
      logError: vi.fn()
    });
    register(); register();
    expect([...handlers.keys()]).toEqual([IPC_CHANNELS.settings.voice.get, IPC_CHANNELS.settings.voice.update]);
    await handlers.get(IPC_CHANNELS.settings.voice.get)?.();
    await handlers.get(IPC_CHANNELS.settings.voice.update)?.({ enabled: false, shortcut: "CommandOrControl+Alt+V" });
    expect(get).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({ enabled: false, shortcut: "CommandOrControl+Alt+V" });
  });

  it("maps unexpected settings failures without technical leakage", async () => {
    const handlers = new Map<string, SettingsIpcHandler>();
    const secret = "private database detail";
    createSettingsIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ get: async () => { throw new Error(secret); }, update: async () => { throw new Error(secret); } } as unknown as VoicePreferencesService),
      logError: vi.fn()
    })();
    const result = await handlers.get(IPC_CHANNELS.settings.voice.get)?.();
    expect(result).toMatchObject({ ok: false, error: { code: "SETTINGS_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
