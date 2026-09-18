import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  ApplicationAliasRecord,
  ApplicationListInput,
  ApplicationPlatform,
  ApplicationRecord,
  RegisterApplicationInput,
  UpdateApplicationInput
} from "../../shared/application-contracts";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { applicationAliases, applications } from "../database/schema";

type DatabaseApplication = typeof applications.$inferSelect;
type DatabaseApplicationAlias = typeof applicationAliases.$inferSelect;

export type ResolvedApplicationTarget = {
  id: string;
  name: string;
  platform: ApplicationPlatform;
  executablePath: string;
  isEnabled: boolean;
};

export class ApplicationRepositoryError extends Error {
  public constructor(public readonly kind: "CONFLICT" | "UNAVAILABLE") {
    super("Application persistence operation failed.");
  }
}

export type ApplicationRepositories = {
  registerApplication: (input: RegisterApplicationInput) => Promise<ApplicationRecord>;
  listApplications: (input: ApplicationListInput) => Promise<ApplicationRecord[]>;
  updateApplication: (input: UpdateApplicationInput) => Promise<ApplicationRecord | undefined>;
  findApplicationIdByNormalizedName: (name: string) => Promise<string | undefined>;
  resolveApplicationByAlias: (alias: string) => Promise<ResolvedApplicationTarget | undefined>;
};

const toIsoDateTime = (value: Date | null): string | null => (value ? value.toISOString() : null);

const toAliasRecord = (record: DatabaseApplicationAlias): ApplicationAliasRecord => ({
  id: record.id,
  applicationId: record.applicationId,
  alias: record.alias,
  createdAt: record.createdAt.toISOString()
});

export const toApplicationRecord = (
  record: DatabaseApplication,
  aliases: DatabaseApplicationAlias[]
): ApplicationRecord => ({
  id: record.id,
  name: record.name,
  platform: record.platform,
  isFavorite: record.isFavorite,
  isEnabled: record.isEnabled,
  lastLaunchedAt: toIsoDateTime(record.lastLaunchedAt),
  aliases: aliases.map(toAliasRecord),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
});

const findDatabaseErrorCode = (error: unknown): unknown => {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { code?: unknown; cause?: unknown };
  return record.code ?? findDatabaseErrorCode(record.cause);
};

const mapPersistenceError = (error: unknown): ApplicationRepositoryError => {
  const code = findDatabaseErrorCode(error);
  return code === "23505"
    ? new ApplicationRepositoryError("CONFLICT")
    : new ApplicationRepositoryError("UNAVAILABLE");
};

const executePersistence = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw mapPersistenceError(error);
  }
};

export const createApplicationRepositories = (
  database: AresDatabase = getDatabase()
): ApplicationRepositories => {
  const getAliasesForApplicationIds = async (
    applicationIds: string[]
  ): Promise<Map<string, DatabaseApplicationAlias[]>> => {
    const aliasesByApplicationId = new Map<string, DatabaseApplicationAlias[]>();
    if (applicationIds.length === 0) return aliasesByApplicationId;

    const aliases = await database
      .select()
      .from(applicationAliases)
      .where(inArray(applicationAliases.applicationId, applicationIds))
      .orderBy(asc(sql`lower(btrim(${applicationAliases.alias}))`), asc(applicationAliases.id));

    for (const alias of aliases) {
      const applicationAliasesForRecord = aliasesByApplicationId.get(alias.applicationId) ?? [];
      applicationAliasesForRecord.push(alias);
      aliasesByApplicationId.set(alias.applicationId, applicationAliasesForRecord);
    }
    return aliasesByApplicationId;
  };

  const toPublicRecord = async (record: DatabaseApplication): Promise<ApplicationRecord> => {
    const aliasesByApplicationId = await getAliasesForApplicationIds([record.id]);
    return toApplicationRecord(record, aliasesByApplicationId.get(record.id) ?? []);
  };

  return {
    registerApplication: (input) =>
      executePersistence(async () => {
        const record = await database.transaction(async (transaction) => {
          const [createdApplication] = await transaction
            .insert(applications)
            .values({
              name: input.name,
              executablePath: input.executablePath,
              platform: input.platform ?? "WINDOWS",
              isFavorite: input.isFavorite ?? false,
              isEnabled: input.isEnabled ?? true
            })
            .returning();

          await transaction.insert(applicationAliases).values(
            input.aliases.map((alias) => ({ applicationId: createdApplication.id, alias }))
          );

          return createdApplication;
        });
        return toPublicRecord(record);
      }),
    listApplications: (input) =>
      executePersistence(async () => {
        const conditions = [
          ...(input.enabled === undefined ? [] : [eq(applications.isEnabled, input.enabled)]),
          ...(input.favorite === undefined ? [] : [eq(applications.isFavorite, input.favorite)])
        ];
        const records = await database
          .select()
          .from(applications)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(asc(sql`lower(btrim(${applications.name}))`), asc(applications.id))
          .limit(input.limit ?? 50);
        const aliasesByApplicationId = await getAliasesForApplicationIds(records.map((record) => record.id));
        return records.map((record) =>
          toApplicationRecord(record, aliasesByApplicationId.get(record.id) ?? [])
        );
      }),
    updateApplication: (input) =>
      executePersistence(async () => {
        const record = await database.transaction(async (transaction) => {
          const [updatedApplication] = await transaction
            .update(applications)
            .set({
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.executablePath === undefined
                ? {}
                : { executablePath: input.executablePath }),
              ...(input.isFavorite === undefined ? {} : { isFavorite: input.isFavorite }),
              ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
              updatedAt: new Date()
            })
            .where(eq(applications.id, input.applicationId))
            .returning();

          if (!updatedApplication) return undefined;
          if (input.aliases !== undefined) {
            await transaction
              .delete(applicationAliases)
              .where(eq(applicationAliases.applicationId, input.applicationId));
            await transaction.insert(applicationAliases).values(
              input.aliases.map((alias) => ({ applicationId: input.applicationId, alias }))
            );
          }
          return updatedApplication;
        });

        return record ? toPublicRecord(record) : undefined;
      }),
    findApplicationIdByNormalizedName: (name) =>
      executePersistence(async () => {
        const [record] = await database
          .select({ id: applications.id })
          .from(applications)
          .where(sql`lower(btrim(${applications.name})) = ${name.toLocaleLowerCase("en-US")}`);
        return record?.id;
      }),
    resolveApplicationByAlias: (alias) =>
      executePersistence(async () => {
        const [record] = await database
          .select({
            id: applications.id,
            name: applications.name,
            platform: applications.platform,
            executablePath: applications.executablePath,
            isEnabled: applications.isEnabled
          })
          .from(applicationAliases)
          .innerJoin(applications, eq(applicationAliases.applicationId, applications.id))
          .where(sql`lower(btrim(${applicationAliases.alias})) = ${alias.toLocaleLowerCase("en-US")}`);

        return record;
      })
  };
};
