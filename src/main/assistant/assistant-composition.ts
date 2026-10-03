import {
  ASSISTANT_ERROR_CODES,
  type AssistantInterpretation,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import type { ApplicationService } from "../applications/application-service";
import { getApplicationService } from "../applications/application-composition";
import { createAssistantInterpreter } from "./assistant-interpreter";
import { createEventDeletionResolver } from "./assistant-event-reference";
import { getPlannerService } from "../planner/planner-composition";
import type { PlannerService } from "../planner/planner-service";
import { createWeeklyScheduleReferenceResolver } from "../actions/weekly-schedule-analysis";
import {
  getAssistantContextService,
  type AssistantContextService
} from "./assistant-context-service";

export type AssistantInterpreter = ReturnType<typeof createAssistantInterpreter>;

export type AssistantInterpretationService = {
  interpret(input: unknown, webContentsId?: number): Promise<AssistantOperationResult<AssistantInterpretation>>;
};

type AssistantInterpretationServiceDependencies = {
  getInterpreter: () => AssistantInterpreter;
  getApplicationService: () => Pick<ApplicationService, "listApplications">;
  getPlannerService?: () => Pick<PlannerService, "listWeeklySchedules">;
  getContextService?: () => AssistantContextService;
};

const maximumTrustedApplicationAliases = 100;
const maximumTrustedWeeklyScheduleTitles = 50;
const requiresTrustedApplicationReferences = (actions: readonly string[]): boolean =>
  actions.some((action) => action === "OPEN_APPLICATION" || action === "OPEN_WEB_PAGE");

const toTrustedApplicationAliases = (
  applications: Awaited<ReturnType<ApplicationService["listApplications"]>>
): string[] => {
  if (!applications.ok) return [];
  return [...new Set(applications.data.items
    .filter((record) => record.isEnabled)
    .flatMap((record) => record.aliases.map((entry) => entry.alias.trim().toLocaleLowerCase("en-US"))))]
    .filter((alias) => alias.length > 0)
    .slice(0, maximumTrustedApplicationAliases);
};

const toTrustedWeeklyScheduleTitles = (
  schedules: Awaited<ReturnType<PlannerService["listWeeklySchedules"]>>
): string[] => {
  if (!schedules.ok) return [];
  return [...new Set(schedules.data.items
    .map((schedule) => schedule.title.trim().replace(/\s+/g, " "))
    .filter((title) => title.length > 0))]
    .slice(0, maximumTrustedWeeklyScheduleTitles);
};

const unavailable = (
  code: "ASSISTANT_BUSY" | "ASSISTANT_IPC_UNAVAILABLE"
): AssistantOperationResult<AssistantInterpretation> => ({
  ok: true,
  data: {
    state: "UNAVAILABLE",
    summary:
      code === ASSISTANT_ERROR_CODES.busy
        ? "Ares ya está interpretando una solicitud. Inténtalo de nuevo cuando termine."
        : "La interpretación no está disponible en este momento.",
    drafts: [],
    clarifications: [],
    errorCode: code
  }
});

const clarification = (): AssistantOperationResult<AssistantInterpretation> => ({
  ok: true,
  data: {
    state: "NEEDS_CLARIFICATION",
    summary: "Necesito una instrucción de texto para interpretarla.",
    drafts: [],
    clarifications: [{ question: "¿Qué quieres que haga Ares?" }]
  }
});

const normalizeRequest = (input: unknown): { instruction: string } | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const request = input as Record<string, unknown>;
  if (Object.keys(request).length !== 1 || !Object.prototype.hasOwnProperty.call(request, "text")) {
    return undefined;
  }
  return typeof request.text === "string" ? { instruction: request.text } : undefined;
};

/** A single Main-process gate prevents parallel paid interpretation requests. */
export const createAssistantInterpretationService = (
  dependencies: AssistantInterpretationServiceDependencies
): AssistantInterpretationService => {
  let inFlight = false;

  return {
    async interpret(input: unknown, webContentsId?: number): Promise<AssistantOperationResult<AssistantInterpretation>> {
      const normalizedInput = normalizeRequest(input);
      if (!normalizedInput) return clarification();
      if (inFlight) return unavailable(ASSISTANT_ERROR_CODES.busy);

      inFlight = true;
      try {
        const contextService = dependencies.getContextService?.();
        const cachedContext =
          webContentsId === undefined ? undefined : contextService?.getCachedProviderContext?.(webContentsId);
        const initialApplications = await dependencies.getApplicationService().listApplications({
          enabled: true,
          limit: maximumTrustedApplicationAliases
        }).catch(() => undefined);
        const plannerService = dependencies.getPlannerService?.();
        const initialWeeklySchedules = plannerService
          ? await plannerService.listWeeklySchedules({}).catch(() => undefined)
          : undefined;
        const reference = {
          knownApplicationAliases: initialApplications ? toTrustedApplicationAliases(initialApplications) : [],
          ...(plannerService ? { knownWeeklyScheduleTitles: initialWeeklySchedules ? toTrustedWeeklyScheduleTitles(initialWeeklySchedules) : [] } : {}),
          ...(cachedContext ? { currentContext: cachedContext } : {})
        };
        return await dependencies.getInterpreter().interpret(
          normalizedInput,
          reference,
          undefined,
          async (draftActions) => {
            let trustedApplicationAliases: string[] = [];
            if (requiresTrustedApplicationReferences(draftActions)) {
              const applications = await dependencies.getApplicationService().listApplications({
                enabled: true,
                limit: maximumTrustedApplicationAliases
              });
              if (!applications.ok) return undefined;
              trustedApplicationAliases = toTrustedApplicationAliases(applications);
            }
            const currentContext =
              webContentsId === undefined || !contextService
                ? undefined
                : await contextService.getValidated(webContentsId);
            return {
              reference: {
                knownApplicationAliases: trustedApplicationAliases,
                ...(currentContext ? { currentContext: currentContext.providerContext } : {})
              },
              currentContext
            };
          }
        );
      } catch {
        return unavailable(ASSISTANT_ERROR_CODES.ipcUnavailable);
      } finally {
        inFlight = false;
      }
    }
  };
};

let assistantInterpretationService: AssistantInterpretationService | undefined;

export const getAssistantInterpretationService = (): AssistantInterpretationService => {
  assistantInterpretationService ??= createAssistantInterpretationService({
    getInterpreter: () => createAssistantInterpreter({
      resolveEventDeletion: createEventDeletionResolver(getPlannerService),
      resolveWeeklyScheduleTitle: createWeeklyScheduleReferenceResolver(getPlannerService)
    }),
    getApplicationService,
    getPlannerService,
    getContextService: getAssistantContextService
  });
  return assistantInterpretationService;
};
