import { eq } from "drizzle-orm";

import type { ApplicationCatalogKey } from "../../shared/application-contracts";
import { lowerTrim } from "../../shared/text-fold";
import { getDatabase } from "../database/database-client";
import { settings } from "../database/schema";
import type { ApplicationService } from "./application-service";
import { getKnownApplication } from "./known-application-catalog";

/**
 * Bundled, trusted first-run data. It is called only from Main startup: it is not an action, it has no IPC channel, and the
 * interpreter, renderer and preload never import it. Registering through ApplicationService keeps the same validation and
 * persistence as the confirmed registration path, but there is deliberately no installation check, so a seeded app that is
 * not installed still fails with the existing bounded launch message.
 */
export const SEEDED_CATALOG_KEYS: readonly ApplicationCatalogKey[] = Object.freeze([
  "SPOTIFY",
  "WHATSAPP",
  "GOOGLE_CHROME",
  "CLAUDE",
  "DISCORD"
]);

export const KNOWN_APPLICATIONS_SEEDED_SETTING_KEY = "known_applications_seeded";

export const KNOWN_APPLICATION_SEED_FAILURES = Object.freeze({
  markerUnavailable: "KNOWN_APPS_SEED_MARKER_UNAVAILABLE",
  listFailed: "KNOWN_APPS_SEED_LIST_FAILED",
  registerFailed: "KNOWN_APPS_SEED_REGISTER_FAILED",
  unexpected: "KNOWN_APPS_SEED_UNEXPECTED"
});

export type KnownApplicationSeedMarker = {
  isSet: () => Promise<boolean>;
  set: () => Promise<void>;
};

export type KnownApplicationSeedResult =
  | { status: "SEEDED"; registered: number }
  | { status: "SKIPPED_ALREADY_DONE" }
  | { status: "FAILED"; code: (typeof KNOWN_APPLICATION_SEED_FAILURES)[keyof typeof KNOWN_APPLICATION_SEED_FAILURES] };

type Dependencies = {
  applicationService: Pick<ApplicationService, "listApplications" | "registerApplication">;
  marker: KnownApplicationSeedMarker;
  platform: () => string;
  logError: (message: string) => void;
};

/** Settings-table marker. A removed or renamed seeded app is never re-created once this exists. */
export const createKnownApplicationSeedMarker = (): KnownApplicationSeedMarker => ({
  isSet: async () => {
    const [record] = await getDatabase()
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.settingKey, KNOWN_APPLICATIONS_SEEDED_SETTING_KEY))
      .limit(1);
    return record !== undefined;
  },
  set: async () => {
    await getDatabase()
      .insert(settings)
      .values({ settingKey: KNOWN_APPLICATIONS_SEEDED_SETTING_KEY, value: { version: 1 }, updatedAt: new Date() })
      .onConflictDoNothing();
  }
});

/** Runs once per database and never throws; a failure is one closed-code log line and the next startup retries. */
export const seedKnownApplications = async (
  overrides: Partial<Dependencies> & Pick<Dependencies, "applicationService">
): Promise<KnownApplicationSeedResult> => {
  const dependencies: Dependencies = {
    applicationService: overrides.applicationService,
    marker: overrides.marker ?? createKnownApplicationSeedMarker(),
    platform: overrides.platform ?? (() => process.platform),
    logError: overrides.logError ?? ((message) => console.error(message))
  };
  const fail = (code: (typeof KNOWN_APPLICATION_SEED_FAILURES)[keyof typeof KNOWN_APPLICATION_SEED_FAILURES]): KnownApplicationSeedResult => {
    try { dependencies.logError(`Known application seeding failed [${code}].`); } catch { /* logging never affects startup */ }
    return { status: "FAILED", code };
  };

  try {
    try {
      if (await dependencies.marker.isSet()) return { status: "SKIPPED_ALREADY_DONE" };
    } catch {
      return fail(KNOWN_APPLICATION_SEED_FAILURES.markerUnavailable);
    }
    if (dependencies.platform() !== "win32") return { status: "SEEDED", registered: 0 };

    const listed = await dependencies.applicationService.listApplications({ limit: 100 });
    if (!listed.ok) return fail(KNOWN_APPLICATION_SEED_FAILURES.listFailed);
    const present = listed.data.items;

    let registered = 0;
    let retryable = false;
    for (const key of SEEDED_CATALOG_KEYS) {
      const definition = getKnownApplication(key);
      if (!definition) continue;
      const name = lowerTrim(definition.displayName);
      const alias = lowerTrim(definition.defaultAlias);
      // Anything the person already has (the same catalog app, or the same name or alias) is left untouched.
      if (present.some((record) =>
        record.catalogKey === key || lowerTrim(record.name) === name || record.aliases.some((entry) => lowerTrim(entry.alias) === alias)
      )) continue;
      const result = await dependencies.applicationService.registerApplication({
        name: definition.displayName,
        aliases: [definition.defaultAlias],
        platform: "WINDOWS",
        launchMode: "CATALOG_APPLICATION",
        catalogKey: key,
        isEnabled: true
      });
      if (result.ok) registered += 1;
      else if (result.error.code !== "APPLICATION_CONFLICT") retryable = true;
    }
    if (retryable) return fail(KNOWN_APPLICATION_SEED_FAILURES.registerFailed);

    try {
      await dependencies.marker.set();
    } catch {
      return fail(KNOWN_APPLICATION_SEED_FAILURES.markerUnavailable);
    }
    return { status: "SEEDED", registered };
  } catch {
    return fail(KNOWN_APPLICATION_SEED_FAILURES.unexpected);
  }
};
