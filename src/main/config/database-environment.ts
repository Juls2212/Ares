import dotenv from "dotenv";

export class MainConfigurationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "MainConfigurationError";
    this.code = code;
  }
}

const isPostgresProtocol = (protocol: string): boolean =>
  protocol === "postgres:" || protocol === "postgresql:";

export const getDatabaseUrl = (
  environment: NodeJS.ProcessEnv = process.env
): string => {
  // Development secrets are read only when trusted Main code first needs the database.
  // Explicit environments keep configuration tests and callers fully deterministic.
  if (environment === process.env) {
    dotenv.config({ quiet: true });
  }

  const databaseUrl = environment.DATABASE_URL;

  if (!databaseUrl) {
    throw new MainConfigurationError(
      "DATABASE_URL_MISSING",
      "DATABASE_URL is required before database access."
    );
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    const databaseName = parsedUrl.pathname.replace(/^\//, "");

    if (!isPostgresProtocol(parsedUrl.protocol) || !parsedUrl.hostname || !databaseName) {
      throw new MainConfigurationError(
        "DATABASE_URL_INVALID",
        "DATABASE_URL must be a PostgreSQL URL with a host and database name."
      );
    }
  } catch (error) {
    if (error instanceof MainConfigurationError) {
      throw error;
    }

    throw new MainConfigurationError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL must be a valid PostgreSQL URL."
    );
  }

  return databaseUrl;
};
