import { describe, expect, it, vi } from "vitest";
import {
  CONTACT_FORM_LIFETIME_MS,
  createContactFormBroker,
  type ContactFormBroker
} from "../src/main/messaging/contact-form-broker";
import { messagingFailure } from "../src/main/messaging/messaging-failures";
import type { ContactFormRequest } from "../src/shared/messaging-contracts";

const createBroker = (options: { deliver?: boolean; throwOnNotify?: boolean } = {}) => {
  const requests: ContactFormRequest[] = [];
  const timers: Array<{ callback: () => void; delay: number; active: boolean }> = [];
  let counter = 0;
  const broker: ContactFormBroker = createContactFormBroker({
    notify: (request) => {
      if (options.throwOnNotify) throw new Error("window gone");
      requests.push(request);
      return options.deliver ?? true;
    },
    generateIdentifier: () => `form-${++counter}`,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { active: boolean }).active = false;
    },
    logError: vi.fn()
  });
  return { broker, requests, timers };
};

const acceptAll = async (submission: { displayName: string; phone: string }) =>
  ({ ok: true as const, data: { echoed: submission.displayName } });

describe("contact form broker", () => {
  it("sends the renderer only a request reference and the friendly name", async () => {
    const { broker, requests } = createBroker();
    const waiting = broker.request({ displayName: "Mamá", validate: acceptAll });
    expect(requests).toEqual([{ requestId: "form-1", displayName: "Mamá" }]);
    await broker.cancel({ requestId: "form-1" });
    await expect(waiting).resolves.toEqual({ status: "CANCELLED" });
  });

  it("validates the submission in Main and resolves once with the validated value, never the number", async () => {
    const { broker } = createBroker();
    const validate = vi.fn(async (submission: { displayName: string; phone: string }) => ({
      ok: true as const,
      data: { masked: `•••• ${submission.phone.slice(-4)}` }
    }));
    const waiting = broker.request({ displayName: "Mamá", validate });

    const submitted = await broker.submit({ requestId: "form-1", displayName: "Mamá", phone: "300 123 4567" });

    expect(validate).toHaveBeenCalledWith({ displayName: "Mamá", phone: "300 123 4567" });
    expect(submitted).toEqual({ ok: true, data: { status: "ACCEPTED" } });
    expect(JSON.stringify(submitted)).not.toMatch(/\d{4}/u);
    await expect(waiting).resolves.toEqual({ status: "SUBMITTED", value: { masked: "•••• 4567" } });
  });

  it("is single use: a second submission or cancellation finds nothing pending", async () => {
    const { broker } = createBroker();
    const waiting = broker.request({ displayName: "Mamá", validate: acceptAll });
    await broker.submit({ requestId: "form-1", displayName: "Mamá", phone: "3001234567" });
    await waiting;

    await expect(broker.submit({ requestId: "form-1", displayName: "Mamá", phone: "3001234567" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MESSAGING_PENDING_EXPIRED" }
    });
    await expect(broker.cancel({ requestId: "form-1" })).resolves.toMatchObject({ ok: false });
  });

  it("keeps the form open when Main rejects the values and reports a fixed message", async () => {
    const { broker } = createBroker();
    const validate = vi.fn()
      .mockResolvedValueOnce(messagingFailure("MESSAGING_INVALID_PHONE"))
      .mockResolvedValueOnce({ ok: true, data: "fine" });
    const waiting = broker.request({ displayName: "Mamá", validate });

    const rejected = await broker.submit({ requestId: "form-1", displayName: "Mamá", phone: "12" });
    expect(rejected).toMatchObject({ ok: false, error: { code: "MESSAGING_INVALID_PHONE" } });
    expect(JSON.stringify(rejected)).not.toContain("12\"");

    await expect(broker.submit({ requestId: "form-1", displayName: "Mamá", phone: "3001234567" })).resolves.toMatchObject({ ok: true });
    await expect(waiting).resolves.toEqual({ status: "SUBMITTED", value: "fine" });
  });

  it("rejects malformed, extended or foreign submissions before validating", async () => {
    const { broker } = createBroker();
    const validate = vi.fn(acceptAll);
    const waiting = broker.request({ displayName: "Mamá", validate });

    for (const input of [
      undefined,
      null,
      "form-1",
      { requestId: "form-1" },
      { requestId: "form-1", displayName: "Mamá" },
      { requestId: "form-1", displayName: "Mamá", phone: 3001234567 },
      { requestId: "form-1", displayName: "Mamá", phone: "3001234567", extra: "x" },
      { requestId: "form-1", displayName: "Mamá", phone: "3".repeat(41) },
      { requestId: "form-1", displayName: "M".repeat(81), phone: "3001234567" }
    ]) {
      await expect(broker.submit(input)).resolves.toMatchObject({ ok: false });
    }
    await expect(broker.submit({ requestId: "other", displayName: "Mamá", phone: "3001234567" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MESSAGING_PENDING_EXPIRED" }
    });
    expect(validate).not.toHaveBeenCalled();
    await broker.cancel({ requestId: "form-1" });
    await waiting;
  });

  it("reports an expired form after the lifetime and resolves the waiting request", async () => {
    const { broker, timers } = createBroker();
    const waiting = broker.request({ displayName: "Mamá", validate: acceptAll });
    expect(timers[0].delay).toBe(CONTACT_FORM_LIFETIME_MS);
    expect(CONTACT_FORM_LIFETIME_MS).toBe(5 * 60 * 1000);

    timers[0].callback();

    await expect(waiting).resolves.toEqual({ status: "EXPIRED" });
    await expect(broker.submit({ requestId: "form-1", displayName: "Mamá", phone: "3001234567" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MESSAGING_PENDING_EXPIRED" }
    });
  });

  it("is unavailable when no window can show the form, even if the notifier throws", async () => {
    await expect(createBroker({ deliver: false }).broker.request({ displayName: "Mamá", validate: acceptAll })).resolves.toEqual({
      status: "UNAVAILABLE"
    });
    await expect(createBroker({ throwOnNotify: true }).broker.request({ displayName: "Mamá", validate: acceptAll })).resolves.toEqual({
      status: "UNAVAILABLE"
    });
  });

  it("cancels an older form when a newer one is requested and on shutdown", async () => {
    const { broker } = createBroker();
    const first = broker.request({ displayName: "Mamá", validate: acceptAll });
    const second = broker.request({ displayName: "Juan", validate: acceptAll });
    await expect(first).resolves.toEqual({ status: "CANCELLED" });

    broker.shutdown();
    await expect(second).resolves.toEqual({ status: "CANCELLED" });
  });

  it("turns a throwing validator into a fixed failure without leaking the error", async () => {
    const { broker } = createBroker();
    const waiting = broker.request({
      displayName: "Mamá",
      validate: async () => {
        throw new Error("password=secret SELECT * FROM messaging_contacts 3001234567");
      }
    });
    const result = await broker.submit({ requestId: "form-1", displayName: "Mamá", phone: "3001234567" });
    expect(result).toMatchObject({ ok: false, error: { code: "MESSAGING_OPERATION_FAILED" } });
    expect(JSON.stringify(result)).not.toMatch(/secret|SELECT|3001234567/u);
    await broker.cancel({ requestId: "form-1" });
    await waiting;
  });
});
