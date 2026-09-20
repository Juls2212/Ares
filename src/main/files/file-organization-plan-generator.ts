import { lstat as defaultLstat, readdir as defaultReaddir, realpath as defaultRealpath } from "node:fs/promises";
import path from "node:path";
import {
  ORGANIZATION_CATEGORIES,
  type FileOperationResult,
  type FileOrganizationPlan,
  type OrganizationCategory,
  type OrganizationCategoryCounts,
  type OrganizationSkipReason,
  type OrganizeFilesInput,
  type SafeFileReference
} from "../../shared/file-contracts";
import type { ApprovedFileRootResolver, ResolvedApprovedFileRoot } from "./approved-file-roots";
import { createApprovedFileRootResolver } from "./approved-file-roots";
import { isCanonicalPathWithinRoot, toRootRelativePath, type FilePathStats } from "./file-path-boundary";
import {
  classifyFileForOrganization,
  getOrganizationCategoryFolderName,
  isOrganizationCategoryFolderName
} from "./file-organization-classifier";
import { validateOrganizeFilesInput } from "./file-validation";

type DirectoryEntry = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

type FileOrganizationPlanGeneratorDependencies = {
  rootResolver: ApprovedFileRootResolver;
  lstat: (targetPath: string) => Promise<FilePathStats>;
  realpath: (targetPath: string) => Promise<string>;
  readdir: (targetPath: string) => Promise<DirectoryEntry[]>;
  logError: (message: string) => void;
};

export type FileOrganizationPlanGenerator = {
  generate: (input: unknown) => Promise<FileOperationResult<FileOrganizationPlan>>;
};

const createFailure = <T>(
  code: "FILE_DESTINATION_CONFLICT" | "FILE_ORGANIZATION_UNAVAILABLE" | "FILE_REPARSE_POINT_REJECTED" | "FILE_SOURCE_TYPE_INVALID" | "FILE_RELATIVE_PATH_INVALID"
): FileOperationResult<T> => {
  const messages = {
    FILE_DESTINATION_CONFLICT: "La carpeta de destino no es válida para organizar archivos.",
    FILE_ORGANIZATION_UNAVAILABLE: "No se pudo analizar la carpeta autorizada.",
    FILE_REPARSE_POINT_REJECTED: "No se permite operar sobre enlaces o puntos de redirección.",
    FILE_SOURCE_TYPE_INVALID: "La carpeta seleccionada no es válida.",
    FILE_RELATIVE_PATH_INVALID: "La ubicación relativa no es válida."
  } as const;
  return { ok: false, error: { code, userMessage: messages[code] } };
};

const initialCategoryCounts = (): OrganizationCategoryCounts => ({
  DOCUMENTS: 0,
  IMAGES: 0,
  AUDIO: 0,
  VIDEOS: 0,
  ARCHIVES: 0,
  OTHER: 0
});

const isUnsafeEntryName = (name: string): boolean => {
  const normalized = name.toLocaleLowerCase("en-US");
  return name.startsWith(".") || normalized === "desktop.ini" || normalized === "thumbs.db" || normalized === "$recycle.bin";
};

const normalizeName = (value: string): string => value.toLocaleLowerCase("en-US");

const uniqueDestinationName = (name: string, reservedNames: Set<string>): string => {
  const extension = path.win32.extname(name);
  const baseName = extension.length === 0 ? name : name.slice(0, -extension.length);
  let candidate = name;
  let suffix = 1;
  while (reservedNames.has(normalizeName(candidate))) {
    candidate = `${baseName} (${suffix})${extension}`;
    suffix += 1;
  }
  reservedNames.add(normalizeName(candidate));
  return candidate;
};

const resolveFolder = async (
  reference: SafeFileReference,
  dependencies: FileOrganizationPlanGeneratorDependencies
): Promise<FileOperationResult<{ root: ResolvedApprovedFileRoot; canonicalPath: string }>> => {
  const root = await dependencies.rootResolver.resolve(reference.rootId);
  if (!root.ok) return root;
  const requestedPath = path.win32.resolve(root.data.canonicalPath, reference.relativePath);
  if (!isCanonicalPathWithinRoot(root.data.canonicalPath, requestedPath)) {
    return createFailure("FILE_RELATIVE_PATH_INVALID");
  }
  try {
    const stats = await dependencies.lstat(requestedPath);
    if (stats.isSymbolicLink()) return createFailure("FILE_REPARSE_POINT_REJECTED");
    if (!stats.isDirectory()) return createFailure("FILE_SOURCE_TYPE_INVALID");
    const canonicalPath = await dependencies.realpath(requestedPath);
    if (!isCanonicalPathWithinRoot(root.data.canonicalPath, canonicalPath)) {
      return createFailure("FILE_RELATIVE_PATH_INVALID");
    }
    return { ok: true, data: { root: root.data, canonicalPath } };
  } catch {
    return createFailure("FILE_ORGANIZATION_UNAVAILABLE");
  }
};

export const createFileOrganizationPlanGenerator = (
  overrides: Partial<FileOrganizationPlanGeneratorDependencies> = {}
): FileOrganizationPlanGenerator => {
  const dependencies: FileOrganizationPlanGeneratorDependencies = {
    rootResolver: overrides.rootResolver ?? createApprovedFileRootResolver(),
    lstat: overrides.lstat ?? defaultLstat,
    realpath: overrides.realpath ?? defaultRealpath,
    readdir: overrides.readdir ?? ((targetPath) => defaultReaddir(targetPath, { withFileTypes: true }) as Promise<DirectoryEntry[]>),
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  return {
    generate: async (input) => {
      const validation = validateOrganizeFilesInput(input);
      if (!validation.ok) return validation;
      const folder = await resolveFolder(validation.data.folder, dependencies);
      if (!folder.ok) return folder;

      let entries: DirectoryEntry[];
      try {
        entries = await dependencies.readdir(folder.data.canonicalPath);
      } catch {
        dependencies.logError("File organization directory analysis failed.");
        return createFailure("FILE_ORGANIZATION_UNAVAILABLE");
      }

      const excluded = new Set(
        (validation.data.exclusions ?? []).map(
          (reference) => `${reference.rootId}:${reference.relativePath.toLocaleLowerCase("en-US")}`
        )
      );
      const counts = initialCategoryCounts();
      const skipCounts = new Map<OrganizationSkipReason, number>();
      const addSkip = (reason: OrganizationSkipReason): void => {
        skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
      };
      const categoryReservedNames = new Map<OrganizationCategory, Set<string>>();
      const unavailableCategories = new Set<OrganizationCategory>();

      for (const category of ORGANIZATION_CATEGORIES) {
        const categoryPath = path.win32.join(folder.data.canonicalPath, getOrganizationCategoryFolderName(category));
        try {
          const stats = await dependencies.lstat(categoryPath);
          if (stats.isSymbolicLink() || !stats.isDirectory()) {
            unavailableCategories.add(category);
            continue;
          }
          const canonicalCategoryPath = await dependencies.realpath(categoryPath);
          if (!isCanonicalPathWithinRoot(folder.data.root.canonicalPath, canonicalCategoryPath)) {
            unavailableCategories.add(category);
            continue;
          }
          const names = await dependencies.readdir(canonicalCategoryPath);
          categoryReservedNames.set(category, new Set(names.map((entry) => normalizeName(entry.name))));
        } catch {
          categoryReservedNames.set(category, new Set());
        }
      }

      const items: FileOrganizationPlan["items"] = [];
      const categoriesSeen = new Set<OrganizationCategory>();
      const selectedFolderIsCategory = isOrganizationCategoryFolderName(path.win32.basename(folder.data.canonicalPath));
      const sortedEntries = [...entries].sort((left, right) =>
        left.name.localeCompare(right.name, "en-US", { sensitivity: "base" })
      );

      for (const entry of sortedEntries) {
        if (isUnsafeEntryName(entry.name)) {
          addSkip("UNSAFE_ENTRY");
          continue;
        }
        if (entry.isSymbolicLink()) {
          addSkip("REPARSE_POINT");
          continue;
        }
        if (entry.isDirectory()) {
          addSkip("DIRECTORY");
          continue;
        }
        if (!entry.isFile()) {
          addSkip("UNSAFE_ENTRY");
          continue;
        }

        const sourcePath = path.win32.join(folder.data.canonicalPath, entry.name);
        const relativeSource = toRootRelativePath(folder.data.root.canonicalPath, sourcePath);
        if (!relativeSource) {
          addSkip("UNSAFE_ENTRY");
          continue;
        }
        const source: SafeFileReference = { rootId: folder.data.root.rootId, relativePath: relativeSource };
        if (excluded.has(`${source.rootId}:${source.relativePath.toLocaleLowerCase("en-US")}`)) {
          addSkip("EXCLUDED");
          continue;
        }
        if (selectedFolderIsCategory) {
          addSkip("ALREADY_CATEGORY_FOLDER");
          continue;
        }
        try {
          const stats = await dependencies.lstat(sourcePath);
          if (stats.isSymbolicLink()) {
            addSkip("REPARSE_POINT");
            continue;
          }
          if (!stats.isFile()) {
            addSkip(stats.isDirectory() ? "DIRECTORY" : "UNSAFE_ENTRY");
            continue;
          }
        } catch {
          addSkip("SOURCE_UNAVAILABLE");
          continue;
        }

        const category = classifyFileForOrganization(entry.name);
        categoriesSeen.add(category);
        if (unavailableCategories.has(category)) {
          addSkip("DESTINATION_CONFLICT");
          continue;
        }
        const reserved = categoryReservedNames.get(category) ?? new Set<string>();
        categoryReservedNames.set(category, reserved);
        const destinationName = uniqueDestinationName(entry.name, reserved);
        const destinationPath = path.win32.join(
          folder.data.canonicalPath,
          getOrganizationCategoryFolderName(category),
          destinationName
        );
        const relativeDestination = toRootRelativePath(folder.data.root.canonicalPath, destinationPath);
        if (!relativeDestination) {
          addSkip("DESTINATION_UNAVAILABLE");
          continue;
        }
        items.push({
          source,
          destination: { rootId: folder.data.root.rootId, relativePath: relativeDestination },
          category
        });
        counts[category] += 1;
      }

      const skipped = [...skipCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([reason, count]) => ({ reason, count }));
      const conflictCount = (skipCounts.get("DESTINATION_CONFLICT") ?? 0) + (skipCounts.get("DESTINATION_UNAVAILABLE") ?? 0);
      const skippedCount = skipped.reduce((total, item) => total + item.count, 0);
      return {
        ok: true,
        data: {
          rootId: folder.data.root.rootId,
          folder: validation.data.folder,
          items,
          plannedCount: items.length,
          skippedCount,
          conflictCount,
          categoryCounts: counts,
          skipped,
          mixedContent: categoriesSeen.size > 1,
          empty: entries.length === 0
        }
      };
    }
  };
};
