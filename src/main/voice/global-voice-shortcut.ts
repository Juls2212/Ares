import { IPC_CHANNELS } from "../../shared/contracts";
import type {
  VoicePreferences,
  VoiceShortcut,
  VoiceShortcutEffectiveStatus
} from "../../shared/settings-contracts";

export const DEFAULT_VOICE_SHORTCUT: VoiceShortcut = "CommandOrControl+Alt+Space";

type VoiceShortcutWindow = {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
  webContents: {
    isDestroyed: () => boolean;
    send: (channel: string) => void;
  };
};

type VoiceShortcutDependencies = {
  globalShortcut: {
    register: (accelerator: string, callback: () => void) => boolean;
    unregister: (accelerator: string) => void;
  };
  getMainWindow: () => VoiceShortcutWindow | undefined;
  logError: (message: string) => void;
};

export type GlobalVoiceShortcutLifecycle = {
  apply: (preferences: VoicePreferences) => VoiceShortcutApplicationResult;
  stop: () => void;
  getEffectiveStatus: () => VoiceShortcutEffectiveStatus;
};

export type VoiceShortcutApplicationResult =
  | { ok: true; effectiveStatus: VoiceShortcutEffectiveStatus }
  | { ok: false; effectiveStatus: "UNAVAILABLE" };

/** Main-only fixed accelerator lifecycle. It observes no key data and sends no payload. */
export const createGlobalVoiceShortcutLifecycle = (
  dependencies: VoiceShortcutDependencies
): GlobalVoiceShortcutLifecycle => {
  let activeShortcut: VoiceShortcut | undefined;
  let effectiveStatus: VoiceShortcutEffectiveStatus = "DISABLED";

  const activate = (): void => {
    const mainWindow = dependencies.getMainWindow();
    if (!mainWindow) return;
    try {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.focus();
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.voice.globalShortcutActivated);
    } catch {
      dependencies.logError("Voice global shortcut activation skipped.");
    }
  };

  return {
    apply: (preferences): VoiceShortcutApplicationResult => {
      if (!preferences.enabled) {
        if (!activeShortcut) {
          effectiveStatus = "DISABLED";
          return { ok: true, effectiveStatus };
        }
        try {
          dependencies.globalShortcut.unregister(activeShortcut);
          activeShortcut = undefined;
          effectiveStatus = "DISABLED";
          return { ok: true, effectiveStatus };
        } catch {
          dependencies.logError("Voice global shortcut shutdown failed.");
          effectiveStatus = activeShortcut ? "ACTIVE" : "UNAVAILABLE";
          return { ok: false, effectiveStatus: "UNAVAILABLE" };
        }
      }

      if (activeShortcut === preferences.shortcut) {
        effectiveStatus = "ACTIVE";
        return { ok: true, effectiveStatus };
      }

      let registered = false;
      try {
        registered = dependencies.globalShortcut.register(preferences.shortcut, activate);
      } catch {
        // The fixed registration error below intentionally contains no system detail.
      }
      if (!registered) {
        dependencies.logError("Voice global shortcut registration failed.");
        effectiveStatus = activeShortcut ? "ACTIVE" : "UNAVAILABLE";
        return { ok: false, effectiveStatus: "UNAVAILABLE" };
      }

      if (activeShortcut) {
        try {
          dependencies.globalShortcut.unregister(activeShortcut);
        } catch {
          try {
            dependencies.globalShortcut.unregister(preferences.shortcut);
          } catch {
            dependencies.logError("Voice global shortcut rollback failed.");
          }
          dependencies.logError("Voice global shortcut update failed.");
          effectiveStatus = activeShortcut ? "ACTIVE" : "UNAVAILABLE";
          return { ok: false, effectiveStatus: "UNAVAILABLE" };
        }
      }

      activeShortcut = preferences.shortcut;
      effectiveStatus = "ACTIVE";
      return { ok: true, effectiveStatus };
    },
    stop: (): void => {
      if (!activeShortcut) return;
      try {
        dependencies.globalShortcut.unregister(activeShortcut);
      } catch {
        dependencies.logError("Voice global shortcut shutdown failed.");
      } finally {
        activeShortcut = undefined;
        effectiveStatus = "DISABLED";
      }
    },
    getEffectiveStatus: (): VoiceShortcutEffectiveStatus => effectiveStatus
  };
};
