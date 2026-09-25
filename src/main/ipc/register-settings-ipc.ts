import { ipcMain } from "electron";

import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  SETTINGS_ERROR_CODES,
  type SettingsOperationResult,
  type VoicePreferencesData
} from "../../shared/settings-contracts";
import { getVoicePreferencesService } from "../settings/voice-preferences-composition";
import type { VoicePreferencesService } from "../settings/voice-preferences-service";

export type SettingsIpcHandler = (input?: unknown) => Promise<OperationResult<unknown>>;
export type SettingsIpcHandlerRegistrar = (channel: string, handler: SettingsIpcHandler) => void;

type SettingsIpcDependencies = {
  registerHandler: SettingsIpcHandlerRegistrar;
  getService: () => VoicePreferencesService;
  logError: (message: string) => void;
};

const unavailable = (): SettingsOperationResult<VoicePreferencesData> => ({
  ok: false,
  error: {
    code: SETTINGS_ERROR_CODES.ipcUnavailable,
    userMessage: "La configuración de voz no está disponible."
  }
});

export const createSettingsIpcRegistration = (
  dependencies: SettingsIpcDependencies
): (() => void) => {
  let registered = false;
  return (): void => {
    if (registered) return;
    dependencies.registerHandler(IPC_CHANNELS.settings.voice.get, async () => {
      try {
        return await dependencies.getService().get();
      } catch {
        dependencies.logError("Voice preferences get IPC handler failed.");
        return unavailable();
      }
    });
    dependencies.registerHandler(IPC_CHANNELS.settings.voice.update, async (input) => {
      try {
        return await dependencies.getService().update(input);
      } catch {
        dependencies.logError("Voice preferences update IPC handler failed.");
        return unavailable();
      }
    });
    registered = true;
  };
};

const registerElectronHandler: SettingsIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, (_event, input: unknown) => handler(input));
};

export const registerSettingsIpcHandlers = createSettingsIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getVoicePreferencesService,
  logError: (message) => console.error(message)
});
