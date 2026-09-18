import type {
  ActionOutcome,
  ActionPolicy,
  ExecutableActionProposal
} from "../../shared/action-contracts";
import {
  createApplicationActionExecutor,
  type ApplicationActionExecutor
} from "./application-action-executor";
import { createPlannerActionExecutor, type PlannerActionExecutor } from "./planner-action-executor";

export type ActionExecutor = {
  execute: (proposal: ExecutableActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type ActionExecutorDependencies = {
  plannerExecutor?: PlannerActionExecutor;
  applicationExecutor?: ApplicationActionExecutor;
};

export const createActionExecutor = (
  overrides: Partial<ActionExecutorDependencies> = {}
): ActionExecutor => {
  const plannerExecutor = overrides.plannerExecutor ?? createPlannerActionExecutor();
  const applicationExecutor = overrides.applicationExecutor ?? createApplicationActionExecutor();

  return {
    execute: (proposal, policy) =>
      proposal.action === "OPEN_APPLICATION"
        ? applicationExecutor.execute(proposal, policy)
        : plannerExecutor.execute(proposal, policy)
  };
};
