import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { getDatabaseUrl } from "../config/database-environment";
import * as schema from "./schema";

export type AresDatabase = NodePgDatabase<typeof schema>;

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

type DatabaseClientDependencies = {
  createPool: (configuration: PoolConfig) => Pool;
  createDatabase: (pool: Pool) => AresDatabase;
  getDatabaseUrl: () => string;
  logError: (message: string) => void;
};

export type DatabaseClient = {
  getDatabase: () => AresDatabase;
  verifyConnection: () => Promise<DatabaseConnectionResult>;
  close: () => Promise<DatabaseShutdownResult>;
};

const createDrizzleDatabase = (pool: Pool): AresDatabase =>
  drizzle({ client: pool, schema });

const defaultDependencies: DatabaseClientDependencies = {
  createPool: (configuration) => new Pool(configuration),
  createDatabase: createDrizzleDatabase,
  getDatabaseUrl,
  logError: (message) => {
    console.error(message);
  }
};

export const createDatabaseClient = (
  overrides: Partial<DatabaseClientDependencies> = {}
): DatabaseClient => {
  const dependencies = { ...defaultDependencies, ...overrides };
  let pool: Pool | undefined;
  let database: AresDatabase | undefined;

  const initialize = (): { pool: Pool; database: AresDatabase } => {
    if (!pool) {
      pool = dependencies.createPool({
        connectionString: dependencies.getDatabaseUrl()
      });
      database = dependencies.createDatabase(pool);
    }

    if (!database) {
      throw new Error("Database initialization did not create a Drizzle instance.");
    }

    return { pool, database };
  };

  return {
    getDatabase: () => initialize().database,
    verifyConnection: async (): Promise<DatabaseConnectionResult> => {
      try {
        const client = await initialize().pool.connect();

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
      if (!pool) {
        return { ok: true };
      }

      const activePool = pool;
      pool = undefined;
      database = undefined;

      try {
        await activePool.end();
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

export const verifyDatabaseConnection = (): Promise<DatabaseConnectionResult> =>
  defaultDatabaseClient.verifyConnection();

export const closeDatabaseConnection = (): Promise<DatabaseShutdownResult> =>
  defaultDatabaseClient.close();
