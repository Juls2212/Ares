import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../../shared/contracts";
import { THEME_FAILURES, parseThemeSetPreferenceInput, type ThemeOperationResult } from "../../shared/theme-contracts";
import type { ThemePreferenceService } from "../settings/theme-preference-service";

export type ThemeIpcHandler = (input: unknown, event: unknown) => Promise<ThemeOperationResult>;
export type ThemeIpcHandlerRegistrar = (channel: string, handler: ThemeIpcHandler) => void;

type ThemeIpcDependencies = {
  registerHandler: ThemeIpcHandlerRegistrar;
  /** The same service the tray menu uses: one code path sets, applies, persists and refreshes the tray. */
  getService: () => ThemePreferenceService;
  /** True only for the trusted main window and its top frame. */
  isTrustedSender: (event: unknown) => boolean;
  logError: (message: string) => void;
};

export const createThemeIpcRegistration = (dependencies: ThemeIpcDependencies): (() => void) => {
  let registered = false;
  return (): void => {
    if (registered) return;
    registered = true;
    dependencies.registerHandler(IPC_CHANNELS.theme.setPreference, async (input, event) => {
      try {
        if (!dependencies.isTrustedSender(event)) return THEME_FAILURES.failure("THEME_UNAVAILABLE");
        const preference = parseThemeSetPreferenceInput(input);
        if (!preference) return THEME_FAILURES.failure("THEME_PREFERENCE_INVALID");
        const status = await dependencies.getService().set(preference);
        // The theme is applied for this session even when saving failed; the service logged one fixed line.
        return status === "SAVED" ? { ok: true } : THEME_FAILURES.failure(status === "NOT_SAVED" ? "THEME_NOT_SAVED" : "THEME_PREFERENCE_INVALID");
      } catch {
        dependencies.logError("Theme preference IPC handler failed.");
        return THEME_FAILURES.failure("THEME_UNAVAILABLE");
      }
    });
  };
};

export const registerThemeIpcHandlers = (getService: () => ThemePreferenceService, isTrustedSender: (event: unknown) => boolean): void =>
  createThemeIpcRegistration({
    registerHandler: (channel, handler) => { ipcMain.handle(channel, (event, input: unknown) => handler(input, event)); },
    getService,
    isTrustedSender,
    logError: (message) => console.error(message)
  })();
