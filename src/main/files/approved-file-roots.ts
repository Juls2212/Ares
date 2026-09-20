import { app } from "electron";
import { realpath as defaultRealpath } from "node:fs/promises";
import path from "node:path";
import {
  FILE_ERROR_CODES,
  type ApprovedFileRoot,
  type FileOperationResult
} from "../../shared/file-contracts";
import { isApprovedFileRoot } from "./file-validation";

type ElectronPathName = "documents" | "downloads" | "desktop";

export type ResolvedApprovedFileRoot = {
  rootId: ApprovedFileRoot;
  canonicalPath: string;
};

export type ApprovedFileRootResolver = {
  resolve: (rootId: unknown) => Promise<FileOperationResult<ResolvedApprovedFileRoot>>;
};

type ApprovedFileRootResolverDependencies = {
  getPath: (name: ElectronPathName) => string;
  realpath: (targetPath: string) => Promise<string>;
  logError: (message: string) => void;
};

const rootPathNames: Record<ApprovedFileRoot, ElectronPathName> = {
  DOCUMENTS: "documents",
  DOWNLOADS: "downloads",
  DESKTOP: "desktop"
};

const createFailure = <T>(
  code: "FILE_ROOT_INVALID" | "FILE_ROOT_UNAVAILABLE"
): FileOperationResult<T> => ({
  ok: false,
  error: {
    code,
    userMessage:
      code === FILE_ERROR_CODES.rootInvalid
        ? "La ubicación seleccionada no está autorizada."
        : "No se pudo acceder a la ubicación autorizada."
  }
});

const isNetworkPath = (targetPath: string): boolean =>
  path.win32.normalize(targetPath).startsWith("\\\\");

export const createApprovedFileRootResolver = (
  overrides: Partial<ApprovedFileRootResolverDependencies> = {}
): ApprovedFileRootResolver => {
  const dependencies: ApprovedFileRootResolverDependencies = {
    getPath: overrides.getPath ?? ((name) => app.getPath(name)),
    realpath: overrides.realpath ?? defaultRealpath,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  return {
    resolve: async (rootId) => {
      if (!isApprovedFileRoot(rootId)) return createFailure(FILE_ERROR_CODES.rootInvalid);
      try {
        const trustedPath = dependencies.getPath(rootPathNames[rootId]);
        const canonicalPath = await dependencies.realpath(trustedPath);
        if (isNetworkPath(canonicalPath)) return createFailure(FILE_ERROR_CODES.rootUnavailable);
        return { ok: true, data: { rootId, canonicalPath } };
      } catch {
        dependencies.logError("Approved file root resolution failed.");
        return createFailure(FILE_ERROR_CODES.rootUnavailable);
      }
    }
  };
};
