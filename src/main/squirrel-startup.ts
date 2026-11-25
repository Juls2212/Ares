import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Squirrel.Windows runs the installed executable with one of these flags at install, update and uninstall time.
 * The executable must create or remove its shortcuts through Update.exe and exit at once.
 *
 * This is NOT a process-launch capability of the app:
 *   - it exists only in Main and is called once at startup, before any window, service or IPC handler exists;
 *   - the trigger is the process's own command-line flag, matched exactly against the closed set below
 *     (an unknown flag does nothing);
 *   - the only program ever started is Update.exe, in the folder above the running executable;
 *   - its arguments come from the closed table below plus the running executable's own file name, validated
 *     against a strict pattern. No renderer, IPC message, voice command or model output can reach it.
 */
export const SQUIRREL_EVENT_FLAGS = {
  "--squirrel-install": "install",
  "--squirrel-updated": "updated",
  "--squirrel-uninstall": "uninstall",
  "--squirrel-obsolete": "obsolete",
  "--squirrel-firstrun": "firstrun"
} as const;

export type SquirrelEvent = (typeof SQUIRREL_EVENT_FLAGS)[keyof typeof SQUIRREL_EVENT_FLAGS];

const EXECUTABLE_FILE_PATTERN = /^[A-Za-z0-9_.-]{1,64}\.exe$/u;
const SHORTCUT_LOCATIONS = "Desktop,StartMenu";

/** Squirrel passes the event flag as the first argument after the executable. Anything else is not an event. */
export const parseSquirrelEvent = (argv: readonly string[]): SquirrelEvent | undefined => {
  const flag = argv[1];
  return typeof flag === "string" && Object.prototype.hasOwnProperty.call(SQUIRREL_EVENT_FLAGS, flag)
    ? SQUIRREL_EVENT_FLAGS[flag as keyof typeof SQUIRREL_EVENT_FLAGS]
    : undefined;
};

/** The fixed Update.exe arguments for an event, or undefined when the event needs no Update.exe call. */
export const updateExeArguments = (event: SquirrelEvent, executableFile: string): string[] | undefined => {
  if (!EXECUTABLE_FILE_PATTERN.test(executableFile)) return undefined;
  if (event === "install" || event === "updated") {
    return [`--createShortcut=${executableFile}`, `--shortcut-locations=${SHORTCUT_LOCATIONS}`];
  }
  if (event === "uninstall") return [`--removeShortcut=${executableFile}`];
  return undefined;
};

export type SquirrelChild = { on: (event: "close" | "error", listener: () => void) => unknown };

export type SquirrelStartupDependencies = {
  platform: string;
  argv: readonly string[];
  execPath: string;
  spawnUpdate: (updateExePath: string, args: string[]) => SquirrelChild;
};

export const defaultSquirrelDependencies = (): SquirrelStartupDependencies => ({
  platform: process.platform,
  argv: process.argv,
  execPath: process.execPath,
  spawnUpdate: (updateExePath, args) => spawn(updateExePath, args, { stdio: "ignore", windowsHide: true, shell: false })
});

/**
 * Handles a Squirrel lifecycle event. Returns true when this launch was a Squirrel event that ends here (install,
 * update, uninstall, obsolete): the caller must not start the app, and `onFinished` runs once when it may quit.
 * Returns false for a normal launch and for "firstrun", which is a normal first start after installing.
 */
export const handleSquirrelStartup = (
  onFinished: () => void,
  dependencies: SquirrelStartupDependencies = defaultSquirrelDependencies()
): boolean => {
  if (dependencies.platform !== "win32") return false;
  const event = parseSquirrelEvent(dependencies.argv);
  if (event === undefined || event === "firstrun") return false;

  const executableFile = path.basename(dependencies.execPath);
  const args = updateExeArguments(event, executableFile);
  if (!args) {
    onFinished();
    return true;
  }

  const updateExe = path.resolve(path.dirname(dependencies.execPath), "..", "Update.exe");
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    onFinished();
  };
  try {
    const child = dependencies.spawnUpdate(updateExe, args);
    child.on("close", finish);
    child.on("error", finish);
  } catch {
    finish();
  }
  return true;
};
