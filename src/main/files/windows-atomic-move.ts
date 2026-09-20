import { app } from "electron";
import { createRequire } from "node:module";
import path from "node:path";

export type AtomicMoveFailureReason =
  | "COLLISION"
  | "CROSS_VOLUME"
  | "SOURCE_NOT_FOUND"
  | "UNAVAILABLE"
  | "FAILED";

export type AtomicMoveResult =
  | { ok: true }
  | { ok: false; reason: AtomicMoveFailureReason };

type NativeMoveResult = {
  succeeded: boolean;
  errorCode: number;
};

type NativeAtomicMoveBinding = {
  moveNoReplace: (sourcePath: string, destinationPath: string) => NativeMoveResult;
};

type WindowsAtomicMoveDependencies = {
  isPackaged: () => boolean;
  getPackagedResourcesPath: () => string;
  getCurrentWorkingDirectory: () => string;
  loadBinding: (binaryPath: string) => NativeAtomicMoveBinding;
  logError: (message: string) => void;
};

export type WindowsAtomicMove = {
  moveNoReplace: (sourcePath: string, destinationPath: string) => AtomicMoveResult;
};

const errorFileExists = 80;
const errorAlreadyExists = 183;
const errorFileNotFound = 2;
const errorPathNotFound = 3;
const errorNotSameDevice = 17;
const bindingFileName = "ares_atomic_no_replace.node";

const isNativeResult = (value: unknown): value is NativeMoveResult =>
  typeof value === "object" &&
  value !== null &&
  "succeeded" in value &&
  typeof (value as { succeeded?: unknown }).succeeded === "boolean" &&
  "errorCode" in value &&
  typeof (value as { errorCode?: unknown }).errorCode === "number";

const mapNativeError = (errorCode: number): AtomicMoveFailureReason => {
  if (errorCode === errorFileExists || errorCode === errorAlreadyExists) return "COLLISION";
  if (errorCode === errorNotSameDevice) return "CROSS_VOLUME";
  if (errorCode === errorFileNotFound || errorCode === errorPathNotFound) return "SOURCE_NOT_FOUND";
  return "FAILED";
};

export const createWindowsAtomicMove = (
  overrides: Partial<WindowsAtomicMoveDependencies> = {}
): WindowsAtomicMove => {
  const dependencies: WindowsAtomicMoveDependencies = {
    isPackaged: overrides.isPackaged ?? (() => app.isPackaged),
    getPackagedResourcesPath:
      overrides.getPackagedResourcesPath ?? (() => path.dirname(app.getAppPath())),
    getCurrentWorkingDirectory: overrides.getCurrentWorkingDirectory ?? (() => process.cwd()),
    loadBinding:
      overrides.loadBinding ??
      ((binaryPath) => createRequire(import.meta.url)(binaryPath) as NativeAtomicMoveBinding),
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  let binding: NativeAtomicMoveBinding | undefined;
  let loadAttempted = false;

  const getBinaryPath = (): string =>
    dependencies.isPackaged()
      ? path.join(dependencies.getPackagedResourcesPath(), bindingFileName)
      : path.join(
          dependencies.getCurrentWorkingDirectory(),
          "native",
          "atomic-no-replace",
          "build",
          "Release",
          bindingFileName
        );

  const getBinding = (): NativeAtomicMoveBinding | undefined => {
    if (binding) return binding;
    if (loadAttempted) return undefined;
    loadAttempted = true;
    try {
      binding = dependencies.loadBinding(getBinaryPath());
      if (typeof binding.moveNoReplace !== "function") {
        binding = undefined;
        dependencies.logError("Windows atomic move binding has an invalid surface.");
      }
    } catch {
      dependencies.logError("Windows atomic move binding could not be loaded.");
    }
    return binding;
  };

  return {
    moveNoReplace: (sourcePath, destinationPath) => {
      const loadedBinding = getBinding();
      if (!loadedBinding) return { ok: false, reason: "UNAVAILABLE" };
      try {
        const nativeResult = loadedBinding.moveNoReplace(sourcePath, destinationPath);
        if (!isNativeResult(nativeResult)) {
          dependencies.logError("Windows atomic move binding returned an invalid result.");
          return { ok: false, reason: "FAILED" };
        }
        return nativeResult.succeeded
          ? { ok: true }
          : { ok: false, reason: mapNativeError(nativeResult.errorCode) };
      } catch {
        dependencies.logError("Windows atomic move invocation failed.");
        return { ok: false, reason: "FAILED" };
      }
    }
  };
};
