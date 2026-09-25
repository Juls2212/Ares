import {
  SETTINGS_ERROR_CODES,
  VOICE_SHORTCUTS,
  type SettingsOperationResult,
  type VoicePreferences,
  type VoicePreferencesData
} from "../../shared/settings-contracts";
import type { GlobalVoiceShortcutLifecycle } from "../voice/global-voice-shortcut";
import {
  VoicePreferencesRepositoryError,
  type VoicePreferencesRepository
} from "./voice-preferences-repository";

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  enabled: true,
  shortcut: "CommandOrControl+Alt+Space"
};

export type VoicePreferencesService = {
  initialize: () => Promise<SettingsOperationResult<VoicePreferencesData>>;
  get: () => Promise<SettingsOperationResult<VoicePreferencesData>>;
  update: (input: unknown) => Promise<SettingsOperationResult<VoicePreferencesData>>;
};

type VoicePreferencesServiceDependencies = {
  repository: VoicePreferencesRepository;
  shortcutLifecycle: GlobalVoiceShortcutLifecycle;
  logError: (message: string) => void;
};

const failure = <T>(code: string, userMessage: string): SettingsOperationResult<T> => ({
  ok: false,
  error: { code, userMessage }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const validateVoicePreferences = (
  value: unknown
): SettingsOperationResult<VoicePreferences> => {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, "enabled") || !Object.hasOwn(value, "shortcut")) {
    return failure(SETTINGS_ERROR_CODES.preferencesInvalid, "La configuración de voz no es válida.");
  }
  if (typeof value.enabled !== "boolean" || typeof value.shortcut !== "string" || !VOICE_SHORTCUTS.includes(value.shortcut as VoicePreferences["shortcut"])) {
    return failure(SETTINGS_ERROR_CODES.preferencesInvalid, "La configuración de voz no es válida.");
  }
  return { ok: true, data: { enabled: value.enabled, shortcut: value.shortcut as VoicePreferences["shortcut"] } };
};

const shortcutUnavailable = <T>(): SettingsOperationResult<T> =>
  failure(SETTINGS_ERROR_CODES.shortcutUnavailable, "El atajo seleccionado no está disponible.");

const persistenceUnavailable = <T>(): SettingsOperationResult<T> =>
  failure(SETTINGS_ERROR_CODES.persistenceUnavailable, "La configuración de voz no está disponible.");

/** Coordinates validated JSONB preferences with the single Main-only global shortcut owner. */
export const createVoicePreferencesService = (
  overrides: Partial<VoicePreferencesServiceDependencies> = {}
): VoicePreferencesService => {
  if (!overrides.repository || !overrides.shortcutLifecycle) {
    throw new Error("Voice preferences service requires repository and shortcut lifecycle dependencies.");
  }
  const dependencies: VoicePreferencesServiceDependencies = {
    repository: overrides.repository,
    shortcutLifecycle: overrides.shortcutLifecycle,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  const readPreferences = async (): Promise<SettingsOperationResult<VoicePreferences>> => {
    try {
      const stored = await dependencies.repository.get();
      if (stored === undefined) return { ok: true, data: DEFAULT_VOICE_PREFERENCES };
      return validateVoicePreferences(stored);
    } catch (error) {
      if (error instanceof VoicePreferencesRepositoryError) {
        dependencies.logError("Voice preferences retrieval failed.");
      }
      return persistenceUnavailable();
    }
  };

  const withEffectiveStatus = (preferences: VoicePreferences): VoicePreferencesData => ({
    preferences,
    effectiveStatus: dependencies.shortcutLifecycle.getEffectiveStatus()
  });

  return {
    initialize: async (): Promise<SettingsOperationResult<VoicePreferencesData>> => {
      const preferences = await readPreferences();
      if (!preferences.ok) {
        const fallback = dependencies.shortcutLifecycle.apply(DEFAULT_VOICE_PREFERENCES);
        if (!fallback.ok) dependencies.logError("Default voice shortcut registration failed.");
        return persistenceUnavailable();
      }
      const applied = dependencies.shortcutLifecycle.apply(preferences.data);
      if (!applied.ok) {
        return { ok: true, data: { preferences: preferences.data, effectiveStatus: "UNAVAILABLE" } };
      }
      return { ok: true, data: { preferences: preferences.data, effectiveStatus: applied.effectiveStatus } };
    },
    get: async (): Promise<SettingsOperationResult<VoicePreferencesData>> => {
      const preferences = await readPreferences();
      if (!preferences.ok) return preferences;
      return { ok: true, data: withEffectiveStatus(preferences.data) };
    },
    update: async (input: unknown): Promise<SettingsOperationResult<VoicePreferencesData>> => {
      const next = validateVoicePreferences(input);
      if (!next.ok) return next;
      const current = await readPreferences();
      if (!current.ok) return current;

      const applied = dependencies.shortcutLifecycle.apply(next.data);
      if (!applied.ok) return shortcutUnavailable();

      try {
        await dependencies.repository.save(next.data);
      } catch (error) {
        const restored = dependencies.shortcutLifecycle.apply(current.data);
        if (!restored.ok) dependencies.logError("Voice shortcut restoration failed.");
        if (error instanceof VoicePreferencesRepositoryError) {
          dependencies.logError("Voice preferences persistence failed.");
        }
        return persistenceUnavailable();
      }
      return { ok: true, data: { preferences: next.data, effectiveStatus: applied.effectiveStatus } };
    }
  };
};
