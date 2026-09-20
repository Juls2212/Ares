import {
  FILE_ERROR_CODES,
  type FileOperationResult,
  type FileOrganizationPlan
} from "../../shared/file-contracts";
import type {
  ActionOutcome,
  ActionPolicy,
  FileActionData,
  FileActionProposal,
  TerminalActionStatus
} from "../../shared/action-contracts";
import {
  getFileMutationService,
  getFileOrganizationExecutor,
  getFileOrganizationPlanGenerator,
  getFileSearchService
} from "../files/file-composition";
import type { FileMutationService } from "../files/file-mutation-service";
import type { FileOrganizationExecutor } from "../files/file-organization-executor";
import type { FileOrganizationPlanGenerator } from "../files/file-organization-plan-generator";
import type { FileSearchService } from "../files/file-search-service";

export type FileActionExecutor = {
  prepareOrganization?: (
    proposal: Extract<FileActionProposal, { action: "ORGANIZE_FILES" }>
  ) => Promise<FileOperationResult<FileOrganizationPlan>>;
  execute: (proposal: FileActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type FileActionExecutorDependencies = {
  fileSearchService?: FileSearchService;
  fileMutationService?: FileMutationService;
  organizationPlanGenerator?: FileOrganizationPlanGenerator;
  organizationExecutor?: FileOrganizationExecutor;
  logError: (message: string) => void;
};

const successSummaries: Record<FileActionProposal["action"], string> = {
  SEARCH_FILES: "Se completó la búsqueda de archivos autorizados.",
  CREATE_FOLDER: "Se creó la carpeta autorizada.",
  RENAME_FILE: "Se cambió el nombre del archivo autorizado.",
  RENAME_FOLDER: "Se cambió el nombre de la carpeta autorizada.",
  MOVE_FILE: "Se movió el archivo autorizado.",
  ORGANIZE_FILES: "Se completó la organización autorizada."
};

const executionFailureCodes = new Set<string>([
  FILE_ERROR_CODES.rootUnavailable,
  FILE_ERROR_CODES.searchScopeUnavailable,
  FILE_ERROR_CODES.searchUnavailable,
  FILE_ERROR_CODES.organizationUnavailable,
  FILE_ERROR_CODES.nativeMoveUnavailable,
  FILE_ERROR_CODES.mutationFailed
]);

const failureStatus = (errorCode: string): TerminalActionStatus =>
  executionFailureCodes.has(errorCode) ? "EXECUTION_FAILED" : "VALIDATION_FAILED";

const toOutcome = <T extends FileActionData>(
  proposal: FileActionProposal,
  policy: ActionPolicy,
  result: FileOperationResult<T>
): ActionOutcome => {
  if (result.ok) {
    return {
      actionId: proposal.actionId,
      action: proposal.action,
      riskLevel: policy.riskLevel,
      status: "SUCCEEDED",
      data: result.data,
      userSummary: successSummaries[proposal.action]
    };
  }

  return {
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: failureStatus(result.error.code),
    errorCode: result.error.code,
    userSummary: result.error.userMessage
  };
};

export const createFileActionExecutor = (
  overrides: Partial<FileActionExecutorDependencies> = {}
): FileActionExecutor => {
  const dependencies: FileActionExecutorDependencies = {
    fileSearchService: overrides.fileSearchService,
    fileMutationService: overrides.fileMutationService,
    organizationPlanGenerator: overrides.organizationPlanGenerator,
    organizationExecutor: overrides.organizationExecutor,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let fileSearchService = dependencies.fileSearchService;
  let fileMutationService = dependencies.fileMutationService;
  let organizationPlanGenerator = dependencies.organizationPlanGenerator;
  let organizationExecutor = dependencies.organizationExecutor;
  const getSearchService = (): FileSearchService => {
    fileSearchService ??= getFileSearchService();
    return fileSearchService;
  };
  const getMutationService = (): FileMutationService => {
    fileMutationService ??= getFileMutationService();
    return fileMutationService;
  };
  const getOrganizationPlanGenerator = (): FileOrganizationPlanGenerator => {
    organizationPlanGenerator ??= getFileOrganizationPlanGenerator();
    return organizationPlanGenerator;
  };
  const getOrganizationExecutor = (): FileOrganizationExecutor => {
    organizationExecutor ??= getFileOrganizationExecutor();
    return organizationExecutor;
  };

  return {
    prepareOrganization: async (proposal) => {
      try {
        return await getOrganizationPlanGenerator().generate(proposal.input);
      } catch {
        dependencies.logError("File organization plan generation failed.");
        return {
          ok: false,
          error: {
            code: FILE_ERROR_CODES.organizationUnavailable,
            userMessage: "No se pudo analizar la carpeta autorizada."
          }
        };
      }
    },
    execute: async (proposal, policy) => {
      try {
        switch (proposal.action) {
          case "SEARCH_FILES":
            return toOutcome(proposal, policy, await getSearchService().search(proposal.input));
          case "CREATE_FOLDER":
            return toOutcome(proposal, policy, await getMutationService().createFolder(proposal.input));
          case "RENAME_FILE":
            return toOutcome(proposal, policy, await getMutationService().renameFile(proposal.input));
          case "RENAME_FOLDER":
            return toOutcome(proposal, policy, await getMutationService().renameFolder(proposal.input));
          case "MOVE_FILE":
            return toOutcome(proposal, policy, await getMutationService().moveFile(proposal.input));
          case "ORGANIZE_FILES":
            if (!proposal.plan) {
              return {
                actionId: proposal.actionId,
                action: proposal.action,
                riskLevel: policy.riskLevel,
                status: "VALIDATION_FAILED",
                errorCode: FILE_ERROR_CODES.organizationUnavailable,
                userSummary: "No se encontró una vista previa de organización válida."
              };
            }
            return toOutcome(proposal, policy, await getOrganizationExecutor().execute(proposal.plan));
        }
      } catch {
        dependencies.logError("File action execution failed.");
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "EXECUTION_FAILED",
          errorCode: "ACTION_EXECUTION_UNAVAILABLE",
          userSummary: "No se pudo completar la acción de archivos solicitada."
        };
      }
    }
  };
};
