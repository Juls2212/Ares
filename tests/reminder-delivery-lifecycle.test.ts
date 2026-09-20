import { describe, expect, it, vi } from "vitest";
import { createReminderDeliveryShutdownRegistration } from "../src/main/reminders/register-reminder-delivery-lifecycle";

describe("reminder delivery shutdown lifecycle", () => {
  it("stops the scheduler before closing the database and reissues quit once", async () => {
    let listener: ((event: { preventDefault: () => void }) => void) | undefined;
    const lifecycle = {
      once: vi.fn((_event: "before-quit", value: (event: { preventDefault: () => void }) => void) => {
        listener = value;
      }),
      quit: vi.fn()
    };
    const order: string[] = [];
    const register = createReminderDeliveryShutdownRegistration({
      scheduler: { start: vi.fn(), stop: vi.fn(async () => { order.push("scheduler"); }), runNow: vi.fn() },
      shutdownDatabase: vi.fn(async () => {
        order.push("database");
        return { ok: true } as const;
      }),
      timer: { setTimeout: vi.fn(() => "timeout" as unknown as ReturnType<typeof setTimeout>), clearTimeout: vi.fn() },
      logError: vi.fn()
    });

    register(lifecycle);
    register(lifecycle);
    const preventDefault = vi.fn();
    listener?.({ preventDefault });
    await vi.waitFor(() => expect(lifecycle.quit).toHaveBeenCalledTimes(1));

    expect(lifecycle.once).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["scheduler", "database"]);
    expect(lifecycle.quit).toHaveBeenCalledTimes(1);
  });

  it("contains scheduler failures without leaking raw details before database shutdown", async () => {
    let listener: ((event: { preventDefault: () => void }) => void) | undefined;
    const lifecycle = {
      once: vi.fn((_event: "before-quit", value: (event: { preventDefault: () => void }) => void) => {
        listener = value;
      }),
      quit: vi.fn()
    };
    const password = "do-not-log-this-password";
    const logError = vi.fn();
    const register = createReminderDeliveryShutdownRegistration({
      scheduler: { start: vi.fn(), stop: vi.fn(async () => { throw new Error(password); }), runNow: vi.fn() },
      shutdownDatabase: vi.fn(async () => ({ ok: true } as const)),
      timer: { setTimeout: vi.fn(() => "timeout" as unknown as ReturnType<typeof setTimeout>), clearTimeout: vi.fn() },
      logError
    });

    register(lifecycle);
    listener?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(lifecycle.quit).toHaveBeenCalledTimes(1));

    expect(logError).toHaveBeenCalledWith("Reminder scheduler shutdown failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toContain(password);
    expect(lifecycle.quit).toHaveBeenCalledTimes(1);
  });
});
