import type {
  ActionOutcome,
  ActionPolicy,
  OpenApplicationActionProposal,
  OpenWebPageActionProposal,
  TerminalActionStatus
} from "../../shared/action-contracts";
import { createApplicationLauncher, type ApplicationLauncher } from "../applications/application-launcher";
import { createWebPageLauncher, type WebPageLauncher } from "../applications/web-page-launcher";

type ApplicationActionProposal = OpenApplicationActionProposal | OpenWebPageActionProposal;

export type ApplicationActionExecutor = {
  execute: (
    proposal: ApplicationActionProposal,
    policy: ActionPolicy
  ) => Promise<ActionOutcome>;
};

type ApplicationActionExecutorDependencies = {
  launcher?: ApplicationLauncher;
  webPageLauncher?: WebPageLauncher;
  logError: (message: string) => void;
};

const failureStatus = (errorCode: string): TerminalActionStatus =>
  errorCode === "APPLICATION_DATABASE_UNAVAILABLE" ||
  errorCode === "APPLICATION_LAUNCH_FAILED" ||
  errorCode === "WEB_PAGE_LAUNCH_FAILED"
    ? "EXECUTION_FAILED"
    : "VALIDATION_FAILED";

export const createApplicationActionExecutor = (
  overrides: Partial<ApplicationActionExecutorDependencies> = {}
): ApplicationActionExecutor => {
  const dependencies: ApplicationActionExecutorDependencies = {
    launcher: overrides.launcher,
    webPageLauncher: overrides.webPageLauncher,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let launcher = dependencies.launcher;
  let webPageLauncher = dependencies.webPageLauncher;
  const getLauncher = (): ApplicationLauncher => {
    launcher ??= createApplicationLauncher();
    return launcher;
  };
  const getWebPageLauncher = (): WebPageLauncher => {
    webPageLauncher ??= createWebPageLauncher();
    return webPageLauncher;
  };

  return {
    execute: async (proposal, policy) => {
      try {
        if (proposal.action === "OPEN_WEB_PAGE") {
          const result = await getWebPageLauncher().launch(proposal.input);
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
            data: { applicationName: result.data.applicationName, destination: result.data.destination },
            userSummary: `Se abrió YouTube en ${result.data.applicationName}.`
          };
        }

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
          userSummary:
            proposal.action === "OPEN_WEB_PAGE"
              ? "No se pudo abrir la página web autorizada."
              : "No se pudo abrir la aplicación registrada."
        };
      }
    }
  };
};
