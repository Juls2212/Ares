import path from "node:path";
import {
  FILE_ERROR_CODES,
  type FileOperationResult,
  type FileOrganizationExecutionData,
  type FileOrganizationPlan,
  type OrganizationCategoryCounts,
  type SafeFileReference
} from "../../shared/file-contracts";
import { getOrganizationCategoryFolderName } from "./file-organization-classifier";
import type { FileMutationService } from "./file-mutation-service";

type FileOrganizationExecutorDependencies = {
  mutationService: FileMutationService;
  logError: (message: string) => void;
};

export type FileOrganizationExecutor = {
  execute: (plan: FileOrganizationPlan) => Promise<FileOperationResult<FileOrganizationExecutionData>>;
};

const createFailure = <T>(): FileOperationResult<T> => ({
  ok: false,
  error: {
    code: FILE_ERROR_CODES.organizationUnavailable,
    userMessage: "No se pudo completar la organización autorizada."
  }
});

const isDestinationFromStoredPlan = (
  plan: FileOrganizationPlan,
  item: FileOrganizationPlan["items"][number]
): boolean => {
  const fileName = path.win32.basename(item.destination.relativePath);
  const expected = `${plan.folder.relativePath}\\${getOrganizationCategoryFolderName(item.category)}\\${fileName}`;
  return (
    item.source.rootId === plan.rootId &&
    item.destination.rootId === plan.rootId &&
    item.destination.relativePath.toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US")
  );
};

const destinationDirectory = (
  plan: FileOrganizationPlan,
  category: FileOrganizationPlan["items"][number]["category"]
): SafeFileReference => ({
  rootId: plan.rootId,
  relativePath: `${plan.folder.relativePath}\\${getOrganizationCategoryFolderName(category)}`
});

export const createFileOrganizationExecutor = (
  overrides: Partial<FileOrganizationExecutorDependencies> = {}
): FileOrganizationExecutor => {
  if (!overrides.mutationService) {
    throw new Error("File organization executor requires a mutation service.");
  }
  const dependencies: FileOrganizationExecutorDependencies = {
    mutationService: overrides.mutationService,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  return {
    execute: async (plan) => {
      if (plan.rootId !== plan.folder.rootId || plan.plannedCount !== plan.items.length) {
        return createFailure();
      }
      let movedCount = 0;
      let skippedCount = plan.skippedCount;
      let conflictCount = plan.conflictCount;
      const attemptedCategories = new Set<string>();
      const unavailableCategories = new Set<string>();

      for (const item of plan.items) {
        if (!isDestinationFromStoredPlan(plan, item)) {
          skippedCount += 1;
          conflictCount += 1;
          continue;
        }
        const categoryDirectory = destinationDirectory(plan, item.category);
        const categoryKey = item.category;
        if (!attemptedCategories.has(categoryKey)) {
          attemptedCategories.add(categoryKey);
          const created = await dependencies.mutationService.createFolder({
            parentDirectory: plan.folder,
            name: getOrganizationCategoryFolderName(item.category)
          });
          if (!created.ok && created.error.code !== FILE_ERROR_CODES.collision) {
            unavailableCategories.add(categoryKey);
          }
        }
        if (unavailableCategories.has(categoryKey)) {
          skippedCount += 1;
          conflictCount += 1;
          continue;
        }

        if (!dependencies.mutationService.moveFileToNamedDestination) {
          dependencies.logError("File organization atomic move support is unavailable.");
          skippedCount += 1;
          conflictCount += 1;
          continue;
        }
        try {
          const moved = await dependencies.mutationService.moveFileToNamedDestination({
            source: item.source,
            destinationDirectory: categoryDirectory,
            destinationName: path.win32.basename(item.destination.relativePath)
          });
          if (moved.ok) {
            movedCount += 1;
            continue;
          }
          skippedCount += 1;
          if (moved.error.code === FILE_ERROR_CODES.collision || moved.error.code === FILE_ERROR_CODES.destinationTypeInvalid) {
            conflictCount += 1;
          }
        } catch {
          dependencies.logError("File organization item execution failed.");
          skippedCount += 1;
        }
      }

      const categoryCounts: OrganizationCategoryCounts = { ...plan.categoryCounts };
      return {
        ok: true,
        data: {
          plannedCount: plan.plannedCount,
          movedCount,
          skippedCount,
          conflictCount,
          partial: movedCount !== plan.plannedCount || skippedCount > 0 || conflictCount > 0,
          categoryCounts
        }
      };
    }
  };
};
