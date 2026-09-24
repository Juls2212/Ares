import { dialog } from "electron";
import path from "node:path";
import { realpath as resolveRealPath, stat as readPathStats } from "node:fs/promises";

import {
  APPLICATION_ERROR_CODES,
  type ApplicationErrorCode,
  type ApplicationOperationResult,
  type ApplicationRecord,
  type ChromeRegistrationData
} from "../../shared/application-contracts";
import { validateExecutablePath } from "./application-validation";
import { getApplicationService } from "./application-composition";
import type { ApplicationService } from "./application-service";

type NativeDialogResult = { canceled: boolean; filePaths: string[] };
type PathStats = { isFile: () => boolean };

type ChromeRegistrationDependencies = {
  showOpenDialog: () => Promise<NativeDialogResult>;
  realpath: (selectedPath: string) => Promise<string>;
  stat: (canonicalPath: string) => Promise<PathStats>;
  applicationService: ApplicationService;
  logError: (message: string) => void;
};

export type ChromeRegistrationService = {
  registerChrome: () => Promise<ApplicationOperationResult<ChromeRegistrationData>>;
};

const chromeName = "Google Chrome";
const chromeAlias = "chrome";

const messages: Record<
  "APPLICATION_CHROME_SELECTION_INVALID" | "APPLICATION_CHROME_PICKER_UNAVAILABLE",
  string
> = {
  APPLICATION_CHROME_SELECTION_INVALID: "Debes seleccionar el archivo chrome.exe de Google Chrome.",
  APPLICATION_CHROME_PICKER_UNAVAILABLE: "No se pudo abrir el selector de Google Chrome."
};

const createFailure = <T>(
  code: "APPLICATION_CHROME_SELECTION_INVALID" | "APPLICATION_CHROME_PICKER_UNAVAILABLE"
): ApplicationOperationResult<T> => ({ ok: false, error: { code, userMessage: messages[code] } });

const createSuccess = <T>(data: T): ApplicationOperationResult<T> => ({ ok: true, data });

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

const defaultDialog = (): Promise<NativeDialogResult> =>
  dialog.showOpenDialog({
    title: "Selecciona chrome.exe",
    buttonLabel: "Seleccionar Google Chrome",
    properties: ["openFile"],
    filters: [{ name: "Google Chrome (chrome.exe)", extensions: ["exe"] }]
  });

/** Main-only registration for one fixed, user-selected browser executable. */
export const createChromeRegistrationService = (
  overrides: Partial<ChromeRegistrationDependencies> = {}
): ChromeRegistrationService => {
  const dependencies: ChromeRegistrationDependencies = {
    showOpenDialog: overrides.showOpenDialog ?? defaultDialog,
    realpath: overrides.realpath ?? resolveRealPath,
    stat: overrides.stat ?? readPathStats,
    applicationService: overrides.applicationService ?? getApplicationService(),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };

  const findExistingChrome = async (): Promise<ApplicationOperationResult<ApplicationRecord | undefined>> => {
    const listed = await dependencies.applicationService.listApplications({ limit: 100 });
    if (!listed.ok) return listed;
    const chromeRecord = listed.data.items.find(
      (record) =>
        normalize(record.name) === normalize(chromeName) &&
        record.aliases.some((item) => normalize(item.alias) === chromeAlias)
    );
    const conflictingRecord = listed.data.items.find(
      (record) =>
        normalize(record.name) === normalize(chromeName) ||
        record.aliases.some((item) => normalize(item.alias) === chromeAlias)
    );
    if (conflictingRecord && !chromeRecord) {
      return {
        ok: false,
        error: {
          code: APPLICATION_ERROR_CODES.conflict,
          userMessage: "Ya existe una aplicación o alias con esos datos."
        }
      };
    }
    return createSuccess(chromeRecord);
  };

  return {
    registerChrome: async () => {
      const existing = await findExistingChrome();
      if (!existing.ok) return existing;
      if (existing.data) return createSuccess({ status: "ALREADY_REGISTERED", record: existing.data });

      let selection: NativeDialogResult;
      try {
        selection = await dependencies.showOpenDialog();
      } catch {
        dependencies.logError("Chrome registration picker failed.");
        return createFailure(APPLICATION_ERROR_CODES.chromePickerUnavailable);
      }
      if (selection.canceled) return createSuccess({ status: "CANCELLED" });
      if (selection.filePaths.length !== 1 || typeof selection.filePaths[0] !== "string") {
        return createFailure(APPLICATION_ERROR_CODES.chromeSelectionInvalid);
      }

      let canonicalPath: string;
      try {
        canonicalPath = await dependencies.realpath(selection.filePaths[0]);
      } catch {
        dependencies.logError("Chrome registration path resolution failed.");
        return createFailure(APPLICATION_ERROR_CODES.chromeSelectionInvalid);
      }
      if (path.basename(canonicalPath).toLocaleLowerCase("en-US") !== "chrome.exe") {
        return createFailure(APPLICATION_ERROR_CODES.chromeSelectionInvalid);
      }
      const pathValidation = validateExecutablePath(canonicalPath);
      if (!pathValidation.ok) return createFailure(APPLICATION_ERROR_CODES.chromeSelectionInvalid);
      try {
        if (!(await dependencies.stat(canonicalPath)).isFile()) {
          return createFailure(APPLICATION_ERROR_CODES.chromeSelectionInvalid);
        }
      } catch {
        dependencies.logError("Chrome registration path inspection failed.");
        return createFailure(APPLICATION_ERROR_CODES.chromeSelectionInvalid);
      }

      const registered = await dependencies.applicationService.registerApplication({
        name: chromeName,
        executablePath: pathValidation.data,
        aliases: [chromeAlias],
        platform: "WINDOWS",
        isEnabled: true
      });
      if (!registered.ok) {
        if (registered.error.code !== APPLICATION_ERROR_CODES.conflict) return registered;
        const existingAfterConflict = await findExistingChrome();
        if (!existingAfterConflict.ok) return existingAfterConflict;
        return existingAfterConflict.data
          ? createSuccess({ status: "ALREADY_REGISTERED", record: existingAfterConflict.data })
          : registered;
      }
      return createSuccess({ status: "REGISTERED", record: registered.data.record });
    }
  };
};
