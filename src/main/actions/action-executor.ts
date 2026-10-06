import type {
  ActionOutcome,
  ActionPolicy,
  ExecutableActionProposal,
  FileActionProposal,
  HabitActionProposal,
  OpenApplicationActionProposal,
  OpenWebPageActionProposal,
  WeatherActionProposal
} from "../../shared/action-contracts";
import type { FileOperationResult, FileOrganizationPlan } from "../../shared/file-contracts";
import {
  createApplicationActionExecutor,
  type ApplicationActionExecutor
} from "./application-action-executor";
import { createPlannerActionExecutor, type PlannerActionExecutor } from "./planner-action-executor";
import { createFileActionExecutor, type FileActionExecutor } from "./file-action-executor";
import { createWeatherActionExecutor, type WeatherActionExecutor } from "./weather-action-executor";
import { createHabitActionExecutor, type HabitActionExecutor } from "./habit-action-executor";

export type ActionExecutor = {
  execute: (proposal: ExecutableActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
  prepareOrganization?: (
    proposal: Extract<FileActionProposal, { action: "ORGANIZE_FILES" }>
  ) => Promise<FileOperationResult<FileOrganizationPlan>>;
};

type ActionExecutorDependencies = {
  plannerExecutor?: PlannerActionExecutor;
  applicationExecutor?: ApplicationActionExecutor;
  fileExecutor?: FileActionExecutor;
  weatherExecutor?: WeatherActionExecutor;
  habitExecutor?: HabitActionExecutor;
};

const isFileAction = (proposal: ExecutableActionProposal): proposal is FileActionProposal =>
  ["SEARCH_FILES", "CREATE_FOLDER", "RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE"].includes(
    proposal.action as FileActionProposal["action"]
  ) || proposal.action === "ORGANIZE_FILES";

const isApplicationAction = (
  proposal: ExecutableActionProposal
): proposal is OpenApplicationActionProposal | OpenWebPageActionProposal =>
  proposal.action === "OPEN_APPLICATION" || proposal.action === "OPEN_WEB_PAGE";

const isWeatherAction = (proposal: ExecutableActionProposal): proposal is WeatherActionProposal =>
  proposal.action === "GET_WEATHER";

const isHabitAction = (proposal: ExecutableActionProposal): proposal is HabitActionProposal =>
  ["GET_HABIT_PROGRESS", "CREATE_HABIT", "UPDATE_HABIT", "COMPLETE_HABIT"].includes(proposal.action);

export const createActionExecutor = (
  overrides: Partial<ActionExecutorDependencies> = {}
): ActionExecutor => {
  const plannerExecutor = overrides.plannerExecutor ?? createPlannerActionExecutor();
  const applicationExecutor = overrides.applicationExecutor ?? createApplicationActionExecutor();
  const fileExecutor = overrides.fileExecutor ?? createFileActionExecutor();
  const weatherExecutor = overrides.weatherExecutor ?? createWeatherActionExecutor();
  const habitExecutor = overrides.habitExecutor ?? createHabitActionExecutor();

  return {
    prepareOrganization: fileExecutor.prepareOrganization,
    execute: (proposal, policy) =>
      isApplicationAction(proposal)
        ? applicationExecutor.execute(proposal, policy)
        : isWeatherAction(proposal)
          ? weatherExecutor.execute(proposal, policy)
        : isHabitAction(proposal)
          ? habitExecutor.execute(proposal, policy)
        : isFileAction(proposal)
          ? fileExecutor.execute(proposal, policy)
          : plannerExecutor.execute(proposal, policy)
  };
};
