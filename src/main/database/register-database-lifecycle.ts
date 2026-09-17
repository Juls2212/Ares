import { closeDatabaseConnection, type DatabaseShutdownResult } from "./database-client";

type MainLifecycle = {
  once: (event: "before-quit", listener: () => void) => unknown;
};

type ShutdownDatabase = () => Promise<DatabaseShutdownResult>;
type LogError = (message: string) => void;

export const createDatabaseShutdownRegistration = (
  shutdownDatabase: ShutdownDatabase = closeDatabaseConnection,
  logError: LogError = (message) => {
    console.error(message);
  }
): ((lifecycle: MainLifecycle) => void) => {
  let registered = false;

  return (lifecycle): void => {
    if (registered) {
      return;
    }

    lifecycle.once("before-quit", () => {
      void shutdownDatabase().catch(() => {
        logError("Database pool shutdown failed.");
      });
    });
    registered = true;
  };
};

export const registerDatabaseShutdown = createDatabaseShutdownRegistration();
