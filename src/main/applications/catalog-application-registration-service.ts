import { dialog } from "electron";
import { realpath as resolveRealPath, stat as readPathStats } from "node:fs/promises";
import path from "node:path";

import {
  APPLICATION_ERROR_CODES,
  REGISTERABLE_CATALOG_APPLICATIONS,
  type ApplicationOperationResult,
  type ApplicationRecord,
  type CatalogApplicationRegistrationData,
  type RegisterCatalogApplicationInput,
  type RegisterableCatalogApplication
} from "../../shared/application-contracts";
import { validateExecutablePath } from "./application-validation";
import { getApplicationService } from "./application-composition";
import type { ApplicationService } from "./application-service";

type NativeDialogResult = { canceled: boolean; filePaths: string[] };
type PathStats = { isFile: () => boolean };

type CatalogApplicationDefinition = {
  displayName: string;
  alias: string;
  expectedExecutableName: string;
};

type CatalogApplicationRegistrationDependencies = {
  showOpenDialog: (definition: CatalogApplicationDefinition) => Promise<NativeDialogResult>;
  realpath: (selectedPath: string) => Promise<string>;
  stat: (canonicalPath: string) => Promise<PathStats>;
  applicationService: ApplicationService;
  logError: (message: string) => void;
};

export type CatalogApplicationRegistrationService = {
  registerCatalogApplication: (
    input: unknown
  ) => Promise<ApplicationOperationResult<CatalogApplicationRegistrationData>>;
};

const catalog: Record<RegisterableCatalogApplication, CatalogApplicationDefinition> = {
  GOOGLE_CHROME: {
    displayName: "Google Chrome",
    alias: "chrome",
    expectedExecutableName: "chrome.exe"
  },
  VISUAL_STUDIO_CODE: {
    displayName: "Visual Studio Code",
    alias: "vscode",
    expectedExecutableName: "Code.exe"
  },
  VISUAL_STUDIO: {
    displayName: "Visual Studio",
    alias: "visualstudio",
    expectedExecutableName: "devenv.exe"
  },
  SPOTIFY: {
    displayName: "Spotify",
    alias: "spotify",
    expectedExecutableName: "Spotify.exe"
  }
};

const messages = {
  [APPLICATION_ERROR_CODES.inputInvalid]: "La aplicación seleccionada no es válida.",
  [APPLICATION_ERROR_CODES.catalogSelectionInvalid]:
    "Debes seleccionar el archivo ejecutable correcto de la aplicación.",
  [APPLICATION_ERROR_CODES.catalogPickerUnavailable]:
    "No se pudo abrir el selector de aplicaciones."
} as const;

const createFailure = <T>(
  code:
    | typeof APPLICATION_ERROR_CODES.inputInvalid
    | typeof APPLICATION_ERROR_CODES.catalogSelectionInvalid
    | typeof APPLICATION_ERROR_CODES.catalogPickerUnavailable
): ApplicationOperationResult<T> => ({ ok: false, error: { code, userMessage: messages[code] } });

const createSuccess = <T>(data: T): ApplicationOperationResult<T> => ({ ok: true, data });

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

const isCatalogApplication = (value: unknown): value is RegisterableCatalogApplication =>
  typeof value === "string" &&
  (REGISTERABLE_CATALOG_APPLICATIONS as readonly string[]).includes(value);

const validateInput = (
  input: unknown
): ApplicationOperationResult<RegisterCatalogApplicationInput> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return createFailure(APPLICATION_ERROR_CODES.inputInvalid);
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "application") {
    return createFailure(APPLICATION_ERROR_CODES.inputInvalid);
  }
  const application = (input as { application?: unknown }).application;
  if (!isCatalogApplication(application)) {
    return createFailure(APPLICATION_ERROR_CODES.inputInvalid);
  }
  return createSuccess({ application });
};

const defaultDialog = (definition: CatalogApplicationDefinition): Promise<NativeDialogResult> =>
  dialog.showOpenDialog({
    title: `Selecciona ${definition.expectedExecutableName}`,
    buttonLabel: "Seleccionar aplicación",
    properties: ["openFile"],
    filters: [
      {
        name: `${definition.displayName} (${definition.expectedExecutableName})`,
        extensions: ["exe"]
      }
    ]
  });

/** Main-only registration of applications from the closed built-in catalog. */
export const createCatalogApplicationRegistrationService = (
  overrides: Partial<CatalogApplicationRegistrationDependencies> = {}
): CatalogApplicationRegistrationService => {
  const dependencies: CatalogApplicationRegistrationDependencies = {
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

  const findExisting = async (
    definition: CatalogApplicationDefinition
  ): Promise<ApplicationOperationResult<ApplicationRecord | undefined>> => {
    const listed = await dependencies.applicationService.listApplications({ limit: 100 });
    if (!listed.ok) return listed;
    const exactRecord = listed.data.items.find(
      (record) =>
        normalize(record.name) === normalize(definition.displayName) &&
        record.aliases.some((item) => normalize(item.alias) === definition.alias)
    );
    const conflictingRecord = listed.data.items.find(
      (record) =>
        normalize(record.name) === normalize(definition.displayName) ||
        record.aliases.some((item) => normalize(item.alias) === definition.alias)
    );
    if (conflictingRecord && !exactRecord) {
      return {
        ok: false,
        error: {
          code: APPLICATION_ERROR_CODES.conflict,
          userMessage: "Ya existe una aplicación o alias con esos datos."
        }
      };
    }
    return createSuccess(exactRecord);
  };

  return {
    registerCatalogApplication: async (input) => {
      const validInput = validateInput(input);
      if (!validInput.ok) return validInput;
      const { application } = validInput.data;
      const definition = catalog[application];
      const existing = await findExisting(definition);
      if (!existing.ok) return existing;
      if (existing.data) {
        return createSuccess({ status: "ALREADY_REGISTERED", application, record: existing.data });
      }

      let selection: NativeDialogResult;
      try {
        selection = await dependencies.showOpenDialog(definition);
      } catch {
        dependencies.logError("Catalog application registration picker failed.");
        return createFailure(APPLICATION_ERROR_CODES.catalogPickerUnavailable);
      }
      if (selection.canceled) return createSuccess({ status: "CANCELLED", application });
      if (selection.filePaths.length !== 1 || typeof selection.filePaths[0] !== "string") {
        return createFailure(APPLICATION_ERROR_CODES.catalogSelectionInvalid);
      }

      let canonicalPath: string;
      try {
        canonicalPath = await dependencies.realpath(selection.filePaths[0]);
      } catch {
        dependencies.logError("Catalog application registration path resolution failed.");
        return createFailure(APPLICATION_ERROR_CODES.catalogSelectionInvalid);
      }
      if (
        normalize(path.basename(canonicalPath)) !== normalize(definition.expectedExecutableName)
      ) {
        return createFailure(APPLICATION_ERROR_CODES.catalogSelectionInvalid);
      }
      const pathValidation = validateExecutablePath(canonicalPath);
      if (!pathValidation.ok) return createFailure(APPLICATION_ERROR_CODES.catalogSelectionInvalid);
      try {
        if (!(await dependencies.stat(canonicalPath)).isFile()) {
          return createFailure(APPLICATION_ERROR_CODES.catalogSelectionInvalid);
        }
      } catch {
        dependencies.logError("Catalog application registration path inspection failed.");
        return createFailure(APPLICATION_ERROR_CODES.catalogSelectionInvalid);
      }

      const registered = await dependencies.applicationService.registerApplication({
        name: definition.displayName,
        executablePath: pathValidation.data,
        aliases: [definition.alias],
        platform: "WINDOWS",
        isEnabled: true
      });
      if (!registered.ok) {
        if (registered.error.code !== APPLICATION_ERROR_CODES.conflict) return registered;
        const existingAfterConflict = await findExisting(definition);
        if (!existingAfterConflict.ok) return existingAfterConflict;
        return existingAfterConflict.data
          ? createSuccess({
              status: "ALREADY_REGISTERED",
              application,
              record: existingAfterConflict.data
            })
          : registered;
      }
      return createSuccess({ status: "REGISTERED", application, record: registered.data.record });
    }
  };
};
