import type { OperationResult } from "./contracts";

export const VOICE_SHORTCUTS = [
  "CommandOrControl+Alt+Space",
  "CommandOrControl+Shift+Space",
  "CommandOrControl+Alt+V"
] as const;

export type VoiceShortcut = (typeof VOICE_SHORTCUTS)[number];

export type VoicePreferences = {
  enabled: boolean;
  shortcut: VoiceShortcut;
};

export type VoiceShortcutEffectiveStatus = "ACTIVE" | "DISABLED" | "UNAVAILABLE";

export type VoicePreferencesData = {
  preferences: VoicePreferences;
  effectiveStatus: VoiceShortcutEffectiveStatus;
};

export type UpdateVoicePreferencesInput = VoicePreferences;

export const SETTINGS_ERROR_CODES = {
  preferencesInvalid: "VOICE_PREFERENCES_INVALID",
  shortcutUnavailable: "VOICE_SHORTCUT_UNAVAILABLE",
  persistenceUnavailable: "VOICE_PREFERENCES_UNAVAILABLE",
  ipcUnavailable: "SETTINGS_IPC_UNAVAILABLE"
} as const;

export type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[keyof typeof SETTINGS_ERROR_CODES];
export type SettingsOperationResult<T> = OperationResult<T>;

export type SettingsApi = {
  voice: {
    get: () => Promise<SettingsOperationResult<VoicePreferencesData>>;
    update: (input: UpdateVoicePreferencesInput) => Promise<SettingsOperationResult<VoicePreferencesData>>;
  };
};
