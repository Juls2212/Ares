import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { ARES_ENV_FILE_NAME, ARES_ENV_MAX_BYTES, ARES_ENV_NAMES, parseAresEnv, type AresEnvName } from "./ares-env-file";

let packagedRuntime = false;
let userDataDirectory: string | undefined;
/** Names whose value came from ares.env, so that an edited file can replace them without a restart. */
const appliedFromFile = new Set<AresEnvName>();

/**
 * Called once by Main at startup. In a packaged app the settings come from the process environment (Windows
 * environment variables inherited by the launcher) and then from the user-level ares.env file in userData; a
 * project-relative .env is never read.
 */
export const markPackagedRuntime = (isPackaged: boolean, userDataPath?: string): void => {
  packagedRuntime = isPackaged;
  userDataDirectory = isPackaged ? userDataPath : undefined;
  appliedFromFile.clear();
};

/** Copies allowed names from ares.env into the process environment, never over a value that was already set. */
const loadAresEnvFile = (directory: string): void => {
  let text: string;
  try {
    const file = path.join(directory, ARES_ENV_FILE_NAME);
    if (fs.statSync(file).size > ARES_ENV_MAX_BYTES) return;
    text = fs.readFileSync(file, "utf8");
  } catch {
    return; // A missing or unreadable file is not an error.
  }
  const values = parseAresEnv(text);
  for (const name of ARES_ENV_NAMES) {
    const current = process.env[name];
    if (current !== undefined && current !== "" && !appliedFromFile.has(name)) continue;
    const value = values[name];
    if (value === undefined) {
      if (appliedFromFile.delete(name)) delete process.env[name];
      continue;
    }
    process.env[name] = value;
    appliedFromFile.add(name);
  }
};

/**
 * Makes the configuration available in the process environment: the development .env, or in a packaged app the
 * user-level ares.env (process environment keeps priority).
 */
export const loadDevelopmentEnvironment = (): void => {
  if (packagedRuntime) {
    if (userDataDirectory) loadAresEnvFile(userDataDirectory);
    return;
  }
  dotenv.config({ quiet: true });
};
