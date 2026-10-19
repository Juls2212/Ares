import type {
  ActionOutcome,
  ActionPolicy,
  OpenApplicationActionProposal,
  OpenWebPageActionProposal,
  RegisterCatalogApplicationActionProposal,
  RequestCustomApplicationRegistrationActionProposal,
  TerminalActionStatus
} from "../../shared/action-contracts";
import { createApplicationLauncher, type ApplicationLauncher } from "../applications/application-launcher";
import { getApplicationService, getCustomApplicationRegistrationService } from "../applications/application-composition";
import type { CustomApplicationRegistrationService } from "../applications/custom-application-registration-service";
import { createWebPageLauncher, type WebPageLauncher } from "../applications/web-page-launcher";
import { CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES } from "../applications/catalog-registration-failures";
import {
  createCatalogApplicationRegistrationService,
  type CatalogApplicationRegistrationService
} from "../applications/catalog-application-registration";

type ApplicationActionProposal =
  | OpenApplicationActionProposal
  | OpenWebPageActionProposal
  | RegisterCatalogApplicationActionProposal
  | RequestCustomApplicationRegistrationActionProposal;

export type ApplicationActionExecutor = {
  execute: (
    proposal: ApplicationActionProposal,
    policy: ActionPolicy
  ) => Promise<ActionOutcome>;
  prepareCatalogRegistration?: (
    proposal: RegisterCatalogApplicationActionProposal
  ) => ReturnType<CatalogApplicationRegistrationService["prepare"]>;
  prepareCustomRegistration?: (
    proposal: RequestCustomApplicationRegistrationActionProposal
  ) => ReturnType<CustomApplicationRegistrationService["prepareSelection"]>;
};

type ApplicationActionExecutorDependencies = {
  launcher?: ApplicationLauncher;
  webPageLauncher?: WebPageLauncher;
  catalogRegistrationService?: CatalogApplicationRegistrationService;
  customRegistrationService?: CustomApplicationRegistrationService;
  logError: (message: string) => void;
};

const failureStatus = (errorCode: string): TerminalActionStatus =>
  CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES.includes(errorCode) ||
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
    catalogRegistrationService: overrides.catalogRegistrationService,
    customRegistrationService: overrides.customRegistrationService,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let launcher = dependencies.launcher;
  let webPageLauncher = dependencies.webPageLauncher;
  let catalogRegistrationService = dependencies.catalogRegistrationService;
  let customRegistrationService = dependencies.customRegistrationService;
  const getCustomRegistrationService = (): CustomApplicationRegistrationService => {
    customRegistrationService ??= getCustomApplicationRegistrationService();
    return customRegistrationService;
  };
  const getLauncher = (): ApplicationLauncher => {
    launcher ??= createApplicationLauncher();
    return launcher;
  };
  const getWebPageLauncher = (): WebPageLauncher => {
    webPageLauncher ??= createWebPageLauncher();
    return webPageLauncher;
  };
  const getCatalogRegistrationService = (): CatalogApplicationRegistrationService => {
    catalogRegistrationService ??= createCatalogApplicationRegistrationService({
      applicationService: getApplicationService()
    });
    return catalogRegistrationService;
  };

  return {
    prepareCatalogRegistration: async (proposal) => getCatalogRegistrationService().prepare(proposal.input),
    prepareCustomRegistration: async (proposal) => getCustomRegistrationService().prepareSelection(proposal.input),
    execute: async (proposal, policy) => {
      try {
        if (proposal.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION") {
          const selectionId = "selectionId" in proposal.input ? proposal.input.selectionId : undefined;
          const result = await getCustomRegistrationService().commitSelection({ selectionId });
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
            userSummary: `Listo, registré ${result.data.applicationName}.`
          };
        }
        if (proposal.action === "REGISTER_CATALOG_APPLICATION") {
          const result = await getCatalogRegistrationService().register(proposal.input);
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
            userSummary: `Listo, registré ${result.data.applicationName} como “${result.data.alias}”.`
          };
        }
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
              : proposal.action === "REGISTER_CATALOG_APPLICATION" || proposal.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION"
                ? "No se pudo registrar la aplicación."
              : "No se pudo abrir la aplicación registrada."
        };
      }
    }
  };
};
