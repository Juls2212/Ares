import { closeDatabaseConnection, type DatabaseShutdownResult } from "../database/database-client";
import { getReminderDeliveryScheduler } from "./reminder-composition";
import type { ReminderDeliveryScheduler } from "./reminder-delivery-scheduler";

const SHUTDOWN_TIMEOUT_MS = 5_000;

type BeforeQuitEvent = {
  preventDefault: () => void;
};

type MainLifecycle = {
  once: (event: "before-quit", listener: (event: BeforeQuitEvent) => void) => unknown;
  quit: () => void;
};

type ShutdownDatabase = () => Promise<DatabaseShutdownResult>;
type TimerDependencies = {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
};

type ReminderLifecycleDependencies = {
  scheduler: ReminderDeliveryScheduler;
  shutdownDatabase: ShutdownDatabase;
  timer: TimerDependencies;
  logError: (message: string) => void;
};

const waitForSchedulerStop = async (
  stop: () => Promise<void>,
  timer: TimerDependencies
): Promise<"STOPPED" | "FAILED" | "TIMED_OUT"> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      stop().then(
        () => "STOPPED" as const,
        () => "FAILED" as const
      ),
      new Promise<"TIMED_OUT">((resolve) => {
        timeoutHandle = timer.setTimeout(() => resolve("TIMED_OUT"), SHUTDOWN_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutHandle !== undefined) timer.clearTimeout(timeoutHandle);
  }
};

/**
 * Prevents the first quit, waits briefly for the scheduler's in-flight tick,
 * then closes the Main-only database pool and reissues quit after this once
 * listener has been removed. The timeout keeps shutdown bounded if a driver
 * operation becomes unresponsive.
 */
export const createReminderDeliveryShutdownRegistration = (
  overrides: Partial<ReminderLifecycleDependencies> = {}
): ((lifecycle: MainLifecycle) => void) => {
  const dependencies: ReminderLifecycleDependencies = {
    scheduler: overrides.scheduler ?? getReminderDeliveryScheduler(),
    shutdownDatabase: overrides.shutdownDatabase ?? closeDatabaseConnection,
    timer:
      overrides.timer ??
      ({
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (handle) => clearTimeout(handle)
      } satisfies TimerDependencies),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let registered = false;
  let shutdownStarted = false;

  return (lifecycle): void => {
    if (registered) return;

    lifecycle.once("before-quit", (event) => {
      event.preventDefault();
      if (shutdownStarted) return;
      shutdownStarted = true;

      void (async () => {
        const schedulerStop = await waitForSchedulerStop(dependencies.scheduler.stop, dependencies.timer);
        if (schedulerStop === "FAILED") {
          dependencies.logError("Reminder scheduler shutdown failed.");
        }
        if (schedulerStop === "TIMED_OUT") {
          dependencies.logError("Reminder scheduler shutdown timed out.");
        }

        try {
          const databaseResult = await dependencies.shutdownDatabase();
          if (!databaseResult.ok) {
            dependencies.logError("Database pool shutdown failed.");
          }
        } catch {
          dependencies.logError("Database pool shutdown failed.");
        }

        lifecycle.quit();
      })();
    });
    registered = true;
  };
};

export const registerReminderDeliveryShutdown = createReminderDeliveryShutdownRegistration();
