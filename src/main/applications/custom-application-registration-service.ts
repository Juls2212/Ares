import { dialog } from "electron";
import { realpath as resolveRealPath, stat as readPathStats } from "node:fs/promises";
import path from "node:path";

import {
  APPLICATION_ERROR_CODES,
  type ApplicationOperationResult,
  type ApplicationRecord,
  type CustomApplicationRegistrationData,
  type RegisterCustomApplicationInput
} from "../../shared/application-contracts";
import {
  validateApplicationAlias,
  validateCustomApplicationDisplayName,
  validateExecutablePath
} from "./application-validation";
import { getApplicationService } from "./application-composition";
import type { ApplicationService } from "./application-service";

type NativeDialogResult = { canceled: boolean; filePaths: string[] };
type NativeConfirmationResult = { response: number };
type PathStats = { isFile: () => boolean };

type CustomApplicationRegistrationDependencies = {
  showOpenDialog: () => Promise<NativeDialogResult>;
  showConfirmation: (displayName: string, executableBasename: string) => Promise<NativeConfirmationResult>;
  realpath: (selectedPath: string) => Promise<string>;
  stat: (canonicalPath: string) => Promise<PathStats>;
  applicationService: ApplicationService;
  logError: (message: string) => void;
};

export type CustomApplicationRegistrationService = {
  registerCustomApplication: (
    input: unknown
  ) => Promise<ApplicationOperationResult<CustomApplicationRegistrationData>>;
};

const customMessages = {
  [APPLICATION_ERROR_CODES.inputInvalid]: "El nombre de la aplicación no es válido.",
  [APPLICATION_ERROR_CODES.fieldTypeInvalid]: "El nombre de la aplicación no es válido.",
  [APPLICATION_ERROR_CODES.textInvalid]: "El nombre de la aplicación no es válido.",
  [APPLICATION_ERROR_CODES.textTooLong]: "El nombre de la aplicación supera la longitud permitida.",
  [APPLICATION_ERROR_CODES.customSelectionInvalid]: "Debes seleccionar un archivo ejecutable válido.",
  [APPLICATION_ERROR_CODES.customPickerUnavailable]: "No se pudo abrir el selector de aplicaciones.",
  [APPLICATION_ERROR_CODES.customConfirmationUnavailable]:
    "No se pudo confirmar el registro de la aplicación.",
  [APPLICATION_ERROR_CODES.conflict]: "Ya existe una aplicación o alias con esos datos.",
  [APPLICATION_ERROR_CODES.databaseUnavailable]:
    "No se pudo acceder al catálogo de aplicaciones."
} as const;

type CustomRegistrationErrorCode = keyof typeof customMessages;

const failure = <T>(code: CustomRegistrationErrorCode): ApplicationOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: customMessages[code] }
});

const success = <T>(data: T): ApplicationOperationResult<T> => ({ ok: true, data });

const mapApplicationFailure = <T>(
  result: ApplicationOperationResult<unknown>
): ApplicationOperationResult<T> =>
  failure(
    result.ok || result.error.code !== APPLICATION_ERROR_CODES.conflict
      ? APPLICATION_ERROR_CODES.databaseUnavailable
      : APPLICATION_ERROR_CODES.conflict
  );

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

const deriveAlias = (displayName: string): ApplicationOperationResult<string> => {
  const alias = displayName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[ ._\-]+/gu, "-")
    .replace(/[^a-z0-9-]/gu, "")
    .replace(/^-+|-+$/gu, "");
  return validateApplicationAlias(alias);
};

const validateInput = (
  input: unknown
): ApplicationOperationResult<RegisterCustomApplicationInput & { alias: string }> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure(APPLICATION_ERROR_CODES.inputInvalid);
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "displayName") {
    return failure(APPLICATION_ERROR_CODES.inputInvalid);
  }
  const displayName = validateCustomApplicationDisplayName(
    (input as { displayName?: unknown }).displayName
  );
  if (!displayName.ok) {
    return failure(displayName.error.code as CustomRegistrationErrorCode);
  }
  const alias = deriveAlias(displayName.data);
  if (!alias.ok) return failure(alias.error.code as CustomRegistrationErrorCode);
  return success({ displayName: displayName.data, alias: alias.data });
};

const defaultPicker = (): Promise<NativeDialogResult> =>
  dialog.showOpenDialog({
    title: "Selecciona un archivo ejecutable",
    buttonLabel: "Seleccionar aplicación",
    properties: ["openFile"],
    filters: [{ name: "Aplicaciones ejecutables", extensions: ["exe"] }]
  });

const defaultConfirmation = (
  displayName: string,
  executableBasename: string
): Promise<NativeConfirmationResult> =>
  dialog.showMessageBox({
    type: "question",
    title: "Confirmar registro de aplicación",
    message: `¿Registrar ${displayName}?`,
    detail: `Se registrará el ejecutable ${executableBasename}.`,
    buttons: ["Cancelar", "Registrar"],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  });

/** Main-only registration of a user-named executable with a derived, trusted alias. */
export const createCustomApplicationRegistrationService = (
  overrides: Partial<CustomApplicationRegistrationDependencies> = {}
): CustomApplicationRegistrationService => {
  const dependencies: CustomApplicationRegistrationDependencies = {
    showOpenDialog: overrides.showOpenDialog ?? defaultPicker,
    showConfirmation: overrides.showConfirmation ?? defaultConfirmation,
    realpath: overrides.realpath ?? resolveRealPath,
    stat: overrides.stat ?? readPathStats,
    applicationService: overrides.applicationService ?? getApplicationService(),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };

  const findExisting = async (
    displayName: string,
    alias: string
  ): Promise<ApplicationOperationResult<ApplicationRecord | undefined>> => {
    const listed = await dependencies.applicationService.listApplications({ limit: 100 });
    if (!listed.ok) return mapApplicationFailure(listed);
    const exact = listed.data.items.find(
      (record) =>
        normalize(record.name) === normalize(displayName) &&
        record.aliases.some((entry) => normalize(entry.alias) === normalize(alias))
    );
    const conflict = listed.data.items.find(
      (record) =>
        normalize(record.name) === normalize(displayName) ||
        record.aliases.some((entry) => normalize(entry.alias) === normalize(alias))
    );
    if (conflict && !exact) {
      return {
        ok: false,
        error: {
          code: APPLICATION_ERROR_CODES.conflict,
          userMessage: "Ya existe una aplicación o alias con esos datos."
        }
      };
    }
    return success(exact);
  };

  return {
    registerCustomApplication: async (input) => {
      const validInput = validateInput(input);
      if (!validInput.ok) return validInput;
      const { displayName, alias } = validInput.data;

      const existing = await findExisting(displayName, alias);
      if (!existing.ok) return existing;
      if (existing.data) return success({ status: "ALREADY_REGISTERED" });

      let selection: NativeDialogResult;
      try {
        selection = await dependencies.showOpenDialog();
      } catch {
        dependencies.logError("Custom application registration picker failed.");
        return failure(APPLICATION_ERROR_CODES.customPickerUnavailable);
      }
      if (selection.canceled) return success({ status: "CANCELLED" });
      if (selection.filePaths.length !== 1 || typeof selection.filePaths[0] !== "string") {
        return failure(APPLICATION_ERROR_CODES.customSelectionInvalid);
      }

      let canonicalPath: string;
      try {
        canonicalPath = await dependencies.realpath(selection.filePaths[0]);
      } catch {
        dependencies.logError("Custom application registration path resolution failed.");
        return failure(APPLICATION_ERROR_CODES.customSelectionInvalid);
      }
      if (path.extname(canonicalPath).toLocaleLowerCase("en-US") !== ".exe") {
        return failure(APPLICATION_ERROR_CODES.customSelectionInvalid);
      }
      const executablePath = validateExecutablePath(canonicalPath);
      if (!executablePath.ok) return failure(APPLICATION_ERROR_CODES.customSelectionInvalid);
      try {
        if (!(await dependencies.stat(canonicalPath)).isFile()) {
          return failure(APPLICATION_ERROR_CODES.customSelectionInvalid);
        }
      } catch {
        dependencies.logError("Custom application registration path inspection failed.");
        return failure(APPLICATION_ERROR_CODES.customSelectionInvalid);
      }

      try {
        const confirmation = await dependencies.showConfirmation(displayName, path.basename(canonicalPath));
        if (confirmation.response !== 1) return success({ status: "CANCELLED" });
      } catch {
        dependencies.logError("Custom application registration confirmation failed.");
        return failure(APPLICATION_ERROR_CODES.customConfirmationUnavailable);
      }

      const registered = await dependencies.applicationService.registerApplication({
        name: displayName,
        executablePath: executablePath.data,
        aliases: [alias],
        platform: "WINDOWS",
        isEnabled: true
      });
      if (!registered.ok) return mapApplicationFailure(registered);
      return success({ status: "REGISTERED" });
    }
  };
};
