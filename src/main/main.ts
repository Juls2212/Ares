import { app, BrowserWindow, globalShortcut, session } from "electron";
import path from "node:path";
import { registerActionIpcHandlers } from "./ipc/register-action-ipc";
import { registerAssistantIpcHandlers } from "./ipc/register-assistant-ipc";
import { registerApplicationIpcHandlers } from "./ipc/register-application-ipc";
import { registerDashboardIpcHandlers } from "./ipc/register-dashboard-ipc";
import { registerPlannerIpcHandlers } from "./ipc/register-planner-ipc";
import { registerSettingsIpcHandlers } from "./ipc/register-settings-ipc";
import { registerSystemIpcHandlers } from "./ipc/register-system-ipc";
import { registerVoiceIpcHandlers } from "./ipc/register-voice-ipc";
import { getReminderDeliveryScheduler } from "./reminders/reminder-composition";
import { registerReminderDeliveryShutdown } from "./reminders/register-reminder-delivery-lifecycle";
import {
  isTrustedAudioMicrophoneRequest
} from "./voice/microphone-permission";
import { createGlobalVoiceShortcutLifecycle } from "./voice/global-voice-shortcut";
import { configureVoicePreferencesService } from "./settings/voice-preferences-composition";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const trustedRendererWebContents = new Set<number>();
let mainWindow: BrowserWindow | undefined;

const globalVoiceShortcutLifecycle = createGlobalVoiceShortcutLifecycle({
  globalShortcut,
  getMainWindow: () => mainWindow,
  logError: (message) => console.error(message)
});

const configureSessionSecurity = (): void => {
  const isTrustedRendererRequest = (
    webContents: Electron.WebContents | null,
    requestingUrlOrOrigin: string,
    isMainFrame: boolean,
    mediaTypes: readonly unknown[] | undefined
  ): boolean => {
    if (!webContents) return false;
    try {
      return !webContents.isDestroyed() && isTrustedAudioMicrophoneRequest({
        trustedWebContentsIds: trustedRendererWebContents,
        webContentsId: webContents.id,
        loadedUrl: webContents.getURL(),
        requestingUrlOrOrigin,
        isMainFrame,
        mediaTypes
      });
    } catch {
      return false;
    }
  };

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    permission === "media" && isTrustedRendererRequest(
      webContents,
      details.securityOrigin ?? requestingOrigin,
      details.isMainFrame,
      [details.mediaType]
    )
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    callback(
      permission === "media" && isTrustedRendererRequest(
        webContents,
        details.requestingUrl,
        details.isMainFrame,
        mediaTypes
      )
    );
  });
};

const createMainWindow = async (): Promise<void> => {
  const createdWindow = new BrowserWindow({
    width: 900,
    height: 620,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.js")
    }
  });
  mainWindow = createdWindow;
  const createdWebContents = createdWindow.webContents;
  const createdWebContentsId = createdWebContents.id;
  trustedRendererWebContents.add(createdWebContentsId);
  createdWebContents.once("destroyed", () => {
    trustedRendererWebContents.delete(createdWebContentsId);
  });
  createdWindow.on("closed", () => {
    trustedRendererWebContents.delete(createdWebContentsId);
    if (mainWindow === createdWindow) mainWindow = undefined;
  });

  createdWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  createdWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  createdWindow.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await createdWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  await createdWindow.loadFile(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
  );
};

app.whenReady().then(async () => {
  configureSessionSecurity();
  registerSystemIpcHandlers();
  registerPlannerIpcHandlers();
  registerActionIpcHandlers();
  registerAssistantIpcHandlers();
  registerVoiceIpcHandlers();
  const voicePreferencesService = configureVoicePreferencesService(globalVoiceShortcutLifecycle);
  registerSettingsIpcHandlers();
  registerApplicationIpcHandlers();
  registerDashboardIpcHandlers();
  registerReminderDeliveryShutdown(app);
  getReminderDeliveryScheduler().start();
  const voicePreferences = await voicePreferencesService.initialize();
  if (!voicePreferences.ok) {
    console.error("Voice preferences startup initialization failed.");
  }
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.once("before-quit", () => {
  globalVoiceShortcutLifecycle.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
