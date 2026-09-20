import path from "node:path";
import {
  FILE_ERROR_CODES,
  type FileOperationResult
} from "../../shared/file-contracts";
import type { ResolvedApprovedFileRoot } from "./approved-file-roots";

export type FilePathStats = {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

export type FilePathBoundaryDependencies = {
  lstat: (targetPath: string) => Promise<FilePathStats>;
  realpath: (targetPath: string) => Promise<string>;
};

export type ResolvedSearchScope = {
  canonicalPath: string;
};

const normalizeForComparison = (targetPath: string): string => {
  const normalized = path.win32.normalize(targetPath).replace(/[\\/]+$/, "");
  return normalized.toLocaleLowerCase("en-US");
};

export const isCanonicalPathWithinRoot = (rootPath: string, targetPath: string): boolean => {
  const root = normalizeForComparison(rootPath);
  const target = normalizeForComparison(targetPath);
  return target === root || target.startsWith(`${root}\\`);
};

const createFailure = <T>(): FileOperationResult<T> => ({
  ok: false,
  error: {
    code: FILE_ERROR_CODES.searchScopeUnavailable,
    userMessage: "No se pudo acceder al alcance de búsqueda autorizado."
  }
});

export const resolveSearchScope = async (
  root: ResolvedApprovedFileRoot,
  relativePath: string | undefined,
  dependencies: FilePathBoundaryDependencies
): Promise<FileOperationResult<ResolvedSearchScope>> => {
  if (relativePath === undefined) return { ok: true, data: { canonicalPath: root.canonicalPath } };

  const requestedPath = path.win32.resolve(root.canonicalPath, relativePath);
  if (!isCanonicalPathWithinRoot(root.canonicalPath, requestedPath)) return createFailure();

  try {
    const requestedStats = await dependencies.lstat(requestedPath);
    if (requestedStats.isSymbolicLink() || !requestedStats.isDirectory()) return createFailure();

    const canonicalPath = await dependencies.realpath(requestedPath);
    if (!isCanonicalPathWithinRoot(root.canonicalPath, canonicalPath)) return createFailure();
    return { ok: true, data: { canonicalPath } };
  } catch {
    return createFailure();
  }
};

export const toRootRelativePath = (rootPath: string, targetPath: string): string | undefined => {
  if (!isCanonicalPathWithinRoot(rootPath, targetPath)) return undefined;
  const relativePath = path.win32.relative(rootPath, targetPath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : undefined;
};
