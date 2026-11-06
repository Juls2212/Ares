import type {
  ActionOutcome,
  ActionPolicy,
  ApprovedWebActionProposal,
  ExecutableActionProposal,
  FileActionProposal,
  MessagingActionProposal,
  OpenApplicationActionProposal,
  RegisterCatalogApplicationActionProposal,
  RequestCustomApplicationRegistrationActionProposal,
  SearchSpotifyAppActionProposal,
  SpotifyMusicActionProposal,
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
import {
  createMessagingActionExecutor,
  type MessagingActionExecutor,
  type PreparedMessagingAction
} from "./messaging-action-executor";
import type { MessagingResult } from "../messaging/messaging-failures";
import { createSpotifyActionExecutor, type SpotifyActionExecutor } from "./spotify-action-executor";
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
  prepareMessagingAction?: (proposal: MessagingActionProposal) => Promise<MessagingResult<PreparedMessagingAction>>;
  /** Drops the Main-held snapshot of a proposal that was cancelled or expired without running. */
  releasePrepared?: (proposal: ExecutableActionProposal) => void;
  prepareCustomRegistration?: (
    proposal: RequestCustomApplicationRegistrationActionProposal
  ) => ReturnType<NonNullable<ApplicationActionExecutor["prepareCustomRegistration"]>>;
};

type ActionExecutorDependencies = {
  plannerExecutor?: PlannerActionExecutor;
  applicationExecutor?: ApplicationActionExecutor;
  approvedWebExecutor?: ApprovedWebActionExecutor;
  filesExecutor?: SupervisedFileActionExecutor;
  messagingExecutor?: MessagingActionExecutor;
  spotifyExecutor?: SpotifyActionExecutor;
};

const isApplicationAction = (
  proposal: ExecutableActionProposal
): proposal is
  | OpenApplicationActionProposal
  | SearchSpotifyAppActionProposal
  | RegisterCatalogApplicationActionProposal
  | RequestCustomApplicationRegistrationActionProposal =>
  proposal.action === "OPEN_APPLICATION" ||
  proposal.action === "SEARCH_SPOTIFY_APP" ||
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

const MESSAGING_ACTIONS = [
  "SAVE_CONTACT",
  "LIST_CONTACTS",
  "DELETE_CONTACT",
  "PREPARE_MESSAGE_DRAFT",
  "EDIT_MESSAGE_DRAFT",
  "DISCARD_MESSAGE_DRAFT",
  "OPEN_WHATSAPP_CHAT_WITH_DRAFT"
] as const;

const isMessagingProposal = (proposal: ExecutableActionProposal): proposal is MessagingActionProposal =>
  (MESSAGING_ACTIONS as readonly string[]).includes(proposal.action);

const SPOTIFY_MUSIC_ACTIONS = [
  "CONNECT_SPOTIFY",
  "DISCONNECT_SPOTIFY",
  "GET_SPOTIFY_STATUS",
  "PLAY_SPOTIFY_MUSIC",
  "PAUSE_SPOTIFY",
  "RESUME_SPOTIFY",
  "NEXT_SPOTIFY_TRACK",
  "PREVIOUS_SPOTIFY_TRACK",
  "SET_SPOTIFY_VOLUME",
  "WHAT_IS_PLAYING"
] as const;

const isSpotifyMusicProposal = (proposal: ExecutableActionProposal): proposal is SpotifyMusicActionProposal =>
  (SPOTIFY_MUSIC_ACTIONS as readonly string[]).includes(proposal.action);

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
  const messagingExecutor = overrides.messagingExecutor ?? createMessagingActionExecutor();
  const spotifyExecutor = overrides.spotifyExecutor ?? createSpotifyActionExecutor();

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
      if (capability.executor === "MUSIC") {
        return isSpotifyMusicProposal(proposal)
          ? spotifyExecutor.execute(proposal, policy)
          : Promise.resolve(unsupportedOutcome(proposal, policy));
      }
      if (capability.executor === "MESSAGING") {
        return isMessagingProposal(proposal)
          ? messagingExecutor.execute(proposal, policy)
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
    prepareMessagingAction: (proposal) => messagingExecutor.prepare(proposal),
    releasePrepared: (proposal) => {
      if (isMessagingProposal(proposal)) messagingExecutor.release(proposal);
    },
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
