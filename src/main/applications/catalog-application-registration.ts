import type {
  ApplicationCatalogKey,
  ApplicationOperationResult
} from "../../shared/application-contracts";
import { validateApplicationAlias } from "./application-validation";
import type { ApplicationService } from "./application-service";
import { createCatalogApplicationAdapter, type CatalogApplicationAdapter } from "./catalog-application-adapter";
import { CATALOG_REGISTRATION_FAILURES, catalogRegistrationFailure } from "./catalog-registration-failures";
import { getKnownApplication } from "./known-application-catalog";

export type CatalogApplicationRegistrationInput = {
  catalogKey: ApplicationCatalogKey;
  alias?: string;
};

export type PreparedCatalogApplicationRegistration = {
  catalogKey: ApplicationCatalogKey;
  alias: string;
  applicationName: string;
};

export type CatalogApplicationRegistrationService = {
  prepare: (input: unknown) => Promise<ApplicationOperationResult<PreparedCatalogApplicationRegistration>>;
  register: (input: unknown) => Promise<ApplicationOperationResult<PreparedCatalogApplicationRegistration>>;
};

type Dependencies = {
  applicationService: Pick<ApplicationService, "listApplications" | "registerApplication">;
  adapter: CatalogApplicationAdapter;
  logError: (message: string) => void;
};

const parse = (input: unknown): CatalogApplicationRegistrationInput | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "catalogKey" && key !== "alias")) return undefined;
  if (typeof value.catalogKey !== "string") return undefined;
  if (value.alias !== undefined && typeof value.alias !== "string") return undefined;
  return { catalogKey: value.catalogKey as ApplicationCatalogKey, ...(value.alias === undefined ? {} : { alias: value.alias }) };
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase("en-US");

export const createCatalogApplicationRegistrationService = (
  overrides: Partial<Dependencies> & Pick<Dependencies, "applicationService">
): CatalogApplicationRegistrationService => {
  const dependencies: Dependencies = {
    applicationService: overrides.applicationService,
    adapter: overrides.adapter ?? createCatalogApplicationAdapter(),
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  const prepare = async (input: unknown): Promise<ApplicationOperationResult<PreparedCatalogApplicationRegistration>> => {
    const parsed = parse(input);
    const definition = parsed ? getKnownApplication(parsed.catalogKey) : undefined;
    if (!parsed || !definition) return catalogRegistrationFailure("UNKNOWN_CATALOG_KEY");
    const aliasResult = validateApplicationAlias(parsed.alias ?? definition.defaultAlias);
    if (!aliasResult.ok) return aliasResult;
    try {
      if (dependencies.adapter.getCurrentPlatform() !== "WINDOWS") {
        return catalogRegistrationFailure("UNSUPPORTED_PLATFORM");
      }
      const applications = await dependencies.applicationService.listApplications({ limit: 100 });
      if (!applications.ok) {
        dependencies.logError("Catalog application registration could not list applications.");
        return catalogRegistrationFailure("PERSISTENCE_FAILED");
      }
      const normalizedAlias = normalize(aliasResult.data);
      const normalizedName = normalize(definition.displayName);
      if (applications.data.items.some((record) => record.catalogKey === definition.key)) {
        return catalogRegistrationFailure("ALREADY_REGISTERED");
      }
      // Registration rejects a repeated name, so it is reported here rather than after the user confirms.
      if (applications.data.items.some((record) =>
        normalize(record.name) === normalizedName || record.aliases.some((entry) => normalize(entry.alias) === normalizedAlias)
      )) {
        return catalogRegistrationFailure("ALIAS_CONFLICT");
      }
      const available = await dependencies.adapter.isAvailable(definition.key);
      if (!available.ok) return catalogRegistrationFailure("NOT_AVAILABLE");
      return { ok: true, data: { catalogKey: definition.key, alias: aliasResult.data, applicationName: definition.displayName } };
    } catch {
      dependencies.logError("Catalog application registration preparation failed.");
      return catalogRegistrationFailure("PREPARATION_FAILED");
    }
  };

  return {
    prepare,
    register: async (input) => {
      const prepared = await prepare(input);
      if (!prepared.ok) return prepared;
      const platform = dependencies.adapter.getCurrentPlatform();
      if (!platform) return catalogRegistrationFailure("UNSUPPORTED_PLATFORM");
      try {
        const registered = await dependencies.applicationService.registerApplication({
          name: prepared.data.applicationName,
          aliases: [prepared.data.alias],
          platform,
          launchMode: "CATALOG_APPLICATION",
          catalogKey: prepared.data.catalogKey,
          isEnabled: true
        });
        if (!registered.ok) {
          dependencies.logError("Catalog application registration failed.");
          return catalogRegistrationFailure(
            registered.error.code === CATALOG_REGISTRATION_FAILURES.ALIAS_CONFLICT.code
              ? "ALIAS_CONFLICT"
              : "PERSISTENCE_FAILED"
          );
        }
      } catch {
        dependencies.logError("Catalog application registration threw unexpectedly.");
        return catalogRegistrationFailure("PERSISTENCE_FAILED");
      }
      return { ok: true, data: prepared.data };
    }
  };
};
