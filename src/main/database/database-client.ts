import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool, type PoolConfig } from "pg";
import { getDatabaseUrl } from "../config/database-environment";
import { selectDatabaseDriver, type DatabaseDriver } from "./database-driver";
import {
  createPgliteInstance,
  resolveMigrationsDirectory,
  resolvePgliteAssetDirectory,
  resolvePgliteDataDirectory
} from "./pglite-assets.mjs";
import { getRuntimeLocations } from "./runtime-locations";
import * as schema from "./schema";

/**
 * The Drizzle database every repository receives. It is the driver-neutral PostgreSQL database type: both the pg
 * (node-postgres) and the PGlite drivers produce a value assignable to it, so no adapter is needed.
 */
export type AresDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

type PgliteAresDatabase = PgliteDatabase<typeof schema>;

export type DatabaseConnectionResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: "DATABASE_CONNECTION_UNAVAILABLE";
        message: "Database connectivity verification failed.";
      };
    };

export type DatabaseShutdownResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: "DATABASE_POOL_SHUTDOWN_FAILED";
        message: "Database pool shutdown failed.";
      };
    };

export type DatabasePreparationResult =
  | { ok: true }
  | { ok: false; error: { code: "DATABASE_PREPARATION_FAILED"; message: "Database preparation failed." } };

type DatabaseClientDependencies = {
  selectDriver: () => DatabaseDriver;
  createPool: (configuration: PoolConfig) => Pool;
  createDatabase: (pool: Pool) => AresDatabase;
  getDatabaseUrl: () => string;
  createPglite: () => PGlite;
  createPgliteDatabase: (client: PGlite) => PgliteAresDatabase;
  migratePglite: (database: PgliteAresDatabase) => Promise<void>;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

export type DatabaseClient = {
  getDatabase: () => AresDatabase;
  /** Waits for the embedded database to be ready and applies its migrations. It does nothing for PostgreSQL. */
  prepare: () => Promise<DatabasePreparationResult>;
  verifyConnection: () => Promise<DatabaseConnectionResult>;
  close: () => Promise<DatabaseShutdownResult>;
};

const createDrizzleDatabase = (pool: Pool): AresDatabase =>
  drizzle({ client: pool, schema });

const defaultDependencies: DatabaseClientDependencies = {
  selectDriver: () => selectDatabaseDriver(),
  createPool: (configuration) => new Pool(configuration),
  createDatabase: createDrizzleDatabase,
  getDatabaseUrl,
  // The data lives in userData (never logged); the three PGlite files are supplied explicitly.
  createPglite: () => {
    const locations = getRuntimeLocations();
    return createPgliteInstance(PGlite, {
      dataDirectory: resolvePgliteDataDirectory(locations.userDataPath),
      assetDirectory: resolvePgliteAssetDirectory(locations)
    });
  },
  createPgliteDatabase: (client) => drizzlePglite({ client, schema }),
  migratePglite: (database) => migrate(database, { migrationsFolder: resolveMigrationsDirectory(getRuntimeLocations()) }),
  logInfo: (message) => {
    console.info(message);
  },
  logError: (message) => {
    console.error(message);
  }
};

type ActiveConnection =
  | { driver: "POSTGRES"; pool: Pool; database: AresDatabase }
  | { driver: "PGLITE"; client: PGlite; database: PgliteAresDatabase; prepared?: Promise<void> };

export const createDatabaseClient = (
  overrides: Partial<DatabaseClientDependencies> = {}
): DatabaseClient => {
  const dependencies = { ...defaultDependencies, ...overrides };
  let active: ActiveConnection | undefined;

  const initialize = (): ActiveConnection => {
    if (!active) {
      const driver = dependencies.selectDriver();
      dependencies.logInfo(`Database driver [${driver}]`);
      if (driver === "POSTGRES") {
        const pool = dependencies.createPool({ connectionString: dependencies.getDatabaseUrl() });
        active = { driver, pool, database: dependencies.createDatabase(pool) };
      } else {
        const client = dependencies.createPglite();
        active = { driver, client, database: dependencies.createPgliteDatabase(client) };
      }
    }

    if (!active.database) {
      throw new Error("Database initialization did not create a Drizzle instance.");
    }

    return active;
  };

  return {
    getDatabase: () => initialize().database,
    prepare: async (): Promise<DatabasePreparationResult> => {
      try {
        const connection = initialize();
        if (connection.driver === "PGLITE") {
          connection.prepared ??= connection.client.waitReady.then(() => dependencies.migratePglite(connection.database));
          await connection.prepared;
        }
        return { ok: true };
      } catch {
        dependencies.logError("Database preparation failed.");
        return { ok: false, error: { code: "DATABASE_PREPARATION_FAILED", message: "Database preparation failed." } };
      }
    },
    verifyConnection: async (): Promise<DatabaseConnectionResult> => {
      try {
        const connection = initialize();

        if (connection.driver === "PGLITE") {
          await connection.client.query("SELECT 1");
          return { ok: true };
        }

        const client = await connection.pool.connect();

        try {
          await client.query("SELECT 1");
          return { ok: true };
        } finally {
          client.release();
        }
      } catch {
        dependencies.logError("Database connectivity verification failed.");
        return {
          ok: false,
          error: {
            code: "DATABASE_CONNECTION_UNAVAILABLE",
            message: "Database connectivity verification failed."
          }
        };
      }
    },
    close: async (): Promise<DatabaseShutdownResult> => {
      if (!active) {
        return { ok: true };
      }

      const connection = active;
      active = undefined;

      try {
        if (connection.driver === "PGLITE") await connection.client.close();
        else await connection.pool.end();
        return { ok: true };
      } catch {
        dependencies.logError("Database pool shutdown failed.");
        return {
          ok: false,
          error: {
            code: "DATABASE_POOL_SHUTDOWN_FAILED",
            message: "Database pool shutdown failed."
          }
        };
      }
    }
  };
};

const defaultDatabaseClient = createDatabaseClient();

export const getDatabase = (): AresDatabase => defaultDatabaseClient.getDatabase();

export const prepareDatabase = (): Promise<DatabasePreparationResult> => defaultDatabaseClient.prepare();

export const verifyDatabaseConnection = (): Promise<DatabaseConnectionResult> =>
  defaultDatabaseClient.verifyConnection();

export const closeDatabaseConnection = (): Promise<DatabaseShutdownResult> =>
  defaultDatabaseClient.close();
