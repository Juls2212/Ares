import { spawn as spawnProcess } from "node:child_process";
import { realpath as resolveRealPath, stat as readPathStats } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { shell } from "electron";
import type {
  ApplicationCatalogKey,
  ApplicationOperationResult,
  ApplicationPlatform
} from "../../shared/application-contracts";
import { validateExecutablePath } from "./application-validation";
import { CATALOG_LAUNCH_FAILURE } from "./catalog-registration-failures";
import {
  getKnownApplication,
  toWindowsLaunchCandidate,
  type KnownApplicationDefinition,
  type KnownWindowsLaunchCandidate
} from "./known-application-catalog";

type PathStats = { isFile: () => boolean };
type SpawnedProcess = {
  once: (event: "error" | "spawn", listener: () => void) => SpawnedProcess;
  unref: () => void;
};

type CatalogApplicationAdapterDependencies = {
  platform: () => NodeJS.Platform;
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<PathStats>;
  spawn: (path: string, argumentsList: readonly string[], options: {
    detached: true;
    shell: false;
    stdio: "ignore";
    windowsHide: true;
  }) => SpawnedProcess;
  logError: (message: string) => void;
  getWindowsUserDirectories: () => {
    localApplicationData: string;
    roamingApplicationData: string;
  };
  /** Receives only a catalog key; the protocol string is looked up inside this module. */
  openFixedProtocol: (key: ApplicationCatalogKey) => Promise<void>;
};

type ResolvedCatalogLaunchTarget =
  | { strategy: "WINDOWS_EXECUTABLE"; target: KnownWindowsLaunchCandidate }
  | { strategy: "FIXED_PROTOCOL"; key: ApplicationCatalogKey };

export type CatalogApplicationAdapter = {
  getCurrentPlatform: () => ApplicationPlatform | undefined;
  isAvailable: (key: unknown) => Promise<ApplicationOperationResult<{ available: true }>>;
  launch: (key: unknown) => Promise<ApplicationOperationResult<{ applicationName: string }>>;
};

const unavailable = <T>(): ApplicationOperationResult<T> => ({
  ok: false,
  error: {
    code: "APPLICATION_CATALOG_UNAVAILABLE",
    userMessage: "No encontré esa aplicación disponible en este equipo."
  }
});

const launchFailed = <T>(): ApplicationOperationResult<T> => ({
  ok: false,
  error: { ...CATALOG_LAUNCH_FAILURE }
});

const mapPlatform = (platform: NodeJS.Platform): ApplicationPlatform | undefined =>
  platform === "win32" ? "WINDOWS" : platform === "darwin" ? "MACOS" : platform === "linux" ? "LINUX" : undefined;

const isExecutable = (path: string): boolean => /\.exe$/iu.test(path);

/**
 * Closed per-key table of fixed launch protocols. It is private to this module: the strings are
 * never persisted, never accepted as input, and never returned or logged. A key that is not listed
 * has no protocol strategy.
 */
const FIXED_PROTOCOL_STRATEGIES: Readonly<Partial<Record<ApplicationCatalogKey, string>>> = Object.freeze({
  SPOTIFY: "spotify:",
  WHATSAPP: "whatsapp:"
});

const hasFixedProtocolStrategy = (key: ApplicationCatalogKey): boolean =>
  Object.prototype.hasOwnProperty.call(FIXED_PROTOCOL_STRATEGIES, key);

const openFixedProtocolStrategy = async (key: ApplicationCatalogKey): Promise<void> => {
  if (!hasFixedProtocolStrategy(key)) throw new Error("No fixed protocol strategy.");
  await shell.openExternal(FIXED_PROTOCOL_STRATEGIES[key] as string);
};

/** Derives only standard Windows per-user application directories in Electron Main. */
const getDefaultWindowsUserDirectories = () => {
  const home = homedir();
  return {
    localApplicationData: join(home, "AppData", "Local"),
    roamingApplicationData: join(home, "AppData", "Roaming")
  };
};

export const createCatalogApplicationAdapter = (
  overrides: Partial<CatalogApplicationAdapterDependencies> = {}
): CatalogApplicationAdapter => {
  const dependencies: CatalogApplicationAdapterDependencies = {
    platform: overrides.platform ?? (() => process.platform),
    realpath: overrides.realpath ?? resolveRealPath,
    stat: overrides.stat ?? readPathStats,
    spawn: overrides.spawn ?? spawnProcess,
    getWindowsUserDirectories: overrides.getWindowsUserDirectories ?? getDefaultWindowsUserDirectories,
    openFixedProtocol: overrides.openFixedProtocol ?? openFixedProtocolStrategy,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  const resolveWindowsCandidate = async (
    definition: KnownApplicationDefinition
  ): Promise<KnownWindowsLaunchCandidate | undefined> => {
    const directories = dependencies.getWindowsUserDirectories();
    for (const rule of definition.windowsCandidates) {
      const candidate = toWindowsLaunchCandidate(rule, directories);
      try {
        const validated = validateExecutablePath(candidate.executablePath);
        if (!validated.ok) continue;
        const resolved = await dependencies.realpath(validated.data);
        if (!isExecutable(resolved)) continue;
        const stats = await dependencies.stat(resolved);
        if (stats.isFile()) return { executablePath: resolved, arguments: candidate.arguments };
      } catch {
        // A fixed candidate not being available is routine and deliberately silent.
      }
    }
    return undefined;
  };

  const resolve = async (key: unknown): Promise<{
    definition: KnownApplicationDefinition;
    target: ResolvedCatalogLaunchTarget;
  } | undefined> => {
    const definition = getKnownApplication(key);
    if (!definition || dependencies.platform() !== "win32") return undefined;
    const executableTarget = await resolveWindowsCandidate(definition);
    if (executableTarget) return { definition, target: { strategy: "WINDOWS_EXECUTABLE", target: executableTarget } };
    return hasFixedProtocolStrategy(definition.key)
      ? { definition, target: { strategy: "FIXED_PROTOCOL", key: definition.key } }
      : undefined;
  };

  const startExecutable = (target: KnownWindowsLaunchCandidate): Promise<boolean> => {
    try {
      const child = dependencies.spawn(target.executablePath, target.arguments, {
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: true
      });
      return new Promise((complete) => {
        let settled = false;
        const settle = (started: boolean) => {
          if (settled) return;
          settled = true;
          complete(started);
        };
        child.once("error", () => settle(false));
        child.once("spawn", () => {
          try { child.unref(); settle(true); } catch { settle(false); }
        });
      });
    } catch {
      return Promise.resolve(false);
    }
  };

  const start = async (target: ResolvedCatalogLaunchTarget): Promise<boolean> => {
    if (target.strategy === "WINDOWS_EXECUTABLE") return startExecutable(target.target);
    try {
      await dependencies.openFixedProtocol(target.key);
      return true;
    } catch {
      return false;
    }
  };

  return {
    getCurrentPlatform: () => mapPlatform(dependencies.platform()),
    isAvailable: async (key) => (await resolve(key) ? { ok: true, data: { available: true } } : unavailable()),
    launch: async (key) => {
      const resolved = await resolve(key);
      if (!resolved) return unavailable();
      if (!(await start(resolved.target))) {
        dependencies.logError("Catalog application launch failed.");
        return launchFailed();
      }
      return { ok: true, data: { applicationName: resolved.definition.displayName } };
    }
  };
};
