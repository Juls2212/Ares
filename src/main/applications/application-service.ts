import {
  APPLICATION_ERROR_CODES,
  type ApplicationErrorCode,
  type ApplicationListData,
  type ApplicationMutationData,
  type ApplicationOperationResult,
  type ApplicationRecord
} from "../../shared/application-contracts";
import {
  validateApplicationAlias,
  validateApplicationListInput,
  validateRegisterApplicationInput,
  validateUpdateApplicationInput
} from "./application-validation";
import {
  createApplicationRepositories,
  ApplicationRepositoryError,
  type ApplicationRepositories,
  type ResolvedApplicationTarget
} from "./application-repositories";

export type ApplicationService = {
  registerApplication: (
    input: unknown
  ) => Promise<ApplicationOperationResult<ApplicationMutationData>>;
  listApplications: (input: unknown) => Promise<ApplicationOperationResult<ApplicationListData>>;
  updateApplication: (
    input: unknown
  ) => Promise<ApplicationOperationResult<ApplicationMutationData>>;
  resolveEnabledApplicationByAlias: (
    alias: unknown
  ) => Promise<ApplicationOperationResult<ResolvedApplicationTarget>>;
};

type ApplicationServiceDependencies = {
  repositories: ApplicationRepositories;
  logError: (message: string) => void;
};

const serviceMessages: Record<ApplicationErrorCode, string> = {
  APPLICATION_INPUT_INVALID: "La información de la aplicación no es válida.",
  APPLICATION_UNKNOWN_FIELD: "La solicitud contiene campos no permitidos.",
  APPLICATION_REQUIRED_FIELD_MISSING: "Faltan datos requeridos de la aplicación.",
  APPLICATION_FIELD_TYPE_INVALID: "Uno de los campos de la aplicación tiene un formato no válido.",
  APPLICATION_TEXT_INVALID: "Uno de los textos requeridos no es válido.",
  APPLICATION_TEXT_TOO_LONG: "Uno de los textos supera la longitud permitida.",
  APPLICATION_IDENTIFIER_INVALID: "Uno de los identificadores no es válido.",
  APPLICATION_PLATFORM_INVALID: "La plataforma de la aplicación no es válida.",
  APPLICATION_EXECUTABLE_PATH_INVALID: "La ruta del ejecutable no es válida.",
  APPLICATION_EXECUTABLE_NOT_FOUND: "No se encontró el ejecutable de la aplicación registrada.",
  APPLICATION_EXECUTABLE_NOT_FILE: "El ejecutable registrado no es un archivo válido.",
  APPLICATION_EXECUTABLE_EXTENSION_INVALID: "El archivo registrado no es un ejecutable válido.",
  APPLICATION_LAUNCH_FAILED: "No se pudo abrir la aplicación registrada.",
  APPLICATION_DUPLICATE_ALIAS: "Los alias de la aplicación no pueden repetirse.",
  APPLICATION_UPDATE_EMPTY: "Debes indicar al menos un cambio para actualizar.",
  APPLICATION_NOT_FOUND: "No se encontró la aplicación solicitada.",
  APPLICATION_DISABLED: "La aplicación está deshabilitada.",
  APPLICATION_CONFLICT: "Ya existe una aplicación o alias con esos datos.",
  APPLICATION_DATABASE_UNAVAILABLE: "No se pudo acceder al catálogo de aplicaciones.",
  APPLICATION_IPC_UNAVAILABLE: "No se pudo procesar la solicitud de aplicaciones."
};

const createFailure = <T>(code: ApplicationErrorCode): ApplicationOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: serviceMessages[code] }
});

const createSuccess = <T>(data: T): ApplicationOperationResult<T> => ({ ok: true, data });

export const createApplicationService = (
  overrides: Partial<ApplicationServiceDependencies> = {}
): ApplicationService => {
  const dependencies: ApplicationServiceDependencies = {
    repositories: overrides.repositories ?? createApplicationRepositories(),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };

  const mapPersistenceFailure = <T>(error: unknown): ApplicationOperationResult<T> => {
    if (error instanceof ApplicationRepositoryError && error.kind === "CONFLICT") {
      return createFailure(APPLICATION_ERROR_CODES.conflict);
    }
    dependencies.logError("Application catalog persistence operation failed.");
    return createFailure(APPLICATION_ERROR_CODES.databaseUnavailable);
  };

  return {
    registerApplication: async (input) => {
      const validation = validateRegisterApplicationInput(input);
      if (!validation.ok) return validation;
      try {
        if (await dependencies.repositories.findApplicationIdByNormalizedName(validation.data.name)) {
          return createFailure(APPLICATION_ERROR_CODES.conflict);
        }
        return createSuccess({
          record: await dependencies.repositories.registerApplication(validation.data)
        });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    listApplications: async (input) => {
      const validation = validateApplicationListInput(input);
      if (!validation.ok) return validation;
      try {
        const items = await dependencies.repositories.listApplications(validation.data);
        return createSuccess({ items, total: items.length });
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    updateApplication: async (input) => {
      const validation = validateUpdateApplicationInput(input);
      if (!validation.ok) return validation;
      try {
        if (validation.data.name !== undefined) {
          const existingId = await dependencies.repositories.findApplicationIdByNormalizedName(
            validation.data.name
          );
          if (existingId !== undefined && existingId !== validation.data.applicationId) {
            return createFailure(APPLICATION_ERROR_CODES.conflict);
          }
        }
        const record = await dependencies.repositories.updateApplication(validation.data);
        return record
          ? createSuccess({ record })
          : createFailure(APPLICATION_ERROR_CODES.notFound);
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    },
    resolveEnabledApplicationByAlias: async (alias) => {
      const validation = validateApplicationAlias(alias);
      if (!validation.ok) return validation;
      try {
        const target = await dependencies.repositories.resolveApplicationByAlias(validation.data);
        if (!target) return createFailure(APPLICATION_ERROR_CODES.notFound);
        if (!target.isEnabled) return createFailure(APPLICATION_ERROR_CODES.disabled);
        return createSuccess(target);
      } catch (error) {
        return mapPersistenceFailure(error);
      }
    }
  };
};
