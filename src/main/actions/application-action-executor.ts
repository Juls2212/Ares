import type {
  ActionOutcome,
  ActionPolicy,
  OpenApplicationActionProposal,
  TerminalActionStatus
} from "../../shared/action-contracts";
import { createApplicationLauncher, type ApplicationLauncher } from "../applications/application-launcher";

export type ApplicationActionExecutor = {
  execute: (
    proposal: OpenApplicationActionProposal,
    policy: ActionPolicy
  ) => Promise<ActionOutcome>;
};

type ApplicationActionExecutorDependencies = {
  launcher?: ApplicationLauncher;
  logError: (message: string) => void;
};

const failureStatus = (errorCode: string): TerminalActionStatus =>
  errorCode === "APPLICATION_DATABASE_UNAVAILABLE" || errorCode === "APPLICATION_LAUNCH_FAILED"
    ? "EXECUTION_FAILED"
    : "VALIDATION_FAILED";

export const createApplicationActionExecutor = (
  overrides: Partial<ApplicationActionExecutorDependencies> = {}
): ApplicationActionExecutor => {
  const dependencies: ApplicationActionExecutorDependencies = {
    launcher: overrides.launcher,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let launcher = dependencies.launcher;
  const getLauncher = (): ApplicationLauncher => {
    launcher ??= createApplicationLauncher();
    return launcher;
  };

  return {
    execute: async (proposal, policy) => {
      try {
        const result = await getLauncher().launchByAlias(proposal.input.alias);
        if (!result.ok) {
          return {
            actionId: proposal.actionId,
            action: proposal.action,
            riskLevel: policy.riskLevel,
            status: failureStatus(result.error.code),
            errorCode: result.error.code,
            userSummary: result.error.userMessage
          };
        }

        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "SUCCEEDED",
          data: { applicationName: result.data.applicationName },
          userSummary: `Se abrió ${result.data.applicationName}.`
        };
      } catch {
        dependencies.logError("Registered application action execution failed.");
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "EXECUTION_FAILED",
          errorCode: "ACTION_EXECUTION_UNAVAILABLE",
          userSummary: "No se pudo abrir la aplicación registrada."
        };
      }
    }
  };
};
