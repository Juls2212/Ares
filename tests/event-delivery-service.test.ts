import { describe, expect, it, vi } from "vitest";
import type { DueEvent, EventDeliveryRepository } from "../src/main/events/event-delivery-repository";
import {
  createEventDeliveryService,
  DEFAULT_EVENT_DELIVERY_BATCH_SIZE,
  EVENT_DELIVERY_CATCH_UP_MS
} from "../src/main/events/event-delivery-service";
import type { LocalNotification } from "../src/main/reminders/reminder-delivery-service";
import { createReminderDeliveryScheduler } from "../src/main/reminders/reminder-delivery-scheduler";
import { MainConfigurationError } from "../src/main/config/database-environment";

const now = new Date("2026-09-20T12:00:00.000Z");
const earlierEvent: DueEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Primera reunión",
  startAt: new Date("2026-09-20T11:57:00.000Z")
};
const laterEvent: DueEvent = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Segunda reunión",
  startAt: new Date("2026-09-20T11:59:00.000Z")
};

const createRepository = (): EventDeliveryRepository => ({
  listDueUnclaimed: vi.fn(async () => []),
  claimEventStart: vi.fn(async () => false)
});

const createNotificationFactory = () => {
  const show = vi.fn();
  const factory = vi.fn((): LocalNotification => ({ show }));
  return { factory, show };
};

const emptyReminderResult = {
  ok: true as const,
  data: { scannedCount: 0, claimedCount: 0, notifiedCount: 0, notificationFailureCount: 0 }
};

describe("event delivery service", () => {
  it("uses the bounded five-minute window and twenty-item limit, then claims and notifies in deterministic order", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDueUnclaimed).mockResolvedValueOnce([laterEvent, earlierEvent]);
    vi.mocked(repository.claimEventStart).mockResolvedValue(true);
    const { factory, show } = createNotificationFactory();
    const service = createEventDeliveryService({ repository, now: () => now, notificationFactory: factory, logError: vi.fn() });

    const result = await service.deliverDueEvents();

    expect(repository.listDueUnclaimed).toHaveBeenCalledWith(
      new Date(now.getTime() - EVENT_DELIVERY_CATCH_UP_MS),
      now,
      DEFAULT_EVENT_DELIVERY_BATCH_SIZE
    );
    expect(repository.claimEventStart).toHaveBeenNthCalledWith(1, earlierEvent.id, earlierEvent.startAt, now);
    expect(repository.claimEventStart).toHaveBeenNthCalledWith(2, laterEvent.id, laterEvent.startAt, now);
    expect(factory).toHaveBeenNthCalledWith(1, { title: "Ares", body: "Comienza ahora: Primera reunión" });
    expect(factory).toHaveBeenNthCalledWith(2, { title: "Ares", body: "Comienza ahora: Segunda reunión" });
    expect(show).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      data: { scannedCount: 2, claimedCount: 2, notifiedCount: 2, notificationFailureCount: 0 }
    });
  });

  it("does not notify when a duplicate claim or a stale event update prevents the atomic claim", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDueUnclaimed).mockResolvedValueOnce([earlierEvent, laterEvent]);
    vi.mocked(repository.claimEventStart).mockResolvedValue(false);
    const { factory, show } = createNotificationFactory();
    const service = createEventDeliveryService({ repository, now: () => now, notificationFactory: factory, logError: vi.fn() });

    const result = await service.deliverDueEvents();

    expect(result).toEqual({
      ok: true,
      data: { scannedCount: 2, claimedCount: 0, notifiedCount: 0, notificationFailureCount: 0 }
    });
    expect(factory).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it("keeps an atomic claim when Electron notification display fails and never leaks the native error", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDueUnclaimed).mockResolvedValueOnce([earlierEvent]);
    vi.mocked(repository.claimEventStart).mockResolvedValueOnce(true);
    const logError = vi.fn();
    const service = createEventDeliveryService({
      repository,
      now: () => now,
      notificationFactory: vi.fn((): LocalNotification => ({
        show: () => {
          throw new Error("native notification failure C:\\private");
        }
      })),
      logError
    });

    const result = await service.deliverDueEvents();

    expect(result).toEqual({
      ok: true,
      data: { scannedCount: 1, claimedCount: 1, notifiedCount: 0, notificationFailureCount: 1 }
    });
    expect(repository.claimEventStart).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("C:\\private");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("C:\\private");
  });

  it("maps database failures to a controlled redacted outcome", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDueUnclaimed).mockRejectedValueOnce(
      new Error("postgresql://private-password@host/database")
    );
    const { factory } = createNotificationFactory();
    const logError = vi.fn();
    const service = createEventDeliveryService({ repository, now: () => now, notificationFactory: factory, logError });

    const result = await service.deliverDueEvents();

    expect(result).toEqual({
      ok: false,
      error: { code: "EVENT_DELIVERY_UNAVAILABLE", message: "Event delivery check failed." }
    });
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("private-password");
    expect(logError).toHaveBeenCalledWith("Event delivery query failed [DATABASE_QUERY].");
  });

  it("reports a safe configuration category without exposing configuration values", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDueUnclaimed).mockRejectedValueOnce(
      new MainConfigurationError("DATABASE_URL_MISSING", "DATABASE_URL is required before database access.")
    );
    const logError = vi.fn();
    const service = createEventDeliveryService({
      repository,
      now: () => now,
      notificationFactory: createNotificationFactory().factory,
      logError
    });

    await service.deliverDueEvents();

    expect(logError).toHaveBeenCalledWith("Event delivery query failed [DATABASE_CONFIGURATION].");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("DATABASE_URL is required");
  });
});

describe("unified notification scheduler", () => {
  it("starts once, uses the existing cadence for both services, rejects re-entrant ticks, and stops before shutdown", async () => {
    let intervalCallback: (() => void) | undefined;
    let resolveReminder: ((result: typeof emptyReminderResult) => void) | undefined;
    const reminderService = {
      deliverDueReminders: vi.fn(
        () => new Promise<typeof emptyReminderResult>((resolve) => { resolveReminder = resolve; })
      )
    };
    const eventService = {
      deliverDueEvents: vi.fn(async () => ({
        ok: true as const,
        data: { scannedCount: 0, claimedCount: 0, notifiedCount: 0, notificationFailureCount: 0 }
      }))
    };
    const clearInterval = vi.fn();
    const scheduler = createReminderDeliveryScheduler({
      service: reminderService,
      eventService,
      setInterval: vi.fn((callback) => {
        intervalCallback = callback;
        return "timer" as unknown as ReturnType<typeof setInterval>;
      }),
      clearInterval,
      logError: vi.fn()
    });

    scheduler.start();
    scheduler.start();
    intervalCallback?.();
    const activeRun = scheduler.runNow();
    expect(reminderService.deliverDueReminders).toHaveBeenCalledTimes(1);
    resolveReminder?.(emptyReminderResult);
    await activeRun;
    expect(eventService.deliverDueEvents).toHaveBeenCalledTimes(1);

    await scheduler.stop();
    intervalCallback?.();
    expect(clearInterval).toHaveBeenCalledTimes(1);
    expect(eventService.deliverDueEvents).toHaveBeenCalledTimes(1);
  });
});
