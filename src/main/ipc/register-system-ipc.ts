import { app, ipcMain, systemPreferences } from "electron";
import { normalizeMicrophoneAccess } from "../../shared/voice-diagnostics";
import { IPC_CHANNELS } from "../../shared/contracts";
import { getOpenAiSpeechConfiguration } from "../config/openai-environment";
import { getSystemCapabilitiesResult, getSystemStatusResult } from "../system/system-service";

let handlersRegistered = false;

export const registerSystemIpcHandlers = (): void => {
  if (handlersRegistered) {
    return;
  }

  ipcMain.handle(IPC_CHANNELS.system.getStatus, async () => {
    return getSystemStatusResult(() => ({
      applicationName: app.getName(),
      applicationVersion: app.getVersion(),
      runtimePlatform: process.platform
    }), () => normalizeMicrophoneAccess(systemPreferences.getMediaAccessStatus("microphone")));
  });

  ipcMain.handle(IPC_CHANNELS.system.getCapabilities, async () => {
    // Transcription needs only the OpenAI key; the check reads the same configuration the transcription itself will read.
    return getSystemCapabilitiesResult(() => {
      getOpenAiSpeechConfiguration();
      return true;
    });
  });

  handlersRegistered = true;
};
