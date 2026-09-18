import {
  PLANNER_ERROR_CODES,
  type PlannerOperationResult
} from "../../shared/planner-contracts";
import type {
  ActionOutcome,
  ActionPolicy,
  PlannerActionData,
  PlannerActionProposal,
  TerminalActionStatus
} from "../../shared/action-contracts";
import { getPlannerService } from "../planner/planner-composition";
import type { PlannerService } from "../planner/planner-service";

export type PlannerActionExecutor = {
  execute: (proposal: PlannerActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type PlannerActionExecutorDependencies = {
  plannerService?: PlannerService;
  logError: (message: string) => void;
};

const successSummaries: Record<PlannerActionProposal["action"], string> = {
  CREATE_TASK: "Se creó la tarea.",
  UPDATE_TASK: "Se actualizó la tarea.",
  COMPLETE_TASK: "Se completó la tarea.",
  CREATE_EVENT: "Se creó el evento.",
  UPDATE_EVENT: "Se actualizó el evento.",
  CREATE_REMINDER: "Se creó el recordatorio.",
  GET_TODAY_SCHEDULE: "Se consultó la agenda de hoy.",
  GET_WEEK_SCHEDULE: "Se consultó la agenda de la semana."
};

const failureStatus = (errorCode: string): TerminalActionStatus =>
  errorCode === PLANNER_ERROR_CODES.databaseUnavailable
    ? "EXECUTION_FAILED"
    : "VALIDATION_FAILED";

const toOutcome = <T extends PlannerActionData>(
  proposal: PlannerActionProposal,
  policy: ActionPolicy,
  result: PlannerOperationResult<T>
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

export const createPlannerActionExecutor = (
  overrides: Partial<PlannerActionExecutorDependencies> = {}
): PlannerActionExecutor => {
  const dependencies: PlannerActionExecutorDependencies = {
    plannerService: overrides.plannerService,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let plannerService = dependencies.plannerService;
  const getService = (): PlannerService => {
    plannerService ??= getPlannerService();
    return plannerService;
  };

  return {
    execute: async (proposal, policy) => {
      try {
        switch (proposal.action) {
          case "CREATE_TASK":
            return toOutcome(proposal, policy, await getService().createTask(proposal.input));
          case "UPDATE_TASK":
            return toOutcome(proposal, policy, await getService().updateTask(proposal.input));
          case "COMPLETE_TASK":
            return toOutcome(proposal, policy, await getService().completeTask(proposal.input));
          case "CREATE_EVENT":
            return toOutcome(proposal, policy, await getService().createEvent(proposal.input));
          case "UPDATE_EVENT":
            return toOutcome(proposal, policy, await getService().updateEvent(proposal.input));
          case "CREATE_REMINDER":
            return toOutcome(proposal, policy, await getService().createReminder(proposal.input));
          case "GET_TODAY_SCHEDULE":
            return toOutcome(proposal, policy, await getService().getTodaySchedule(proposal.input));
          case "GET_WEEK_SCHEDULE":
            return toOutcome(proposal, policy, await getService().getWeekSchedule(proposal.input));
        }
      } catch {
        dependencies.logError("Planner action execution failed.");
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "EXECUTION_FAILED",
          errorCode: "ACTION_EXECUTION_UNAVAILABLE",
          userSummary: "No se pudo completar la acción solicitada."
        };
      }
    }
  };
};
