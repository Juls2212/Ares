import { loadDevelopmentEnvironment } from "../config/development-environment";

export type DatabaseDriver = "POSTGRES" | "PGLITE";

/**
 * The single source of truth for the database driver: a configured DATABASE_URL (process environment, the
 * development .env or the user-level ares.env) selects PostgreSQL through pg; otherwise the embedded PGlite is used.
 */
export const selectDatabaseDriver = (environment: NodeJS.ProcessEnv = process.env): DatabaseDriver => {
  if (environment === process.env) loadDevelopmentEnvironment();
  return environment.DATABASE_URL?.trim() ? "POSTGRES" : "PGLITE";
};
