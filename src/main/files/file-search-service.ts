import { lstat as defaultLstat, readdir as defaultReaddir, realpath as defaultRealpath } from "node:fs/promises";
import path from "node:path";
import {
  FILE_ERROR_CODES,
  type FileEntryType,
  type FileOperationResult,
  type FileSearchData,
  type FileSearchInput,
  type SafeFileSearchResult
} from "../../shared/file-contracts";
import {
  createApprovedFileRootResolver,
  type ApprovedFileRootResolver,
  type ResolvedApprovedFileRoot
} from "./approved-file-roots";
import {
  isCanonicalPathWithinRoot,
  resolveSearchScope,
  toRootRelativePath,
  type FilePathStats
} from "./file-path-boundary";
import { validateFileSearchInput } from "./file-validation";

const maximumRecursionDepth = 12;
const maximumResultLimit = 100;

export type SearchDirectoryEntry = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

export type SearchFileStats = FilePathStats & {
  size: number;
  mtime: Date;
};

export type FileSearchService = {
  search: (input: unknown) => Promise<FileOperationResult<FileSearchData>>;
};

type FileSearchServiceDependencies = {
  rootResolver: ApprovedFileRootResolver;
  readdir: (targetPath: string) => Promise<SearchDirectoryEntry[]>;
  lstat: (targetPath: string) => Promise<SearchFileStats>;
  realpath: (targetPath: string) => Promise<string>;
  logError: (message: string) => void;
};

type SearchState = {
  items: SafeFileSearchResult[];
  skippedEntryCount: number;
  truncated: boolean;
};

const createFailure = <T>(
  code: "FILE_SEARCH_UNAVAILABLE" | "FILE_SEARCH_SCOPE_UNAVAILABLE"
): FileOperationResult<T> => ({
  ok: false,
  error: {
    code,
    userMessage:
      code === FILE_ERROR_CODES.searchScopeUnavailable
        ? "No se pudo acceder al alcance de búsqueda autorizado."
        : "No se pudo completar la búsqueda de archivos."
  }
});

const getExtension = (name: string): string | null => {
  const extension = path.win32.extname(name);
  return extension ? extension.slice(1).toLocaleLowerCase("en-US") : null;
};

const matchesSearch = (
  entry: SearchDirectoryEntry,
  query: string,
  extensions: readonly string[] | undefined
): boolean => {
  if (!entry.name.toLocaleLowerCase("en-US").includes(query.toLocaleLowerCase("en-US"))) {
    return false;
  }
  if (!extensions) return true;
  if (!entry.isFile()) return false;
  const extension = getExtension(entry.name);
  return extension !== null && extensions.includes(extension);
};

const toSafeResult = (
  root: ResolvedApprovedFileRoot,
  canonicalPath: string,
  entry: SearchDirectoryEntry,
  stats: SearchFileStats
): SafeFileSearchResult | undefined => {
  const relativePath = toRootRelativePath(root.canonicalPath, canonicalPath);
  if (!relativePath) return undefined;
  const entryType: FileEntryType = entry.isFile() ? "FILE" : "DIRECTORY";
  return {
    rootId: root.rootId,
    relativePath,
    name: entry.name,
    entryType,
    extension: entryType === "FILE" ? getExtension(entry.name) : null,
    size: entryType === "FILE" ? stats.size : null,
    lastModified: Number.isNaN(stats.mtime.getTime()) ? null : stats.mtime.toISOString()
  };
};

export const createFileSearchService = (
  overrides: Partial<FileSearchServiceDependencies> = {}
): FileSearchService => {
  const dependencies: FileSearchServiceDependencies = {
    rootResolver: overrides.rootResolver ?? createApprovedFileRootResolver(),
    readdir: overrides.readdir ?? ((targetPath) => defaultReaddir(targetPath, { withFileTypes: true })),
    lstat: overrides.lstat ?? defaultLstat,
    realpath: overrides.realpath ?? defaultRealpath,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  const searchDirectory = async (
    root: ResolvedApprovedFileRoot,
    input: FileSearchInput,
    directoryPath: string,
    depth: number,
    state: SearchState,
    resultLimit: number
  ): Promise<void> => {
    if (state.truncated) return;

    let entries: SearchDirectoryEntry[];
    try {
      entries = await dependencies.readdir(directoryPath);
    } catch {
      state.skippedEntryCount += 1;
      return;
    }

    for (const entry of entries) {
      if (state.truncated) return;
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        state.skippedEntryCount += 1;
        continue;
      }

      const requestedPath = path.win32.join(directoryPath, entry.name);
      if (!isCanonicalPathWithinRoot(root.canonicalPath, requestedPath)) {
        state.skippedEntryCount += 1;
        continue;
      }

      let stats: SearchFileStats;
      let canonicalPath: string;
      try {
        stats = await dependencies.lstat(requestedPath);
        if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
          state.skippedEntryCount += 1;
          continue;
        }
        canonicalPath = await dependencies.realpath(requestedPath);
      } catch {
        state.skippedEntryCount += 1;
        continue;
      }

      if (!isCanonicalPathWithinRoot(root.canonicalPath, canonicalPath)) {
        state.skippedEntryCount += 1;
        continue;
      }

      if (matchesSearch(entry, input.query, input.extensions)) {
        const safeResult = toSafeResult(root, canonicalPath, entry, stats);
        if (safeResult) state.items.push(safeResult);
      }

      if (state.items.length >= resultLimit) {
        state.truncated = true;
        return;
      }

      if (stats.isDirectory()) {
        if (depth >= maximumRecursionDepth) {
          state.truncated = true;
          continue;
        }
        await searchDirectory(root, input, canonicalPath, depth + 1, state, resultLimit);
      }
    }
  };

  return {
    search: async (input) => {
      const validation = validateFileSearchInput(input);
      if (!validation.ok) return validation;

      try {
        const root = await dependencies.rootResolver.resolve(validation.data.rootId);
        if (!root.ok) return root;

        const scope = await resolveSearchScope(root.data, validation.data.relativePath, dependencies);
        if (!scope.ok) return createFailure(FILE_ERROR_CODES.searchScopeUnavailable);

        const state: SearchState = { items: [], skippedEntryCount: 0, truncated: false };
        await searchDirectory(
          root.data,
          validation.data,
          scope.data.canonicalPath,
          0,
          state,
          validation.data.limit ?? maximumResultLimit
        );
        return {
          ok: true,
          data: {
            items: state.items,
            total: state.items.length,
            truncated: state.truncated,
            skippedEntryCount: state.skippedEntryCount
          }
        };
      } catch {
        dependencies.logError("File metadata search failed.");
        return createFailure(FILE_ERROR_CODES.searchUnavailable);
      }
    }
  };
};
