import { app, BrowserWindow, globalShortcut, Menu, nativeImage, session, Tray } from "electron";
import path from "node:path";
import { registerActionIpcHandlers } from "./ipc/register-action-ipc";
import { registerAssistantIpcHandlers } from "./ipc/register-assistant-ipc";
import { registerApplicationIpcHandlers } from "./ipc/register-application-ipc";
import { registerDashboardIpcHandlers } from "./ipc/register-dashboard-ipc";
import { registerHabitIpcHandlers } from "./ipc/register-habit-ipc";
import { registerPlannerIpcHandlers } from "./ipc/register-planner-ipc";
import { registerSettingsIpcHandlers } from "./ipc/register-settings-ipc";
import { registerSystemIpcHandlers } from "./ipc/register-system-ipc";
import { registerVoiceIpcHandlers } from "./ipc/register-voice-ipc";
import { registerSpeechIpcHandlers } from "./ipc/register-speech-ipc";
import { getReminderDeliveryScheduler } from "./reminders/reminder-composition";
import { registerReminderDeliveryShutdown } from "./reminders/register-reminder-delivery-lifecycle";
import {
  isTrustedAudioMicrophoneRequest
} from "./voice/microphone-permission";
import { createGlobalVoiceShortcutLifecycle } from "./voice/global-voice-shortcut";
import { configureVoicePreferencesService } from "./settings/voice-preferences-composition";
import { formatShortcutForDisplay } from "../shared/settings-contracts";
import {
  createBackgroundLifecycle,
  createTrayIconBitmap,
  type ManagedWindow
} from "./background/background-lifecycle";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const trustedRendererWebContents = new Set<number>();
let mainWindow: BrowserWindow | undefined;

const globalVoiceShortcutLifecycle = createGlobalVoiceShortcutLifecycle({
  globalShortcut,
  getMainWindow: () => mainWindow,
  logError: (message) => console.error(message),
  onChange: () => backgroundLifecycle.refreshTray()
});

const toManagedWindow = (window: BrowserWindow): ManagedWindow => ({
  isDestroyed: () => window.isDestroyed(),
  isMinimized: () => window.isMinimized(),
  isVisible: () => window.isVisible(),
  restore: () => window.restore(),
  show: () => window.show(),
  focus: () => window.focus(),
  hide: () => window.hide(),
  on: (event, listener) => {
    if (event === "close") window.on("close", (closeEvent) => listener(closeEvent));
    else window.on("session-end", (sessionEvent) => listener(sessionEvent));
  }
});

/** Tray, close-to-tray and the single-instance lock. It never starts audio capture. */
const backgroundLifecycle = createBackgroundLifecycle({
  app: {
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    quit: () => app.quit(),
    on: (event, listener) => {
      if (event === "second-instance") app.on("second-instance", () => listener());
      else app.on("before-quit", () => listener());
    }
  },
  getMainWindow: () => (mainWindow ? toManagedWindow(mainWindow) : undefined),
  createMainWindow: () => createMainWindow(),
  createTray: () => {
    const tray = new Tray(nativeImage.createFromBitmap(createTrayIconBitmap(32), { width: 32, height: 32 }));
    return {
      setToolTip: (tooltip) => tray.setToolTip(tooltip),
      setContextMenu: (menu) => tray.setContextMenu(menu as Electron.Menu),
      on: (event, listener) => tray.on(event, listener),
      destroy: () => tray.destroy(),
      displayBalloon: (options) => tray.displayBalloon(options)
    };
  },
  getShortcutLabel: () => {
    const active = globalVoiceShortcutLifecycle.getActiveShortcut();
    return active ? formatShortcutForDisplay(active) : undefined;
  },
  buildMenu: (items) =>
    Menu.buildFromTemplate(
      items.map((item) => ("type" in item ? { type: "separator" as const } : { label: item.label, click: item.click }))
    ),
  logError: (message) => console.error(message)
});

const isPrimaryInstance = backgroundLifecycle.start();
if (!isPrimaryInstance) app.quit();

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
      // Recording timers, silence detection and TTS playback must keep running while minimized or hidden.
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  mainWindow = createdWindow;
  backgroundLifecycle.attachWindow(toManagedWindow(createdWindow));
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
    await new Promise<void>((resolve) => {
      createdWebContents.once("did-finish-load", resolve);
      createdWebContents.reloadIgnoringCache();
    });
    return;
  }

  await createdWindow.loadFile(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
  );
};

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  configureSessionSecurity();
  registerSystemIpcHandlers();
  registerPlannerIpcHandlers();
  registerHabitIpcHandlers();
  registerActionIpcHandlers();
  registerAssistantIpcHandlers();
  registerVoiceIpcHandlers();
  registerSpeechIpcHandlers();
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
  backgroundLifecycle.createTray();
  await createMainWindow();

  app.on("activate", () => {
    backgroundLifecycle.showMainWindow();
  });
});

app.once("before-quit", () => {
  globalVoiceShortcutLifecycle.stop();
});

// The tray keeps Ares running after the window is hidden; without a tray the last close still quits.
app.on("window-all-closed", () => {
  if (backgroundLifecycle.isQuitting() || (!backgroundLifecycle.isTrayAvailable() && process.platform !== "darwin")) {
    app.quit();
  }
});
