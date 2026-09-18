import { spawn as spawnProcess } from "node:child_process";
import { realpath as resolveRealPath, stat as readPathStats } from "node:fs/promises";
import {
  APPLICATION_ERROR_CODES,
  type ApplicationOperationResult
} from "../../shared/application-contracts";
import { validateExecutablePath } from "./application-validation";
import { getApplicationService } from "./application-composition";
import type { ApplicationService } from "./application-service";
import type { ResolvedApplicationTarget } from "./application-repositories";

type PathStats = {
  isFile: () => boolean;
};

type SpawnedProcess = {
  once: {
    (event: "error", listener: () => void): SpawnedProcess;
    (event: "spawn", listener: () => void): SpawnedProcess;
  };
  unref: () => void;
};

type ApplicationLauncherDependencies = {
  applicationService: ApplicationService;
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<PathStats>;
  spawn: (
    executablePath: string,
    argumentsList: readonly string[],
    options: {
      detached: true;
      shell: false;
      stdio: "ignore";
      windowsHide: true;
    }
  ) => SpawnedProcess;
  logError: (message: string) => void;
};

export type ApplicationLaunchData = {
  applicationName: string;
};

export type ApplicationLauncher = {
  launchByAlias: (alias: unknown) => Promise<ApplicationOperationResult<ApplicationLaunchData>>;
  launchResolvedTarget: (
    target: ResolvedApplicationTarget
  ) => Promise<ApplicationOperationResult<ApplicationLaunchData>>;
};

const launcherMessages = {
  APPLICATION_EXECUTABLE_PATH_INVALID: "La aplicación registrada tiene una ruta ejecutable no válida.",
  APPLICATION_EXECUTABLE_NOT_FOUND: "No se encontró el ejecutable de la aplicación registrada.",
  APPLICATION_EXECUTABLE_NOT_FILE: "El ejecutable registrado no es un archivo válido.",
  APPLICATION_EXECUTABLE_EXTENSION_INVALID: "El archivo registrado no es un ejecutable válido.",
  APPLICATION_LAUNCH_FAILED: "No se pudo abrir la aplicación registrada.",
  APPLICATION_DISABLED: "La aplicación está deshabilitada."
} as const;

type LauncherErrorCode = keyof typeof launcherMessages;

const createFailure = <T>(code: LauncherErrorCode): ApplicationOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: launcherMessages[code] }
});

const createSuccess = <T>(data: T): ApplicationOperationResult<T> => ({ ok: true, data });

const hasExecutableExtension = (path: string): boolean => /\.exe$/iu.test(path);

const startDetachedProcess = (
  executablePath: string,
  dependencies: ApplicationLauncherDependencies
): Promise<boolean> => {
  try {
    const child = dependencies.spawn(executablePath, [], {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });

    return new Promise((resolve) => {
      let settled = false;
      const settle = (started: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(started);
      };

      child.once("error", () => settle(false));
      child.once("spawn", () => {
        try {
          child.unref();
          settle(true);
        } catch {
          settle(false);
        }
      });
    });
  } catch {
    return Promise.resolve(false);
  }
};

export const createApplicationLauncher = (
  overrides: Partial<ApplicationLauncherDependencies> = {}
): ApplicationLauncher => {
  const dependencies: ApplicationLauncherDependencies = {
    applicationService: overrides.applicationService ?? getApplicationService(),
    realpath: overrides.realpath ?? resolveRealPath,
    stat: overrides.stat ?? readPathStats,
    spawn: overrides.spawn ?? spawnProcess,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };

  const launchResolvedTarget = async (
    target: ResolvedApplicationTarget
  ): Promise<ApplicationOperationResult<ApplicationLaunchData>> => {
    if (!target.isEnabled) return createFailure(APPLICATION_ERROR_CODES.disabled);

    const pathValidation = validateExecutablePath(target.executablePath);
    if (!pathValidation.ok) {
      return createFailure(APPLICATION_ERROR_CODES.executablePathInvalid);
    }

    let canonicalPath: string;
    try {
      canonicalPath = await dependencies.realpath(pathValidation.data);
    } catch {
      dependencies.logError("Registered application executable path resolution failed.");
      return createFailure("APPLICATION_EXECUTABLE_NOT_FOUND");
    }

    if (!hasExecutableExtension(canonicalPath)) {
      return createFailure("APPLICATION_EXECUTABLE_EXTENSION_INVALID");
    }

    try {
      const stats = await dependencies.stat(canonicalPath);
      if (!stats.isFile()) return createFailure("APPLICATION_EXECUTABLE_NOT_FILE");
    } catch {
      dependencies.logError("Registered application executable path inspection failed.");
      return createFailure("APPLICATION_EXECUTABLE_NOT_FOUND");
    }

    if (!(await startDetachedProcess(canonicalPath, dependencies))) {
      dependencies.logError("Registered application process launch failed.");
      return createFailure("APPLICATION_LAUNCH_FAILED");
    }

    return createSuccess({ applicationName: target.name });
  };

  return {
    launchByAlias: async (alias) => {
      const resolved = await dependencies.applicationService.resolveEnabledApplicationByAlias(alias);
      if (!resolved.ok) return resolved;
      return launchResolvedTarget(resolved.data);
    },
    launchResolvedTarget
  };
};
