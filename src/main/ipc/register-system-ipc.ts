import { app, ipcMain, systemPreferences } from "electron";
import { normalizeMicrophoneAccess } from "../../shared/voice-diagnostics";
import { IPC_CHANNELS } from "../../shared/contracts";
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
    return getSystemCapabilitiesResult();
  });

  handlersRegistered = true;
};
