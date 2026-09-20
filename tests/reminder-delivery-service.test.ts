import { describe, expect, it, vi } from "vitest";
import type { DueReminder, ReminderDeliveryRepository } from "../src/main/reminders/reminder-delivery-repository";
import {
  createReminderDeliveryService,
  type LocalNotification
} from "../src/main/reminders/reminder-delivery-service";
import { createReminderDeliveryScheduler } from "../src/main/reminders/reminder-delivery-scheduler";

const now = new Date("2026-09-18T12:00:00.000Z");
const dueReminder: DueReminder = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Revisar el informe",
  remindAt: new Date("2026-09-18T11:59:00.000Z")
};

const createRepository = (): ReminderDeliveryRepository => ({
  listDuePending: vi.fn(async () => []),
  claimPending: vi.fn(async () => undefined)
});

const createNotificationFactory = () => {
  const show = vi.fn();
  const factory = vi.fn((): LocalNotification => ({ show }));
  return { factory, show };
};

const createSuccessRun = () => ({
  ok: true as const,
  data: { scannedCount: 0, claimedCount: 0, notifiedCount: 0, notificationFailureCount: 0 }
});

describe("reminder delivery service", () => {
  it("checks due pending reminders using the injected clock and delivers each successful claim once", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDuePending).mockResolvedValueOnce([dueReminder]);
    vi.mocked(repository.claimPending).mockResolvedValueOnce(dueReminder);
    const { factory, show } = createNotificationFactory();
    const service = createReminderDeliveryService({
      repository,
      now: () => now,
      notificationFactory: factory,
      batchSize: 20,
      logError: vi.fn()
    });

    const result = await service.deliverDueReminders();

    expect(repository.listDuePending).toHaveBeenCalledWith(now, 20);
    expect(repository.claimPending).toHaveBeenCalledWith(dueReminder.id, now);
    expect(result).toEqual({
      ok: true,
      data: { scannedCount: 1, claimedCount: 1, notifiedCount: 1, notificationFailureCount: 0 }
    });
    expect(factory).toHaveBeenCalledWith({ title: "Ares", body: "Revisar el informe" });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("does not deliver future or cancelled reminders because the repository returns only due pending records", async () => {
    const repository = createRepository();
    const { factory, show } = createNotificationFactory();
    const service = createReminderDeliveryService({ repository, now: () => now, notificationFactory: factory, logError: vi.fn() });

    const result = await service.deliverDueReminders();

    expect(result).toMatchObject({ ok: true, data: { scannedCount: 0, notifiedCount: 0 } });
    expect(repository.claimPending).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it("does not show a notification when a concurrent scheduler already claimed the reminder", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDuePending).mockResolvedValue([dueReminder]);
    vi.mocked(repository.claimPending).mockResolvedValueOnce(dueReminder).mockResolvedValueOnce(undefined);
    const { factory, show } = createNotificationFactory();
    const service = createReminderDeliveryService({ repository, now: () => now, notificationFactory: factory, logError: vi.fn() });

    await service.deliverDueReminders();
    await service.deliverDueReminders();

    expect(repository.claimPending).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("does not reset a successfully claimed reminder when local notification display fails", async () => {
    const repository = createRepository();
    vi.mocked(repository.listDuePending).mockResolvedValueOnce([dueReminder]);
    vi.mocked(repository.claimPending).mockResolvedValueOnce(dueReminder);
    const logError = vi.fn();
    const notificationFactory = vi.fn((): LocalNotification => ({
      show: () => {
        throw new Error("native notification failure");
      }
    }));
    const service = createReminderDeliveryService({ repository, now: () => now, notificationFactory, logError });

    const result = await service.deliverDueReminders();

    expect(result).toEqual({
      ok: true,
      data: { scannedCount: 1, claimedCount: 1, notifiedCount: 0, notificationFailureCount: 1 }
    });
    expect(repository.claimPending).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("Reminder notification display failed after an atomic claim.");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("native notification failure");
  });

  it("contains repository errors without exposing technical details in notification data or logs", async () => {
    const repository = createRepository();
    const technicalError = new Error("postgres://private-password@host/database");
    vi.mocked(repository.listDuePending).mockRejectedValueOnce(technicalError);
    const { factory } = createNotificationFactory();
    const logError = vi.fn();
    const service = createReminderDeliveryService({ repository, now: () => now, notificationFactory: factory, logError });

    const result = await service.deliverDueReminders();

    expect(result).toEqual({
      ok: false,
      error: { code: "REMINDER_DELIVERY_UNAVAILABLE", message: "Reminder delivery check failed." }
    });
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("private-password");
  });
});

describe("reminder delivery scheduler", () => {
  it("runs an initial check, rejects re-entrant ticks, and stops future timer checks", async () => {
    let intervalCallback: (() => void) | undefined;
    let resolveRun: ((result: ReturnType<typeof createSuccessRun>) => void) | undefined;
    const service = {
      deliverDueReminders: vi.fn(
        () =>
          new Promise<ReturnType<typeof createSuccessRun>>((resolve) => {
            resolveRun = resolve;
          })
      )
    };
    const clearInterval = vi.fn();
    const scheduler = createReminderDeliveryScheduler({
      service,
      intervalMs: 30_000,
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
    const sameRun = scheduler.runNow();

    expect(service.deliverDueReminders).toHaveBeenCalledTimes(1);
    resolveRun?.(createSuccessRun());
    await sameRun;
    await scheduler.stop();
    intervalCallback?.();

    expect(clearInterval).toHaveBeenCalledTimes(1);
    expect(service.deliverDueReminders).toHaveBeenCalledTimes(1);
    await scheduler.stop();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });
});
