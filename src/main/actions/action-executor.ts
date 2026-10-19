import type {
  ActionOutcome,
  ActionPolicy,
  ApprovedWebActionProposal,
  ExecutableActionProposal,
  FileActionProposal,
  OpenApplicationActionProposal,
  RegisterCatalogApplicationActionProposal,
  RequestCustomApplicationRegistrationActionProposal,
  SupervisedFilesActionProposal
} from "../../shared/action-contracts";
import type { FileOperationResult, FileOrganizationPlan } from "../../shared/file-contracts";
import {
  createApplicationActionExecutor,
  type ApplicationActionExecutor
} from "./application-action-executor";
import { getEnabledAssistantCapability } from "./capability-registry";
import { createApprovedWebActionExecutor, type ApprovedWebActionExecutor } from "./approved-web-action-executor";
import {
  createSupervisedFileActionExecutor,
  type PreparedFilesAction,
  type SupervisedFileActionExecutor
} from "./supervised-file-action-executor";
import type { FilesResult } from "../files/supervised-file-failures";
import { createPlannerActionExecutor, type PlannerActionExecutor } from "./planner-action-executor";

export type ActionExecutor = {
  execute: (proposal: ExecutableActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
  prepareOrganization?: (
    proposal: Extract<FileActionProposal, { action: "ORGANIZE_FILES" }>
  ) => Promise<FileOperationResult<FileOrganizationPlan>>;
  prepareCatalogRegistration?: (
    proposal: RegisterCatalogApplicationActionProposal
  ) => ReturnType<NonNullable<ApplicationActionExecutor["prepareCatalogRegistration"]>>;
  prepareFilesAction?: (proposal: SupervisedFilesActionProposal) => Promise<FilesResult<PreparedFilesAction>>;
  prepareCustomRegistration?: (
    proposal: RequestCustomApplicationRegistrationActionProposal
  ) => ReturnType<NonNullable<ApplicationActionExecutor["prepareCustomRegistration"]>>;
};

type ActionExecutorDependencies = {
  plannerExecutor?: PlannerActionExecutor;
  applicationExecutor?: ApplicationActionExecutor;
  approvedWebExecutor?: ApprovedWebActionExecutor;
  filesExecutor?: SupervisedFileActionExecutor;
};

const isApplicationAction = (
  proposal: ExecutableActionProposal
): proposal is
  | OpenApplicationActionProposal
  | RegisterCatalogApplicationActionProposal
  | RequestCustomApplicationRegistrationActionProposal =>
  proposal.action === "OPEN_APPLICATION" ||
  proposal.action === "REGISTER_CATALOG_APPLICATION" ||
  proposal.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION";

const isApprovedWebAction = (
  proposal: ExecutableActionProposal
): proposal is ApprovedWebActionProposal =>
  proposal.action === "OPEN_APPROVED_PAGE" || proposal.action === "SEARCH_APPROVED_SITE";

const isSupervisedFilesProposal = (proposal: ExecutableActionProposal): proposal is SupervisedFilesActionProposal =>
  proposal.action === "SEARCH_FILES" ||
  proposal.action === "REVEAL_FOUND_FILE" ||
  proposal.action === "OPEN_FOUND_FILE" ||
  proposal.action === "CREATE_FOLDER" ||
  proposal.action === "RENAME_FOUND_ITEM" ||
  proposal.action === "MOVE_FOUND_ITEMS" ||
  proposal.action === "ORGANIZE_FOUND_ITEMS" ||
  proposal.action === "DELETE_FOUND_ITEM";

const unsupportedOutcome = (
  proposal: ExecutableActionProposal,
  policy: ActionPolicy
): ActionOutcome => ({
  actionId: proposal.actionId,
  action: proposal.action,
  riskLevel: policy.riskLevel,
  status: "VALIDATION_FAILED",
  errorCode: "ACTION_UNSUPPORTED",
  userSummary: "No puedo realizar esa acción."
});

/** Routes only enabled registry entries to their fixed Main-owned executors. */
export const createActionExecutor = (
  overrides: Partial<ActionExecutorDependencies> = {}
): ActionExecutor => {
  const plannerExecutor = overrides.plannerExecutor ?? createPlannerActionExecutor();
  const applicationExecutor = overrides.applicationExecutor ?? createApplicationActionExecutor();
  const approvedWebExecutor = overrides.approvedWebExecutor ?? createApprovedWebActionExecutor();
  const filesExecutor = overrides.filesExecutor ?? createSupervisedFileActionExecutor();

  return {
    execute: (proposal, policy) => {
      const capability = getEnabledAssistantCapability(proposal.action);
      if (!capability) return Promise.resolve(unsupportedOutcome(proposal, policy));
      if (capability.executor === "APPLICATION" && isApplicationAction(proposal)) {
        return applicationExecutor.execute(proposal, policy);
      }
      if (capability.executor === "WEB" && isApprovedWebAction(proposal)) {
        return approvedWebExecutor.execute(proposal, policy);
      }
      if (capability.executor === "FILES") {
        return isSupervisedFilesProposal(proposal)
          ? filesExecutor.execute(proposal, policy)
          : Promise.resolve(unsupportedOutcome(proposal, policy));
      }
      return plannerExecutor.execute(proposal as Parameters<PlannerActionExecutor["execute"]>[0], policy);
    },
    prepareCatalogRegistration: (proposal) => {
      if (!getEnabledAssistantCapability(proposal.action) || !applicationExecutor.prepareCatalogRegistration) {
        return Promise.resolve({
          ok: false as const,
          error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo realizar esa acción." }
        });
      }
      return applicationExecutor.prepareCatalogRegistration(proposal);
    },
    prepareFilesAction: (proposal) => filesExecutor.prepare(proposal),
    prepareCustomRegistration: (proposal) => {
      if (!getEnabledAssistantCapability(proposal.action) || !applicationExecutor.prepareCustomRegistration) {
        return Promise.resolve({
          ok: false as const,
          error: { code: "ACTION_UNSUPPORTED", userMessage: "No puedo realizar esa acción." }
        });
      }
      return applicationExecutor.prepareCustomRegistration(proposal);
    }
  };
};
