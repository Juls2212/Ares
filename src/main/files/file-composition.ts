import { createFileSearchService, type FileSearchService } from "./file-search-service";
import { createFileMutationService, type FileMutationService } from "./file-mutation-service";
import {
  createFileOrganizationExecutor,
  type FileOrganizationExecutor
} from "./file-organization-executor";
import {
  createFileOrganizationPlanGenerator,
  type FileOrganizationPlanGenerator
} from "./file-organization-plan-generator";

let fileSearchService: FileSearchService | undefined;
let fileMutationService: FileMutationService | undefined;
let fileOrganizationPlanGenerator: FileOrganizationPlanGenerator | undefined;
let fileOrganizationExecutor: FileOrganizationExecutor | undefined;

export const getFileSearchService = (): FileSearchService => {
  fileSearchService ??= createFileSearchService();
  return fileSearchService;
};

export const getFileMutationService = (): FileMutationService => {
  fileMutationService ??= createFileMutationService();
  return fileMutationService;
};

export const getFileOrganizationPlanGenerator = (): FileOrganizationPlanGenerator => {
  fileOrganizationPlanGenerator ??= createFileOrganizationPlanGenerator();
  return fileOrganizationPlanGenerator;
};

export const getFileOrganizationExecutor = (): FileOrganizationExecutor => {
  fileOrganizationExecutor ??= createFileOrganizationExecutor({
    mutationService: getFileMutationService()
  });
  return fileOrganizationExecutor;
};
