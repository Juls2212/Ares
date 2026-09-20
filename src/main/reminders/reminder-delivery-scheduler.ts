import {
  createReminderDeliveryService,
  type ReminderDeliveryRunResult,
  type ReminderDeliveryService
} from "./reminder-delivery-service";

export const DEFAULT_REMINDER_DELIVERY_INTERVAL_MS = 30_000;

type TimerHandle = ReturnType<typeof setInterval>;

type ReminderDeliverySchedulerDependencies = {
  service?: ReminderDeliveryService;
  intervalMs: number;
  setInterval: (callback: () => void, intervalMs: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
  logError: (message: string) => void;
};

export type ReminderDeliveryScheduler = {
  start: () => void;
  stop: () => Promise<void>;
  runNow: () => Promise<ReminderDeliveryRunResult>;
};

export const createReminderDeliveryScheduler = (
  overrides: Partial<ReminderDeliverySchedulerDependencies> = {}
): ReminderDeliveryScheduler => {
  const dependencies: ReminderDeliverySchedulerDependencies = {
    service: overrides.service,
    intervalMs: overrides.intervalMs ?? DEFAULT_REMINDER_DELIVERY_INTERVAL_MS,
    setInterval: overrides.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs)),
    clearInterval: overrides.clearInterval ?? ((handle) => clearInterval(handle)),
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let service = dependencies.service;
  let intervalHandle: TimerHandle | undefined;
  let activeRun: Promise<ReminderDeliveryRunResult> | undefined;
  let running = false;

  const getService = (): ReminderDeliveryService => {
    service ??= createReminderDeliveryService();
    return service;
  };

  const run = (): Promise<ReminderDeliveryRunResult> => {
    if (activeRun) return activeRun;

    const runPromise = getService()
      .deliverDueReminders()
      .catch(() => {
        dependencies.logError("Reminder scheduler tick failed.");
        return {
          ok: false as const,
          error: {
            code: "REMINDER_DELIVERY_UNAVAILABLE" as const,
            message: "Reminder delivery check failed." as const
          }
        };
      })
      .finally(() => {
        activeRun = undefined;
      });
    activeRun = runPromise;
    return runPromise;
  };

  return {
    start: (): void => {
      if (intervalHandle !== undefined) return;
      running = true;
      void run();
      intervalHandle = dependencies.setInterval(() => {
        if (running) void run();
      }, dependencies.intervalMs);
    },
    stop: async (): Promise<void> => {
      running = false;
      if (intervalHandle !== undefined) {
        dependencies.clearInterval(intervalHandle);
        intervalHandle = undefined;
      }
      if (activeRun) await activeRun;
    },
    runNow: run
  };
};
