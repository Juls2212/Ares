import type { OperationResult } from "./contracts";

export const VOICE_SHORTCUTS = [
  "CommandOrControl+Alt+Space",
  "CommandOrControl+Shift+Space",
  "CommandOrControl+Alt+V"
] as const;

export type VoiceShortcut = (typeof VOICE_SHORTCUTS)[number];

/** Human-readable form of a fixed accelerator, for example «Ctrl+Alt+Space». Display only. */
export const formatShortcutForDisplay = (shortcut: string): string =>
  shortcut
    .split("+")
    .map((part) => (part === "CommandOrControl" || part === "Control" ? "Ctrl" : part === "Command" ? "Cmd" : part === "Option" ? "Alt" : part))
    .join("+");

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
