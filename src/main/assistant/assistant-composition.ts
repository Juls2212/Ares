import { clarificationInterpretation } from "../../shared/outcome-kit";
import { lowerTrim } from "../../shared/text-fold";
import {
  ASSISTANT_ERROR_CODES,
  type AssistantInterpretation,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import type { ApplicationService } from "../applications/application-service";
import { getApplicationService } from "../applications/application-composition";
import { createAssistantInterpreter } from "./assistant-interpreter";
import { formatInterpretationDiagnostic } from "./interpretation-diagnostic";
import { LOCAL_FIRST_ENABLED } from "./local-brain-config";
import { createRotatingPicker } from "../../shared/phrase-variation";
import { createEventDeletionResolver } from "./assistant-event-reference";
import { getPlannerService } from "../planner/planner-composition";
import { getKnownApplicationProviderReferences } from "../applications/known-application-catalog";
import { getSupervisedFileService } from "../files/supervised-file-composition";
import { getMessagingService } from "../messaging/messaging-composition";
import { getSpotifyAuthService } from "../spotify/spotify-composition";
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
  getContextService?: () => AssistantContextService;
  /** Count-only view of the last file search; it never exposes names or paths. */
  getActiveFileSearch?: () => { resultCount: number } | undefined;
  /** Receives one closed-enum line per turn (never text); defaults to the console. */
  logInfo?: (line: string) => void;
};

const maximumTrustedApplicationAliases = 100;
const requiresTrustedApplicationReferences = (actions: readonly string[]): boolean =>
  actions.some((action) => action === "OPEN_APPLICATION");

const toTrustedApplicationAliases = (
  applications: Awaited<ReturnType<ApplicationService["listApplications"]>>
): string[] => {
  if (!applications.ok) return [];
  return [...new Set(applications.data.items
    .filter((record) => record.isEnabled)
    .flatMap((record) => record.aliases.map((entry) => lowerTrim(entry.alias))))]
    .filter((alias) => alias.length > 0)
    .slice(0, maximumTrustedApplicationAliases);
};

const supportedProviderContext = (context: ReturnType<AssistantContextService["getCachedProviderContext"]>) =>
  context && ["TASK", "EVENT", "REMINDER", "APPLICATION"].includes(context.kind)
    ? context
    : undefined;

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
  data: clarificationInterpretation("¿Qué quieres que haga Ares?", "Necesito una instrucción de texto para interpretarla.")
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
  const logInfo = dependencies.logInfo ?? ((line: string) => console.info(line));
  const reported = (result: AssistantOperationResult<AssistantInterpretation>): AssistantOperationResult<AssistantInterpretation> => {
    try { logInfo(formatInterpretationDiagnostic(result)); } catch { /* diagnostics never affect the turn */ }
    return result;
  };

  return {
    async interpret(input: unknown, webContentsId?: number): Promise<AssistantOperationResult<AssistantInterpretation>> {
      return reported(await interpretTurn(input, webContentsId));
    }
  };

  async function interpretTurn(input: unknown, webContentsId?: number): Promise<AssistantOperationResult<AssistantInterpretation>> {
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
        const reference = {
          knownApplicationAliases: initialApplications ? toTrustedApplicationAliases(initialApplications) : [],
          knownCatalogApplications: getKnownApplicationProviderReferences(),
          ...(dependencies.getActiveFileSearch?.() ? { activeFileSearch: dependencies.getActiveFileSearch() } : {}),
          ...(supportedProviderContext(cachedContext) ? { currentContext: supportedProviderContext(cachedContext) } : {})
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
            const providerContext = currentContext
              ? supportedProviderContext(currentContext.providerContext)
              : undefined;
            return {
              reference: {
                knownApplicationAliases: trustedApplicationAliases,
                knownCatalogApplications: getKnownApplicationProviderReferences(),
                ...(providerContext ? { currentContext: providerContext } : {})
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

let assistantInterpretationService: AssistantInterpretationService | undefined;

/** Rotates between equivalent small-talk phrasings; the seed only decides where the rotation starts. */
const localBrainPicker = createRotatingPicker(Date.now() % 97);

export const getAssistantInterpretationService = (): AssistantInterpretationService => {
  assistantInterpretationService ??= createAssistantInterpretationService({
    getInterpreter: () => createAssistantInterpreter({
      localBrain: { localFirst: LOCAL_FIRST_ENABLED, pick: localBrainPicker },
      resolveEventDeletion: createEventDeletionResolver(getPlannerService),
      getActiveFileSearch: () => getSupervisedFileService().getActiveSearchInfo(),
      resolveFoundFileName: (name) => getSupervisedFileService().resolveFoundFileByName(name),
      resolveFoundFolderName: (name) => getSupervisedFileService().resolveFoundFolderByName(name),
      resolveMessagingContact: (reference) => getMessagingService().resolveContactReference(reference),
      hasActiveMessageDraft: () => getMessagingService().hasActiveDraft(),
      isSpotifyConnected: async () => (await getSpotifyAuthService().getStatus()).connected,
      isSpotifyAppRegistered: async () => {
        const listed = await getApplicationService().listApplications({ enabled: true, limit: 100 });
        return listed.ok && listed.data.items.some(
          (record) => record.isEnabled && record.launchMode === "CATALOG_APPLICATION" && record.catalogKey === "SPOTIFY"
        );
      }
    }),
    getActiveFileSearch: () => getSupervisedFileService().getActiveSearchInfo(),
    getApplicationService,
    getContextService: getAssistantContextService
  });
  return assistantInterpretationService;
};
