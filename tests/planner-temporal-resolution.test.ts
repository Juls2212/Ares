import { describe, expect, it } from "vitest";

import { createPlannerTemporalResolver } from "../src/main/assistant/planner-temporal-resolution";

const resolverAt = (now: string, timeZone = "America/Bogota") =>
  createPlannerTemporalResolver({ now: () => new Date(now), timeZone: () => timeZone });

describe("Main-only planner temporal resolution", () => {
  it("resolves hoy, mañana, ISO dates, and local task times against the injected clock", () => {
    const resolver = resolverAt("2026-09-20T15:00:00.000Z");
    const today = resolver.resolve("CREATE_TASK", { title: "Hoy", dueDate: "hoy", dueTime: "15:00" });
    const tomorrow = resolver.resolve("CREATE_TASK", { title: "Mañana", dueDate: "mañana", dueTime: "9 am" });
    const explicit = resolver.resolve("CREATE_TASK", { title: "Fecha", dueDate: "2026-09-22", dueTime: "9:30" });

    expect(today).toEqual({ ok: true, input: { title: "Hoy", dueDate: "2026-09-20", dueTime: "15:00" } });
    expect(tomorrow).toEqual({ ok: true, input: { title: "Mañana", dueDate: "2026-09-21", dueTime: "09:00" } });
    expect(explicit).toEqual({ ok: true, input: { title: "Fecha", dueDate: "2026-09-22", dueTime: "09:30" } });
  });

  it("accepts an unambiguous future weekday and clarifies same-day weekday ambiguity", () => {
    const resolver = resolverAt("2026-09-20T15:00:00.000Z");

    expect(resolver.resolve("CREATE_TASK", { title: "Lunes", dueDate: "lunes" })).toEqual({
      ok: true,
      input: { title: "Lunes", dueDate: "2026-09-21" }
    });
    expect(resolver.resolve("CREATE_TASK", { title: "Domingo", dueDate: "domingo" })).toEqual({
      ok: false,
      reason: "WEEKDAY_AMBIGUOUS"
    });
  });

  it("creates explicit-offset event and reminder instants from trusted local date and time", () => {
    const resolver = resolverAt("2026-09-20T15:00:00.000Z");
    const event = resolver.resolve("CREATE_EVENT", { title: "Reunión", date: "mañana", startTime: "15:00", endTime: "16:00" });
    const reminder = resolver.resolve("CREATE_REMINDER", { title: "Llamar", date: "2026-09-21", time: "15:30" });

    expect(event).toEqual({
      ok: true,
      input: {
        title: "Reunión",
        startAt: "2026-09-21T20:00:00.000Z",
        endAt: "2026-09-21T21:00:00.000Z"
      }
    });
    expect(reminder).toEqual({ ok: true, input: { title: "Llamar", remindAt: "2026-09-21T20:30:00.000Z" } });
  });

  it("clarifies missing, impossible, past, invalid, and ambiguous temporal values", () => {
    const resolver = resolverAt("2026-09-20T15:00:00.000Z");

    expect(resolver.resolve("CREATE_TASK", { title: "Pasado", dueDate: "2026-09-19" })).toMatchObject({ ok: false, reason: "DATE_PAST" });
    expect(resolver.resolve("CREATE_TASK", { title: "Imposible", dueDate: "2026-02-30" })).toMatchObject({ ok: false, reason: "DATE_INVALID" });
    expect(resolver.resolve("CREATE_TASK", { title: "Hora", dueDate: "mañana", dueTime: "25:00" })).toMatchObject({ ok: false, reason: "TIME_INVALID" });
    expect(resolver.resolve("CREATE_TASK", { title: "Sin fecha", dueTime: "18:00" })).toMatchObject({ ok: false, reason: "DATE_REQUIRED" });
    expect(resolver.resolve("CREATE_EVENT", { title: "Sin hora", date: "mañana" })).toMatchObject({ ok: false, reason: "TIME_REQUIRED" });
    expect(resolver.resolve("CREATE_EVENT", { title: "Rango", date: "mañana", startTime: "16:00", endTime: "15:00" })).toMatchObject({
      ok: false,
      reason: "TIME_RANGE_INVALID"
    });
    expect(resolver.resolve("CREATE_REMINDER", { title: "Pasado", date: "hoy", time: "09:30" })).toMatchObject({ ok: false, reason: "INSTANT_PAST" });
  });

  it("rejects nonexistent and ambiguous daylight-saving local times without choosing an instant", () => {
    const springForward = resolverAt("2026-03-08T05:00:00.000Z", "America/New_York");
    const fallBack = resolverAt("2026-11-01T04:00:00.000Z", "America/New_York");

    expect(springForward.resolve("CREATE_EVENT", { title: "Cambio", date: "hoy", time: "02:30" })).toEqual({
      ok: false,
      reason: "LOCAL_TIME_AMBIGUOUS"
    });
    expect(fallBack.resolve("CREATE_REMINDER", { title: "Cambio", date: "hoy", time: "01:30" })).toEqual({
      ok: false,
      reason: "LOCAL_TIME_AMBIGUOUS"
    });
  });
});
