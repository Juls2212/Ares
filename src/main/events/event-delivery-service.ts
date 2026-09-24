import {
  createEventDeliveryRepository,
  type EventDeliveryRepository
} from "./event-delivery-repository";
import { MainConfigurationError } from "../config/database-environment";
import type { LocalNotification, NotificationFactory } from "../reminders/reminder-delivery-service";

export const EVENT_DELIVERY_CATCH_UP_MS = 5 * 60 * 1_000;
export const DEFAULT_EVENT_DELIVERY_BATCH_SIZE = 20;

const FALLBACK_EVENT_TITLE = "Tienes un evento pendiente.";

export type EventDeliveryRunResult =
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
        code: "EVENT_DELIVERY_UNAVAILABLE";
        message: "Event delivery check failed.";
      };
    };

type EventDeliveryServiceDependencies = {
  repository?: EventDeliveryRepository;
  now: () => Date;
  notificationFactory: NotificationFactory;
  batchSize: number;
  catchUpMs: number;
  logError: (message: string) => void;
};

export type EventDeliveryService = {
  deliverDueEvents: () => Promise<EventDeliveryRunResult>;
};

const normalizeEventTitle = (title: string): string => {
  const normalized = title.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 240 ? normalized : FALLBACK_EVENT_TITLE;
};

const createUnavailableResult = (): EventDeliveryRunResult => ({
  ok: false,
  error: {
    code: "EVENT_DELIVERY_UNAVAILABLE",
    message: "Event delivery check failed."
  }
});

const getQueryFailureCategory = (error: unknown): string =>
  error instanceof MainConfigurationError ? "DATABASE_CONFIGURATION" : "DATABASE_QUERY";

export const createEventDeliveryService = (
  overrides: Partial<EventDeliveryServiceDependencies> = {}
): EventDeliveryService => {
  const dependencies: EventDeliveryServiceDependencies = {
    repository: overrides.repository,
    now: overrides.now ?? (() => new Date()),
    notificationFactory:
      overrides.notificationFactory ??
      (() => {
        throw new Error("Event notification factory is not configured.");
      }),
    batchSize: overrides.batchSize ?? DEFAULT_EVENT_DELIVERY_BATCH_SIZE,
    catchUpMs: overrides.catchUpMs ?? EVENT_DELIVERY_CATCH_UP_MS,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let repository = dependencies.repository;

  const getRepository = (): EventDeliveryRepository => {
    repository ??= createEventDeliveryRepository();
    return repository;
  };

  return {
    deliverDueEvents: async (): Promise<EventDeliveryRunResult> => {
      const deliveredAt = dependencies.now();
      const windowStart = new Date(deliveredAt.getTime() - dependencies.catchUpMs);
      let dueEvents;
      try {
        dueEvents = await getRepository().listDueUnclaimed(
          windowStart,
          deliveredAt,
          dependencies.batchSize
        );
      } catch (error) {
        dependencies.logError(`Event delivery query failed [${getQueryFailureCategory(error)}].`);
        return createUnavailableResult();
      }

      const orderedEvents = [...dueEvents].sort(
        (left, right) =>
          left.startAt.getTime() - right.startAt.getTime() || left.id.localeCompare(right.id)
      );
      let claimedCount = 0;
      let notifiedCount = 0;
      let notificationFailureCount = 0;

      for (const dueEvent of orderedEvents) {
        let claimed = false;
        try {
          claimed = await getRepository().claimEventStart(
            dueEvent.id,
            dueEvent.startAt,
            deliveredAt
          );
        } catch {
          dependencies.logError("Event delivery claim failed.");
          return createUnavailableResult();
        }

        if (!claimed) continue;
        claimedCount += 1;

        try {
          const notification: LocalNotification = dependencies.notificationFactory({
            title: "Ares",
            body: `Comienza ahora: ${normalizeEventTitle(dueEvent.title)}`
          });
          notification.show();
          notifiedCount += 1;
        } catch {
          notificationFailureCount += 1;
          dependencies.logError("Event notification display failed after an atomic claim.");
        }
      }

      return {
        ok: true,
        data: {
          scannedCount: orderedEvents.length,
          claimedCount,
          notifiedCount,
          notificationFailureCount
        }
      };
    }
  };
};
