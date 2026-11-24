import dotenv from "dotenv";

let packagedRuntime = false;

/**
 * Called once by Main at startup. In a packaged app the settings come only from the process environment
 * (Windows environment variables inherited by the launcher); a project-relative .env is never read.
 */
export const markPackagedRuntime = (isPackaged: boolean): void => {
  packagedRuntime = isPackaged;
};

/** Loads the development .env into the process environment. It does nothing in a packaged app. */
export const loadDevelopmentEnvironment = (): void => {
  if (packagedRuntime) return;
  dotenv.config({ quiet: true });
};
