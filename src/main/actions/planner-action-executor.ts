import { failedOutcome, outcomeIdentity, succeededOutcome, type FailureOutcomeStatus } from "../../shared/outcome-kit";
import {
  PLANNER_ERROR_CODES,
  type PlannerOperationResult
} from "../../shared/planner-contracts";
import type {
  ActionName,
  ActionOutcome,
  ActionPolicy,
  PlannerActionData,
  PlannerActionProposal
} from "../../shared/action-contracts";
import { getPlannerService } from "../planner/planner-composition";
import type { PlannerService } from "../planner/planner-service";
import type { TodayScheduleData } from "../../shared/planner-contracts";
import { spokenClock } from "../../shared/spanish-time";
import { describeSchedule } from "./agenda-text";

export type PlannerActionExecutor = {
  execute: (proposal: PlannerActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type PlannerActionExecutorDependencies = {
  plannerService?: PlannerService;
  now: () => Date;
  timeZone: () => string;
  logError: (message: string) => void;
};

const successSummaries: Record<PlannerActionProposal["action"], string> = {
  CREATE_TASK: "Se creó la tarea.",
  UPDATE_TASK: "Se actualizó la tarea.",
  COMPLETE_TASK: "Se completó la tarea.",
  CREATE_EVENT: "Se creó el evento.",
  UPDATE_EVENT: "Se actualizó el evento.",
  CREATE_REMINDER: "Se creó el recordatorio.",
  GET_TODAY_SCHEDULE: "Se consultó la agenda.",
  GET_WEEK_SCHEDULE: "Se consultó la agenda de la semana.",
  GET_CURRENT_DATE_TIME: "Se consultó la fecha y hora actuales.",
  DELETE_EVENT: "Se eliminó el evento.",
  DELETE_TASK: "Se eliminó la tarea."
};

/** Controlled outcome for an action this executor does not handle; it always carries a status and a bounded summary. */
const unsupportedPlannerOutcome = (proposal: { actionId: string; action: ActionName }, policy: ActionPolicy): ActionOutcome =>
  failedOutcome(outcomeIdentity(proposal, policy), "VALIDATION_FAILED", "ACTION_UNSUPPORTED", "No puedo hacer eso.");

const failureStatus = (errorCode: string): FailureOutcomeStatus =>
  errorCode === PLANNER_ERROR_CODES.databaseUnavailable
    ? "EXECUTION_FAILED"
    : "VALIDATION_FAILED";

export const describeCurrentDateTime = (now: Date, timeZone: string): string => {
  const date = new Intl.DateTimeFormat("es-CO", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(now);
  // Said in 12-hour form with the day period: «Son las 3 y 42 de la tarde», «Es la 1 y media de la tarde».
  const clock = spokenClock(time);
  return `Hoy es ${date}. ${clock.startsWith("las ") ? "Son" : "Es"} ${clock}.`;
};

const toOutcome = <T extends PlannerActionData>(
  proposal: PlannerActionProposal,
  policy: ActionPolicy,
  result: PlannerOperationResult<T>,
  timeZone: string,
  now: Date = new Date()
): ActionOutcome => {
  if (result.ok) {
    if (proposal.action === "GET_TODAY_SCHEDULE") {
      // The words of the agenda are for the screen and the voice only; history keeps a fixed sentence.
      const texts = describeSchedule(result.data as TodayScheduleData, now, timeZone);
      return succeededOutcome(outcomeIdentity(proposal, policy), texts.display, { data: { ...result.data, spokenSummary: texts.spoken } as T });
    }
    return succeededOutcome(outcomeIdentity(proposal, policy), successSummaries[proposal.action], { data: result.data });
  }

  return failedOutcome(
    outcomeIdentity(proposal, policy),
    failureStatus(result.error.code),
    result.error.code,
    result.error.userMessage
  );
};

export const createPlannerActionExecutor = (
  overrides: Partial<PlannerActionExecutorDependencies> = {}
): PlannerActionExecutor => {
  const dependencies: PlannerActionExecutorDependencies = {
    plannerService: overrides.plannerService,
    now: overrides.now ?? (() => new Date()),
    timeZone: overrides.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone),
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
            return toOutcome(proposal, policy, await getService().createTask(proposal.input), dependencies.timeZone());
          case "UPDATE_TASK":
            return toOutcome(proposal, policy, await getService().updateTask(proposal.input), dependencies.timeZone());
          case "COMPLETE_TASK":
            return toOutcome(proposal, policy, await getService().completeTask(proposal.input), dependencies.timeZone());
          case "CREATE_EVENT":
            return toOutcome(proposal, policy, await getService().createEvent(proposal.input), dependencies.timeZone());
          case "UPDATE_EVENT":
            return toOutcome(proposal, policy, await getService().updateEvent(proposal.input), dependencies.timeZone());
          case "CREATE_REMINDER":
            return toOutcome(proposal, policy, await getService().createReminder(proposal.input), dependencies.timeZone());
          case "GET_TODAY_SCHEDULE":
            return toOutcome(proposal, policy, await getService().getTodaySchedule(proposal.input), dependencies.timeZone(), dependencies.now());
          case "GET_WEEK_SCHEDULE":
            return toOutcome(proposal, policy, await getService().getWeekSchedule(proposal.input), dependencies.timeZone());
          case "GET_CURRENT_DATE_TIME":
            return succeededOutcome(
              outcomeIdentity(proposal, policy),
              describeCurrentDateTime(dependencies.now(), dependencies.timeZone()),
              { data: {} }
            );
          case "DELETE_EVENT":
            return toOutcome(proposal, policy, await getService().deleteEvent(proposal.input), dependencies.timeZone());
          case "DELETE_TASK":
            return toOutcome(proposal, policy, await getService().deleteTask(proposal.input), dependencies.timeZone());
          default: {
            // Compile-time exhaustiveness: a new action name that is not handled above fails typecheck here.
            const unhandled: never = proposal;
            return unsupportedPlannerOutcome(unhandled, policy);
          }
        }
      } catch {
        dependencies.logError("Planner action execution failed.");
        return failedOutcome(
          outcomeIdentity(proposal, policy),
          "EXECUTION_FAILED",
          "ACTION_EXECUTION_UNAVAILABLE",
          "No pude hacer eso. Inténtalo de nuevo."
        );
      }
    }
  };
};
