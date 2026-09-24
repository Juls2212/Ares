import {
  createReminderDeliveryRepository,
  type ReminderDeliveryRepository
} from "./reminder-delivery-repository";
import { MainConfigurationError } from "../config/database-environment";

const FALLBACK_NOTIFICATION_BODY = "Tienes un recordatorio pendiente.";

export type LocalNotification = {
  show: () => void;
};

export type NotificationFactory = (content: { title: string; body: string }) => LocalNotification;

export type ReminderDeliveryRunResult =
  | {
      ok: true;
      data: {
        scannedCount: number;
        claimedCount: number;
        notifiedCount: number;
        notificationFailureCount: number;
      };
    }
  | {
      ok: false;
      error: {
        code: "REMINDER_DELIVERY_UNAVAILABLE";
        message: "Reminder delivery check failed.";
      };
    };

type ReminderDeliveryServiceDependencies = {
  repository?: ReminderDeliveryRepository;
  now: () => Date;
  notificationFactory: NotificationFactory;
  batchSize: number;
  logError: (message: string) => void;
};

export type ReminderDeliveryService = {
  deliverDueReminders: () => Promise<ReminderDeliveryRunResult>;
};

const normalizeNotificationBody = (title: string): string => {
  const normalized = title.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 240 ? normalized : FALLBACK_NOTIFICATION_BODY;
};

const getQueryFailureCategory = (error: unknown): string =>
  error instanceof MainConfigurationError ? "DATABASE_CONFIGURATION" : "DATABASE_QUERY";

export const createReminderDeliveryService = (
  overrides: Partial<ReminderDeliveryServiceDependencies> = {}
): ReminderDeliveryService => {
  const dependencies: ReminderDeliveryServiceDependencies = {
    repository: overrides.repository,
    now: overrides.now ?? (() => new Date()),
    notificationFactory:
      overrides.notificationFactory ??
      (() => {
        throw new Error("Reminder notification factory is not configured.");
      }),
    batchSize: overrides.batchSize ?? 50,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let repository = dependencies.repository;

  const getRepository = (): ReminderDeliveryRepository => {
    repository ??= createReminderDeliveryRepository();
    return repository;
  };

  return {
    deliverDueReminders: async (): Promise<ReminderDeliveryRunResult> => {
      const deliveredAt = dependencies.now();
      let dueReminders;
      try {
        dueReminders = await getRepository().listDuePending(deliveredAt, dependencies.batchSize);
      } catch (error) {
        dependencies.logError(
          `Reminder delivery query failed [${getQueryFailureCategory(error)}].`
        );
        return {
          ok: false,
          error: {
            code: "REMINDER_DELIVERY_UNAVAILABLE",
            message: "Reminder delivery check failed."
          }
        };
      }

      let claimedCount = 0;
      let notifiedCount = 0;
      let notificationFailureCount = 0;
      for (const dueReminder of dueReminders) {
        let claimedReminder;
        try {
          claimedReminder = await getRepository().claimPending(dueReminder.id, deliveredAt);
        } catch {
          dependencies.logError("Reminder delivery claim failed.");
          return {
            ok: false,
            error: {
              code: "REMINDER_DELIVERY_UNAVAILABLE",
              message: "Reminder delivery check failed."
            }
          };
        }

        if (!claimedReminder) continue;
        claimedCount += 1;

        try {
          dependencies.notificationFactory({
            title: "Ares",
            body: normalizeNotificationBody(claimedReminder.title)
          }).show();
          notifiedCount += 1;
        } catch {
          notificationFailureCount += 1;
          dependencies.logError("Reminder notification display failed after an atomic claim.");
        }
      }

      return {
        ok: true,
        data: {
          scannedCount: dueReminders.length,
          claimedCount,
          notifiedCount,
          notificationFailureCount
        }
      };
    }
  };
};
