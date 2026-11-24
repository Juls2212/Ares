import { app, BrowserWindow, globalShortcut, Menu, nativeImage, nativeTheme, session, Tray } from "electron";
import path from "node:path";
import { markPackagedRuntime } from "./config/development-environment";
import { registerActionIpcHandlers } from "./ipc/register-action-ipc";
import { registerAssistantIpcHandlers } from "./ipc/register-assistant-ipc";
import { registerSettingsIpcHandlers } from "./ipc/register-settings-ipc";
import { registerSystemIpcHandlers } from "./ipc/register-system-ipc";
import { registerThemeIpcHandlers } from "./ipc/register-theme-ipc";
import { registerVoiceIpcHandlers } from "./ipc/register-voice-ipc";
import { registerSpeechIpcHandlers } from "./ipc/register-speech-ipc";
import { registerMessagingIpcHandlers } from "./ipc/register-messaging-ipc";
import { configureContactFormSender, shutdownMessaging } from "./messaging/messaging-composition";
import { shutdownSpotify } from "./spotify/spotify-composition";
import { IPC_CHANNELS } from "../shared/contracts";
import { getReminderDeliveryScheduler } from "./reminders/reminder-composition";
import { registerReminderDeliveryShutdown } from "./reminders/register-reminder-delivery-lifecycle";
import {
  isTrustedAudioMicrophoneRequest
} from "./voice/microphone-permission";
import { createGlobalVoiceShortcutLifecycle } from "./voice/global-voice-shortcut";
import { configureVoicePreferencesService } from "./settings/voice-preferences-composition";
import { getApplicationService } from "./applications/application-composition";
import { seedKnownApplications } from "./applications/known-application-seeder";
import { removeFullScreenMenuCommand } from "./compact-window-menu";
import { getTitleBarOverlay, getWindowChrome } from "./window-theme";
import { createThemePreferenceService, createThemePreferenceStore } from "./settings/theme-preference-service";
import { formatShortcutForDisplay } from "../shared/settings-contracts";
import {
  createBackgroundLifecycle,
  createTrayIconBitmap,
  type ManagedWindow
} from "./background/background-lifecycle";

// Before any configuration read: a packaged app reads settings only from the process environment.
markPackagedRuntime(app.isPackaged);

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const trustedRendererWebContents = new Set<number>();
let mainWindow: BrowserWindow | undefined;

/** Window size: a portrait HUD that can be resized down to the minimum. */
const WINDOW_SIZE = { width: 480, height: 740, minWidth: 420, minHeight: 620 } as const;

/** Follows the persisted preference ("system", "light" or "dark") and keeps the window colors in step with it. */
const themePreferenceService = createThemePreferenceService({
  store: createThemePreferenceStore,
  nativeTheme,
  onApplied: () => { applyWindowTheme(); backgroundLifecycle.refreshTray(); },
  logError: (message) => console.error(message)
});

const applyWindowTheme = (): void => {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const chrome = readWindowChrome();
  window.setBackgroundColor(chrome.backgroundColor);
  if (chrome.customTitleBar && typeof window.setTitleBarOverlay === "function") window.setTitleBarOverlay(getTitleBarOverlay(nativeTheme.shouldUseDarkColors));
};

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
      items.map((item) => ("type" in item ? { type: "separator" as const } : "submenu" in item ? { label: item.label, submenu: item.submenu } : { label: item.label, click: item.click }))
    ),
  theme: { current: () => themePreferenceService.get(), choose: (preference) => { void themePreferenceService.set(preference); } },
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

/** Reads only values Electron exposes: platform, Electron version and whether the system uses dark colors. */
const readWindowChrome = () => getWindowChrome({
  platform: process.platform,
  electronVersion: process.versions.electron,
  shouldUseDarkColors: nativeTheme.shouldUseDarkColors
});

const createMainWindow = async (): Promise<void> => {
  const windowChrome = readWindowChrome();
  const createdWindow = new BrowserWindow({
    ...WINDOW_SIZE,
    useContentSize: true,
    maximizable: false,
    fullscreenable: false,
    ...windowChrome.options,
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
  // A solid background that follows the system theme; the title bar overlay follows it too.
  nativeTheme.on("updated", applyWindowTheme);
  createdWindow.once("closed", () => nativeTheme.removeListener("updated", applyWindowTheme));
  // The native menu bar only exists in development, so DevTools stay reachable there.
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  } else {
    const applicationMenu = Menu.getApplicationMenu();
    if (applicationMenu && removeFullScreenMenuCommand(applicationMenu)) Menu.setApplicationMenu(applicationMenu);
  }
  mainWindow = createdWindow;
  applyWindowTheme();
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
  registerActionIpcHandlers();
  registerMessagingIpcHandlers();
  // The contact form is shown by the one trusted window; the renderer receives only a friendly name.
  configureContactFormSender((request) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    backgroundLifecycle.showMainWindow();
    mainWindow.webContents.send(IPC_CHANNELS.messaging.contactFormRequested, request);
    return true;
  });
  registerAssistantIpcHandlers();
  registerVoiceIpcHandlers();
  registerSpeechIpcHandlers();
  const voicePreferencesService = configureVoicePreferencesService(globalVoiceShortcutLifecycle);
  registerSettingsIpcHandlers();
  // The toggle button uses the same service as the tray menu; only the trusted window's top frame may call it.
  registerThemeIpcHandlers(() => themePreferenceService, (event) => {
    const sender = event as Electron.IpcMainInvokeEvent;
    return trustedRendererWebContents.has(sender.sender.id) && sender.senderFrame === sender.sender.mainFrame;
  });
  registerReminderDeliveryShutdown(app);
  getReminderDeliveryScheduler().start();
  const voicePreferences = await voicePreferencesService.initialize();
  if (!voicePreferences.ok) {
    console.error("Voice preferences startup initialization failed.");
  }
  // Bundled first-run data from the trusted catalog; it never throws and is not reachable from IPC or the interpreter.
  await seedKnownApplications({ applicationService: getApplicationService() });
  // The saved theme is applied before the window exists; a database problem leaves the system theme and never fails startup.
  await themePreferenceService.initialize();
  backgroundLifecycle.createTray();
  await createMainWindow();

  app.on("activate", () => {
    backgroundLifecycle.showMainWindow();
  });
});

app.once("before-quit", () => {
  shutdownMessaging();
  shutdownSpotify();
  globalVoiceShortcutLifecycle.stop();
});

// The tray keeps Ares running after the window is hidden; without a tray the last close still quits.
app.on("window-all-closed", () => {
  if (backgroundLifecycle.isQuitting() || (!backgroundLifecycle.isTrayAvailable() && process.platform !== "darwin")) {
    app.quit();
  }
});
