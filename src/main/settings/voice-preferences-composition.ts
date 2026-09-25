import type { GlobalVoiceShortcutLifecycle } from "../voice/global-voice-shortcut";
import { createVoicePreferencesRepository } from "./voice-preferences-repository";
import {
  createVoicePreferencesService,
  type VoicePreferencesService
} from "./voice-preferences-service";

let voicePreferencesService: VoicePreferencesService | undefined;

/** Configured once by Electron Main so IPC and startup share one shortcut owner. */
export const configureVoicePreferencesService = (
  shortcutLifecycle: GlobalVoiceShortcutLifecycle
): VoicePreferencesService => {
  voicePreferencesService ??= createVoicePreferencesService({
    repository: createVoicePreferencesRepository(),
    shortcutLifecycle
  });
  return voicePreferencesService;
};

export const getVoicePreferencesService = (): VoicePreferencesService => {
  if (!voicePreferencesService) {
    throw new Error("Voice preferences service has not been configured.");
  }
  return voicePreferencesService;
};
