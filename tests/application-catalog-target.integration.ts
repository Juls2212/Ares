import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createApplicationService } from "../src/main/applications/application-service";
import { closeDatabaseConnection, getDatabase } from "../src/main/database/database-client";
import { applicationAliases, applications } from "../src/main/database/schema";
import type { ApplicationOperationResult } from "../src/shared/application-contracts";

const database = getDatabase();
const applicationService = createApplicationService({ logError: () => undefined });
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const createdApplicationIds: string[] = [];

const getSuccessData = <T>(result: ApplicationOperationResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected successful application operation: ${result.error.code}`);
  return result.data;
};

afterEach(async () => {
  if (createdApplicationIds.length > 0) {
    await database.delete(applicationAliases).where(inArray(applicationAliases.applicationId, createdApplicationIds));
    await database.delete(applications).where(inArray(applications.id, createdApplicationIds));
    createdApplicationIds.length = 0;
  }
});

afterAll(async () => {
  await closeDatabaseConnection();
});

describe("application catalog target persistence", () => {
  it("preserves existing records as legacy Windows executable targets and persists catalog targets without paths", async () => {
    const existingRecords = await database
      .select({
        platform: applications.platform,
        launchMode: applications.launchMode,
        catalogKey: applications.catalogKey,
        executablePath: applications.executablePath
      })
      .from(applications);

    for (const record of existingRecords) {
      expect(
        (record.launchMode === "WINDOWS_EXECUTABLE" &&
          record.platform === "WINDOWS" &&
          record.catalogKey === null &&
          record.executablePath !== null) ||
          (record.launchMode === "CATALOG_APPLICATION" &&
            record.catalogKey !== null &&
            record.executablePath === null)
      ).toBe(true);
    }

    const legacy = getSuccessData(
      await applicationService.registerApplication({
        name: `Legacy application ${suffix}`,
        executablePath: `C:\\Program Files\\Ares Tests\\legacy-${suffix}.exe`,
        aliases: [`Legacy ${suffix}`]
      })
    ).record;
    const catalog = getSuccessData(
      await applicationService.registerApplication({
        name: `Catalog application ${suffix}`,
        aliases: [`Catalog ${suffix}`],
        platform: "LINUX",
        launchMode: "CATALOG_APPLICATION",
        catalogKey: "SPOTIFY"
      })
    ).record;
    createdApplicationIds.push(legacy.id, catalog.id);

    const persisted = await database
      .select({
        id: applications.id,
        platform: applications.platform,
        launchMode: applications.launchMode,
        catalogKey: applications.catalogKey,
        executablePath: applications.executablePath
      })
      .from(applications)
      .where(inArray(applications.id, [legacy.id, catalog.id]));

    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: legacy.id,
          platform: "WINDOWS",
          launchMode: "WINDOWS_EXECUTABLE",
          catalogKey: null
        }),
        expect.objectContaining({
          id: catalog.id,
          platform: "LINUX",
          launchMode: "CATALOG_APPLICATION",
          catalogKey: "SPOTIFY",
          executablePath: null
        })
      ])
    );
    expect(JSON.stringify(catalog)).not.toContain("executablePath");
  });

  it("enforces catalog targets without a persisted executable path", async () => {
    await expect(
      database.insert(applications).values({
        name: `Invalid catalog target ${suffix}`,
        platform: "MACOS",
        launchMode: "CATALOG_APPLICATION",
        catalogKey: "SPOTIFY",
        executablePath: "/Applications/Spotify.app"
      })
    ).rejects.toBeDefined();

    const rows = await database
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.name, `Invalid catalog target ${suffix}`));
    expect(rows).toHaveLength(0);
  });
});
