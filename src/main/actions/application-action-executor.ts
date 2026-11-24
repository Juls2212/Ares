import { failedOutcome, type FailureOutcomeStatus, outcomeIdentity, succeededOutcome } from "../../shared/outcome-kit";
import type {
  ActionOutcome,
  ActionPolicy,
  OpenApplicationActionProposal,
  RegisterCatalogApplicationActionProposal,
  RequestCustomApplicationRegistrationActionProposal,
  SearchSpotifyAppActionProposal,
  SearchSpotifyAppInput
} from "../../shared/action-contracts";
import { createApplicationLauncher, type ApplicationLauncher } from "../applications/application-launcher";
import { getApplicationService, getCustomApplicationRegistrationService } from "../applications/application-composition";
import type { CustomApplicationRegistrationService } from "../applications/custom-application-registration-service";
import { validateSpotifySearchQuery } from "../applications/spotify-search";
import { CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES } from "../applications/catalog-registration-failures";
import {
  createCatalogApplicationRegistrationService,
  type CatalogApplicationRegistrationService
} from "../applications/catalog-application-registration";

type ApplicationActionProposal =
  | OpenApplicationActionProposal
  | SearchSpotifyAppActionProposal
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
  catalogRegistrationService?: CatalogApplicationRegistrationService;
  customRegistrationService?: CustomApplicationRegistrationService;
  logError: (message: string) => void;
};

const failureStatus = (errorCode: string): FailureOutcomeStatus =>
  CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES.includes(errorCode) ||
  errorCode === "APPLICATION_DATABASE_UNAVAILABLE" ||
  errorCode === "APPLICATION_LAUNCH_FAILED"
    ? "EXECUTION_FAILED"
    : "VALIDATION_FAILED";

const SEARCH_KIND_PHRASES: Record<NonNullable<SearchSpotifyAppInput["kind"]>, string> = {
  TRACK: "la canción ",
  ARTIST: "al artista ",
  ALBUM: "el álbum ",
  PLAYLIST: "la playlist ",
  ANY: ""
};

/** Generic text: it may name the query for the person, never a link, and never claims playback. */
const describeSpotifySearch = (query: string, input: SearchSpotifyAppInput): string =>
  `Busqué ${SEARCH_KIND_PHRASES[input.kind ?? "ANY"]}«${query}» en Spotify. Pulsa reproducir cuando quieras.${
    input.playRequested === true
      ? " Para reproducir directamente necesitaré la conexión con Spotify prevista para la próxima fase."
      : ""
  }`;

export const createApplicationActionExecutor = (
  overrides: Partial<ApplicationActionExecutorDependencies> = {}
): ApplicationActionExecutor => {
  const dependencies: ApplicationActionExecutorDependencies = {
    launcher: overrides.launcher,
    catalogRegistrationService: overrides.catalogRegistrationService,
    customRegistrationService: overrides.customRegistrationService,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let launcher = dependencies.launcher;
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
      const identity = outcomeIdentity(proposal, policy);
      try {
        if (proposal.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION") {
          const selectionId = "selectionId" in proposal.input ? proposal.input.selectionId : undefined;
          const result = await getCustomRegistrationService().commitSelection({ selectionId });
          if (!result.ok) {
            return failedOutcome(identity, failureStatus(result.error.code), result.error.code, result.error.userMessage);
          }
          return succeededOutcome(identity, `Listo, registré ${result.data.applicationName}.`, { data: { applicationName: result.data.applicationName } });
        }
        if (proposal.action === "SEARCH_SPOTIFY_APP") {
          const query = validateSpotifySearchQuery(proposal.input.query);
          const result = query === undefined
            ? undefined
            : await getLauncher().searchSpotifyApp(query);
          if (query === undefined || !result || !result.ok) {
            const error = result && !result.ok
              ? result.error
              : { code: "APPLICATION_SPOTIFY_QUERY_INVALID", userMessage: "Indica qué canción, artista o álbum quieres buscar en Spotify." };
            return failedOutcome(identity, failureStatus(error.code), error.code, error.userMessage);
          }
          return succeededOutcome(identity, describeSpotifySearch(query, proposal.input), { data: { applicationName: result.data.applicationName } });
        }
        if (proposal.action === "REGISTER_CATALOG_APPLICATION") {
          const result = await getCatalogRegistrationService().register(proposal.input);
          if (!result.ok) {
            return failedOutcome(identity, failureStatus(result.error.code), result.error.code, result.error.userMessage);
          }
          return succeededOutcome(identity, `Listo, registré ${result.data.applicationName} como “${result.data.alias}”.`, { data: { applicationName: result.data.applicationName } });
        }
        const result = await getLauncher().launchByAlias(proposal.input.alias);
        if (!result.ok) {
          return failedOutcome(identity, failureStatus(result.error.code), result.error.code, result.error.userMessage);
        }

        return succeededOutcome(identity, `Se abrió ${result.data.applicationName}.`, { data: { applicationName: result.data.applicationName } });
      } catch {
        dependencies.logError("Registered application action execution failed.");
        return failedOutcome(
          identity,
          "EXECUTION_FAILED",
          "ACTION_EXECUTION_UNAVAILABLE",
          proposal.action === "REGISTER_CATALOG_APPLICATION" || proposal.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION"
              ? "No pude registrar esa aplicación. Inténtalo de nuevo."
              : "No pude abrir esa aplicación. Revisa que esté instalada."
        );
      }
    }
  };
};
