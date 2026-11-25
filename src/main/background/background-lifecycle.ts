/**
 * Main-only application lifecycle: a tray icon with a Spanish menu, one quit path and a single-instance lock.
 *
 * Policy: minimizing the window keeps Ares running in the background (tray, global shortcut, reminders);
 * closing the window (the X button, Alt+F4, the taskbar) quits the application completely. The close event is
 * never intercepted. Every way out (window close, tray "Salir", before-quit, Windows session end) goes through
 * one idempotent shutdown. It never opens the microphone and owns no audio, shortcut, or IPC logic.
 */
export const TRAY_LABELS = Object.freeze({
  open: "Abrir Ares",
  quit: "Salir",
  theme: "Tema",
  tooltip: "Ares"
});

export const THEME_MENU_CHOICES = Object.freeze([
  { value: "system", label: "Automático" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" }
] as const);

type CloseEventLike = { preventDefault: () => void };

export type ManagedWindow = {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
  on: (event: "close" | "session-end", listener: (event: CloseEventLike) => void) => unknown;
};

export type ManagedTray = {
  setToolTip: (tooltip: string) => void;
  setContextMenu: (menu: unknown) => void;
  on: (event: "click", listener: () => void) => unknown;
  destroy: () => void;
};

export type TrayThemeItem = { label: string; type: "radio"; checked: boolean; click: () => void };

export type TrayMenuItem =
  | { label: string; click: () => void }
  | { label: string; submenu: TrayThemeItem[] }
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
  /** Optional theme submenu: the current preference and how to choose another. Absent means no submenu. */
  theme?: { current: () => "system" | "light" | "dark"; choose: (preference: "system" | "light" | "dark") => void };
  /**
   * Main-owned cleanup that runs once, in order, at the start of every shutdown and before the tray is destroyed
   * (for example unregistering the global shortcut). Each step must be synchronous; a failing step is logged and
   * never stops the next one.
   */
  shutdownSteps?: ReadonlyArray<() => void>;
};

export type BackgroundLifecycle = {
  /** Acquires the single-instance lock; false means another instance owns it and this one must exit. */
  start: () => boolean;
  /** Creates the tray; call once after the application is ready. */
  createTray: () => void;
  /** Makes closing the window quit the application; the close event is never prevented. */
  attachWindow: (window: ManagedWindow) => void;
  showMainWindow: () => void;
  /** Rebuilds the tray menu and tooltip, for example after the shortcut changes. */
  refreshTray: () => void;
  /** The one quit path: runs the shutdown once, then asks Electron to quit. Safe to call repeatedly. */
  quit: () => void;
  isQuitting: () => boolean;
  isTrayAvailable: () => boolean;
  dispose: () => void;
};

export const createBackgroundLifecycle = (dependencies: BackgroundLifecycleDependencies): BackgroundLifecycle => {
  let quitting = false;
  let tray: ManagedTray | undefined;
  let started = false;
  let shutdownStarted = false;
  let quitRequested = false;

  const shortcutLabel = (): string | undefined => {
    try {
      return dependencies.getShortcutLabel?.();
    } catch {
      return undefined;
    }
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

  /**
   * Idempotent shutdown shared by every way out: marks the application as quitting, runs the injected cleanup
   * steps in order, then destroys the tray. The asynchronous parts (reminder scheduler, database) are stopped by the
   * before-quit registration in register-reminder-delivery-lifecycle.ts, which Electron runs after this.
   */
  const shutdown = (): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    quitting = true;
    for (const step of dependencies.shutdownSteps ?? []) {
      try {
        step();
      } catch {
        dependencies.logError("Shutdown step failed.");
      }
    }
    dispose();
  };

  const quit = (): void => {
    if (quitRequested) return;
    quitRequested = true;
    shutdown();
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
    const theme = dependencies.theme;
    const themeItems: TrayMenuItem[] = theme
      ? [{
        label: TRAY_LABELS.theme,
        submenu: THEME_MENU_CHOICES.map((choice) => ({
          label: choice.label, type: "radio" as const, checked: theme.current() === choice.value,
          click: () => { theme.choose(choice.value); refreshTray(); }
        }))
      }]
      : [];
    return dependencies.buildMenu([
      { label: label ? `${TRAY_LABELS.open} (${label})` : TRAY_LABELS.open, click: showMainWindow },
      ...themeItems,
      { type: "separator" },
      { label: TRAY_LABELS.quit, click: quit }
    ]);
  };

  function refreshTray(): void {
    if (!tray) return;
    try {
      tray.setToolTip(trayTooltip());
      tray.setContextMenu(buildTrayMenu());
    } catch {
      dependencies.logError("Tray refresh failed.");
    }
  }


  return {
    start: () => {
      if (started) return true;
      if (!dependencies.app.requestSingleInstanceLock()) return false;
      started = true;
      dependencies.app.on("second-instance", showMainWindow);
      // Any quit that did not start here (Windows shutdown, another app.quit()) still runs the same shutdown.
      dependencies.app.on("before-quit", shutdown);
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
        // Without a tray the app still runs; closing the window quits it.
        dependencies.logError("Tray creation failed.");
      }
    },
    refreshTray,
    attachWindow: (window) => {
      // Closing the window quits the app. The event is not prevented, so the window is destroyed normally.
      window.on("close", () => quit());
      // Windows logoff or shutdown: run the synchronous shutdown now; the system is ending the session anyway.
      window.on("session-end", () => shutdown());
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
