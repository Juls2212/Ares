/**
 * Main-only background operation: a tray icon with a two-item Spanish menu, close-to-tray, and a
 * single-instance lock. It never opens the microphone and owns no audio, shortcut, or IPC logic.
 */
export const TRAY_LABELS = Object.freeze({
  open: "Abrir Ares",
  quit: "Salir",
  tooltip: "Ares"
});

type CloseEventLike = { preventDefault: () => void };

export type ManagedWindow = {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
  hide: () => void;
  on: (event: "close" | "session-end", listener: (event: CloseEventLike) => void) => unknown;
};

export type ManagedTray = {
  /** Windows only; absent or failing balloons degrade silently. */
  displayBalloon?: (options: { title: string; content: string }) => void;
  setToolTip: (tooltip: string) => void;
  setContextMenu: (menu: unknown) => void;
  on: (event: "click", listener: () => void) => unknown;
  destroy: () => void;
};

export type TrayMenuItem =
  | { label: string; click: () => void }
  | { type: "separator" };

export type BackgroundLifecycleDependencies = {
  app: {
    requestSingleInstanceLock: () => boolean;
    quit: () => void;
    on: (event: "second-instance" | "before-quit", listener: () => void) => unknown;
  };
  getMainWindow: () => ManagedWindow | undefined;
  createMainWindow: () => Promise<void>;
  createTray: () => ManagedTray;
  buildMenu: (items: TrayMenuItem[]) => unknown;
  logError: (message: string) => void;
  /** The display form of the active global shortcut, or undefined when none is registered. */
  getShortcutLabel?: () => string | undefined;
};

export type BackgroundLifecycle = {
  /** Acquires the single-instance lock; false means another instance owns it and this one must exit. */
  start: () => boolean;
  /** Creates the tray; call once after the application is ready. */
  createTray: () => void;
  /** Hides the window to the tray on close unless the application is really quitting. */
  attachWindow: (window: ManagedWindow) => void;
  showMainWindow: () => void;
  /** Rebuilds the tray menu and tooltip, for example after the shortcut changes. */
  refreshTray: () => void;
  quit: () => void;
  isQuitting: () => boolean;
  isTrayAvailable: () => boolean;
  dispose: () => void;
};

export const createBackgroundLifecycle = (dependencies: BackgroundLifecycleDependencies): BackgroundLifecycle => {
  let quitting = false;
  let tray: ManagedTray | undefined;
  let started = false;
  let hideNoticeShown = false;

  const shortcutLabel = (): string | undefined => {
    try {
      return dependencies.getShortcutLabel?.();
    } catch {
      return undefined;
    }
  };

  const quit = (): void => {
    quitting = true;
    dependencies.app.quit();
  };

  const showMainWindow = (): void => {
    try {
      const mainWindow = dependencies.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        void dependencies.createMainWindow().catch(() => {
          dependencies.logError("Main window recreation failed.");
        });
        return;
      }
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } catch {
      dependencies.logError("Showing the main window failed.");
    }
  };

  const trayTooltip = (): string => {
    const label = shortcutLabel();
    return label ? `${TRAY_LABELS.tooltip} — Atajo: ${label}` : TRAY_LABELS.tooltip;
  };

  const buildTrayMenu = (): unknown => {
    const label = shortcutLabel();
    return dependencies.buildMenu([
      { label: label ? `${TRAY_LABELS.open} (${label})` : TRAY_LABELS.open, click: showMainWindow },
      { type: "separator" },
      { label: TRAY_LABELS.quit, click: quit }
    ]);
  };

  const dispose = (): void => {
    const current = tray;
    tray = undefined;
    if (!current) return;
    try {
      current.destroy();
    } catch {
      dependencies.logError("Tray cleanup failed.");
    }
  };


  return {
    start: () => {
      if (started) return true;
      if (!dependencies.app.requestSingleInstanceLock()) return false;
      started = true;
      dependencies.app.on("second-instance", showMainWindow);
      dependencies.app.on("before-quit", () => {
        quitting = true;
        dispose();
      });
      return true;
    },
    createTray: () => {
      if (tray) return;
      try {
        const created = dependencies.createTray();
        created.setToolTip(trayTooltip());
        created.setContextMenu(buildTrayMenu());
        created.on("click", showMainWindow);
        tray = created;
      } catch {
        // Without a tray, closing the window must keep quitting so the app is never invisible and unreachable.
        dependencies.logError("Tray creation failed.");
      }
    },
    refreshTray: () => {
      if (!tray) return;
      try {
        tray.setToolTip(trayTooltip());
        tray.setContextMenu(buildTrayMenu());
      } catch {
        dependencies.logError("Tray refresh failed.");
      }
    },
    attachWindow: (window) => {
      window.on("close", (event) => {
        if (quitting || !tray) return;
        event.preventDefault();
        window.hide();
        // One non-blocking notice per session, so closing never looks like quitting.
        if (hideNoticeShown) return;
        hideNoticeShown = true;
        try {
          const label = shortcutLabel();
          tray.displayBalloon?.({
            title: TRAY_LABELS.tooltip,
            content: label ? `Ares sigue activo en la bandeja. Atajo: ${label}.` : "Ares sigue activo en la bandeja."
          });
        } catch {
          // Unsupported or disabled notifications degrade silently.
        }
      });
      window.on("session-end", () => {
        quitting = true;
      });
    },
    showMainWindow,
    quit,
    isQuitting: () => quitting,
    isTrayAvailable: () => tray !== undefined,
    dispose
  };
};

/**
 * Generates the tray icon in code (a ringed disc) as a BGRA bitmap, so no binary asset or dependency
 * is needed. The result is deterministic for a given size.
 */
export const createTrayIconBitmap = (size = 32): Buffer => {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const outer = size * 0.46;
  const ring = size * 0.34;
  const core = size * 0.2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const offset = (y * size + x) * 4;
      // BGRA order; the accent is a cyan-blue consistent with the orb.
      if (distance <= core) {
        pixels.set([255, 200, 90, 255], offset);
      } else if (distance <= ring && distance > ring - size * 0.08) {
        pixels.set([255, 200, 90, 255], offset);
      } else if (distance <= outer) {
        pixels.set([60, 36, 20, 235], offset);
      }
    }
  }
  return pixels;
};
