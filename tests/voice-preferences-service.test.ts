import { describe, expect, it, vi } from "vitest";

import { createVoicePreferencesService } from "../src/main/settings/voice-preferences-service";
import type { VoicePreferencesRepository } from "../src/main/settings/voice-preferences-repository";
import type { GlobalVoiceShortcutLifecycle } from "../src/main/voice/global-voice-shortcut";

const fixture = (overrides: {
  stored?: unknown;
  apply?: GlobalVoiceShortcutLifecycle["apply"];
  save?: VoicePreferencesRepository["save"];
} = {}) => {
  const repository: VoicePreferencesRepository = {
    get: vi.fn(async () => overrides.stored),
    save: overrides.save ?? vi.fn(async () => undefined)
  };
  const shortcutLifecycle: GlobalVoiceShortcutLifecycle = {
    apply: overrides.apply ?? vi.fn(() => ({ ok: true as const, effectiveStatus: "ACTIVE" as const })),
    stop: vi.fn(),
    getEffectiveStatus: vi.fn(() => "ACTIVE" as const)
  };
  return {
    service: createVoicePreferencesService({ repository, shortcutLifecycle, logError: vi.fn() }),
    repository,
    shortcutLifecycle
  };
};

describe("voice preferences service", () => {
  it("uses the enabled default without creating a settings record", async () => {
    const { service, repository, shortcutLifecycle } = fixture();
    await expect(service.initialize()).resolves.toEqual({
      ok: true,
      data: {
        preferences: { enabled: true, shortcut: "CommandOrControl+Alt+Space" },
        effectiveStatus: "ACTIVE"
      }
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(shortcutLifecycle.apply).toHaveBeenCalledWith({ enabled: true, shortcut: "CommandOrControl+Alt+Space" });
  });

  it("applies a stored disabled preference without registering a shortcut", async () => {
    const apply = vi.fn(() => ({ ok: true as const, effectiveStatus: "DISABLED" as const }));
    const { service, shortcutLifecycle } = fixture({
      stored: { enabled: false, shortcut: "CommandOrControl+Shift+Space" },
      apply
    });
    await expect(service.initialize()).resolves.toEqual({
      ok: true,
      data: {
        preferences: { enabled: false, shortcut: "CommandOrControl+Shift+Space" },
        effectiveStatus: "DISABLED"
      }
    });
    expect(shortcutLifecycle.apply).toHaveBeenCalledWith({
      enabled: false,
      shortcut: "CommandOrControl+Shift+Space"
    });
  });

  it("reports an unavailable stored enabled shortcut without changing its persisted preference", async () => {
    const { service, repository } = fixture({
      stored: { enabled: true, shortcut: "CommandOrControl+Alt+V" },
      apply: vi.fn(() => ({ ok: false as const, effectiveStatus: "UNAVAILABLE" as const }))
    });
    await expect(service.initialize()).resolves.toEqual({
      ok: true,
      data: {
        preferences: { enabled: true, shortcut: "CommandOrControl+Alt+V" },
        effectiveStatus: "UNAVAILABLE"
      }
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rejects unsupported keys, arbitrary accelerators, and invalid values", async () => {
    const { service, repository } = fixture();
    for (const input of [
      { enabled: true, shortcut: "Control+Shift+F12" },
      { enabled: true, shortcut: "CommandOrControl+Alt+Space", extra: true },
      { enabled: "true", shortcut: "CommandOrControl+Alt+Space" },
      { enabled: true }
    ]) {
      const result = await service.update(input);
      expect(result).toMatchObject({ ok: false, error: { code: "VOICE_PREFERENCES_INVALID" } });
    }
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("persists only a successfully applied approved preference", async () => {
    const { service, repository, shortcutLifecycle } = fixture();
    const result = await service.update({ enabled: true, shortcut: "CommandOrControl+Alt+V" });
    expect(result).toEqual({
      ok: true,
      data: {
        preferences: { enabled: true, shortcut: "CommandOrControl+Alt+V" },
        effectiveStatus: "ACTIVE"
      }
    });
    expect(shortcutLifecycle.apply).toHaveBeenCalledWith({ enabled: true, shortcut: "CommandOrControl+Alt+V" });
    expect(repository.save).toHaveBeenCalledWith({ enabled: true, shortcut: "CommandOrControl+Alt+V" });
  });

  it("does not persist an unavailable replacement and preserves the previous preference", async () => {
    const apply = vi.fn()
      .mockReturnValueOnce({ ok: false as const, effectiveStatus: "UNAVAILABLE" as const });
    const { service, repository } = fixture({
      stored: { enabled: true, shortcut: "CommandOrControl+Alt+Space" },
      apply
    });
    const result = await service.update({ enabled: true, shortcut: "CommandOrControl+Shift+Space" });
    expect(result).toMatchObject({ ok: false, error: { code: "VOICE_SHORTCUT_UNAVAILABLE" } });
    expect(repository.save).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledOnce();
  });

  it("unregisters through the lifecycle when the saved preference is disabled", async () => {
    const apply = vi.fn((preferences) => ({
      ok: true as const,
      effectiveStatus: preferences.enabled ? "ACTIVE" as const : "DISABLED" as const
    }));
    const { service, shortcutLifecycle, repository } = fixture({ apply });
    await expect(service.update({ enabled: false, shortcut: "CommandOrControl+Alt+V" })).resolves.toMatchObject({
      ok: true,
      data: { effectiveStatus: "DISABLED" }
    });
    expect(shortcutLifecycle.apply).toHaveBeenCalledWith({ enabled: false, shortcut: "CommandOrControl+Alt+V" });
    expect(repository.save).toHaveBeenCalledWith({ enabled: false, shortcut: "CommandOrControl+Alt+V" });
  });

  it("rolls back the working preference when persistence fails", async () => {
    const save = vi.fn(async () => { throw new Error("private database detail"); });
    const apply = vi.fn(() => ({ ok: true as const, effectiveStatus: "ACTIVE" as const }));
    const { service } = fixture({
      stored: { enabled: true, shortcut: "CommandOrControl+Alt+Space" },
      save,
      apply
    });
    const result = await service.update({ enabled: true, shortcut: "CommandOrControl+Alt+V" });
    expect(result).toMatchObject({ ok: false, error: { code: "VOICE_PREFERENCES_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain("private database detail");
    expect(apply).toHaveBeenNthCalledWith(1, { enabled: true, shortcut: "CommandOrControl+Alt+V" });
    expect(apply).toHaveBeenNthCalledWith(2, { enabled: true, shortcut: "CommandOrControl+Alt+Space" });
  });
});
