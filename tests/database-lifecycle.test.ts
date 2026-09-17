import { describe, expect, it, vi } from "vitest";
import {
  createDatabaseShutdownRegistration
} from "../src/main/database/register-database-lifecycle";

describe("Main database shutdown lifecycle", () => {
  it("registers one non-blocking before-quit listener and invokes controlled shutdown", async () => {
    let beforeQuitListener: (() => void) | undefined;
    const lifecycle = {
      once: vi.fn((_event: "before-quit", listener: () => void) => {
        beforeQuitListener = listener;
      })
    };
    const shutdownDatabase = vi.fn().mockResolvedValue({ ok: true } as const);
    const register = createDatabaseShutdownRegistration(shutdownDatabase);

    register(lifecycle);
    register(lifecycle);

    expect(lifecycle.once).toHaveBeenCalledTimes(1);
    expect(lifecycle.once).toHaveBeenCalledWith("before-quit", expect.any(Function));
    expect(beforeQuitListener).toBeDefined();

    beforeQuitListener?.();
    await Promise.resolve();

    expect(shutdownDatabase).toHaveBeenCalledTimes(1);
  });

  it("contains unexpected shutdown rejections without logging raw error details", async () => {
    let beforeQuitListener: (() => void) | undefined;
    const lifecycle = {
      once: vi.fn((_event: "before-quit", listener: () => void) => {
        beforeQuitListener = listener;
      })
    };
    const password = "do-not-expose-this-password";
    const shutdownDatabase = vi.fn().mockRejectedValue(new Error(password));
    const logError = vi.fn();
    const register = createDatabaseShutdownRegistration(shutdownDatabase, logError);

    register(lifecycle);
    beforeQuitListener?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(logError).toHaveBeenCalledWith("Database pool shutdown failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toContain(password);
  });
});
