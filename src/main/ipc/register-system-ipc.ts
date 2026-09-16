import { app, ipcMain } from "electron";
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
    }));
  });

  ipcMain.handle(IPC_CHANNELS.system.getCapabilities, async () => {
    return getSystemCapabilitiesResult();
  });

  handlersRegistered = true;
};
