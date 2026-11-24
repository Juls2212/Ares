import { describe, expect, it } from "vitest";

import { createPlannerTemporalResolver } from "../src/main/assistant/planner-temporal-resolution";
import { formatSpokenTime, parseSpanishTime, spokenAt, spokenClock } from "../src/shared/spanish-time";

/** The clock is injected: Sunday 20 September 2026, 10:00 in America/Bogota (UTC-5). */
const resolver = createPlannerTemporalResolver({ now: () => new Date("2026-09-20T15:00:00.000Z"), timeZone: () => "America/Bogota" });

describe("parseSpanishTime: what people say", () => {
  const accepted: Array<[string, string]> = [
    ["5 de la tarde", "17:00"],
    ["8 de la noche", "20:00"],
    ["8 de la mañana", "08:00"],
    ["12 del mediodía", "12:00"],
    ["12 del mediodia", "12:00"],
    ["mediodía", "12:00"],
    ["medianoche", "00:00"],
    ["12 de la noche", "00:00"],
    ["doce de la noche", "00:00"],
    ["5 y media de la tarde", "17:30"],
    ["cinco y cuarto de la tarde", "17:15"],
    ["a las cinco de la tarde", "17:00"],
    ["a las 5 de la tarde", "17:00"],
    ["las ocho y cuarenta y cinco de la noche", "20:45"],
    ["diez y media de la noche", "22:30"],
    ["seis menos cuarto de la tarde", "17:45"],
    ["a la una de la tarde", "13:00"],
    ["una y media de la tarde", "13:30"],
    ["3 y 10 de la tarde", "15:10"],
    ["11 de la noche", "23:00"],
    ["5 en punto de la tarde", "17:00"],
    ["5:30 p. m.", "17:30"],
    ["5:30 P.M.", "17:30"],
    ["5 pm", "17:00"],
    ["5 PM", "17:00"],
    ["9 a. m.", "09:00"],
    ["9:15 a.m.", "09:15"],
    ["12 am", "00:00"],
    ["12 pm", "12:00"],
    ["a las 17", "17:00"],
    ["17:45", "17:45"],
    ["17 horas", "17:00"],
    ["a las veintidós", "22:00"],
    ["a las veintidos", "22:00"],
    ["0:30", "00:30"],
    ["09:00", "09:00"],
    ["a las 5 de la madrugada", "05:00"],
    ["1 de la madrugada", "01:00"],
    ["12 de la madrugada", "00:00"],
    ["12 y media de la madrugada", "00:30"],
    ["  A LAS 5 DE LA TARDE  ", "17:00"]
  ];
  it.each(accepted)("reads «%s» as %s", (phrase, expected) => {
    expect(parseSpanishTime(phrase)).toEqual({ ok: true, time: expected });
  });

  it("covers at least 30 accepted phrases", () => {
    expect(accepted.length).toBeGreaterThanOrEqual(30);
  });

  const ambiguous: Array<[string, number]> = [["5", 5], ["a las 5", 5], ["cinco", 5], ["las cinco", 5], ["5:30", 5], ["a las 8", 8], ["12", 12], ["doce", 12], ["1", 1], ["a las doce y media", 12]];
  it.each(ambiguous)("asks instead of guessing for the bare hour «%s»", (phrase, hour) => {
    expect(parseSpanishTime(phrase)).toEqual({ ok: false, reason: "TIME_AMBIGUOUS", hour });
  });

  it.each(["25 de la tarde", "13 de la tarde", "0 de la tarde", "6 de la madrugada", "1 de la noche", "5 de la noche", "24:00", "17:60", "abc", "", "   ", "5 de la tardecita", "13 pm", "8 y 70 de la noche", "7 del mediodía", "dieciocho de la tarde", "5 y", "99"])(
    "rejects «%s» as invalid",
    (phrase) => { expect(parseSpanishTime(phrase)).toEqual({ ok: false, reason: "TIME_INVALID" }); }
  );

  it("rejects values that are not text", () => {
    for (const value of [5, null, undefined, {}, ["5 de la tarde"], "x".repeat(200)]) expect(parseSpanishTime(value)).toEqual({ ok: false, reason: "TIME_INVALID" });
  });
});

describe("spoken times (12-hour with the day period)", () => {
  it.each([
    ["17:00", "a las 5 de la tarde"], ["00:00", "a medianoche"], ["12:00", "a las 12 del mediodía"], ["13:00", "a la 1 de la tarde"],
    ["09:30", "a las 9 y media de la mañana"], ["20:15", "a las 8 y cuarto de la noche"], ["02:00", "a las 2 de la madrugada"],
    ["05:00", "a las 5 de la mañana"], ["00:30", "a las 12 y media de la madrugada"], ["12:30", "a las 12 y media de la tarde"], ["15:10", "a las 3 y 10 de la tarde"]
  ])("says %s as «%s»", (time, spoken) => { expect(spokenAt(time)).toBe(spoken); });

  it("writes «Son las…» and «Es la…» clocks", () => {
    expect(spokenClock("15:42")).toBe("las 3 y 42 de la tarde");
    expect(spokenClock("13:30")).toBe("la 1 y media de la tarde");
    expect(spokenClock("00:00")).toBe("medianoche");
  });

  it("reads back every minute of the day exactly (parse of what is spoken returns the same time)", () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      expect(parseSpanishTime(formatSpokenTime(time)), `${time} → ${formatSpokenTime(time)}`).toEqual({ ok: true, time });
    }
  });
});

describe("temporal resolver with day-period times (America/Bogota, injected clock)", () => {
  it("resolves «5 de la tarde» for a reminder tomorrow to 17:00 Bogota", () => {
    expect(resolver.resolve("CREATE_REMINDER", { title: "Llamar", date: "mañana", time: "5 de la tarde" }))
      .toEqual({ ok: true, input: { title: "Llamar", remindAt: "2026-09-21T22:00:00.000Z" } });
  });

  it("resolves an event on Friday at «8 de la noche» with an end time", () => {
    expect(resolver.resolve("CREATE_EVENT", { title: "Cena", date: "viernes", startTime: "8 de la noche", endTime: "10 de la noche" }))
      .toEqual({ ok: true, input: { title: "Cena", startAt: "2026-09-26T01:00:00.000Z", endAt: "2026-09-26T03:00:00.000Z" } });
  });

  it("resolves a task due time said in words", () => {
    expect(resolver.resolve("CREATE_TASK", { title: "Pagar", dueDate: "mañana", dueTime: "cinco y media de la tarde" }))
      .toEqual({ ok: true, input: { title: "Pagar", dueDate: "2026-09-21", dueTime: "17:30" } });
  });

  it("still accepts 24-hour and am/pm times as before", () => {
    expect(resolver.resolve("CREATE_TASK", { title: "A", dueDate: "mañana", dueTime: "17:00" })).toMatchObject({ ok: true, input: { dueTime: "17:00" } });
    expect(resolver.resolve("CREATE_TASK", { title: "A", dueDate: "mañana", dueTime: "9 am" })).toMatchObject({ ok: true, input: { dueTime: "09:00" } });
    expect(resolver.resolve("CREATE_TASK", { title: "A", dueDate: "mañana", dueTime: "a las 17" })).toMatchObject({ ok: true, input: { dueTime: "17:00" } });
  });

  it("asks (with the hour) for a bare hour instead of choosing, for tasks, events and reminders", () => {
    expect(resolver.resolve("CREATE_TASK", { title: "A", dueDate: "mañana", dueTime: "a las 5" })).toEqual({ ok: false, reason: "TIME_AMBIGUOUS", hour: 5 });
    expect(resolver.resolve("CREATE_EVENT", { title: "A", date: "mañana", startTime: "las 8" })).toEqual({ ok: false, reason: "TIME_AMBIGUOUS", hour: 8 });
    expect(resolver.resolve("CREATE_REMINDER", { title: "A", date: "mañana", time: "5:30" })).toEqual({ ok: false, reason: "TIME_AMBIGUOUS", hour: 5 });
    expect(resolver.resolve("CREATE_EVENT", { title: "A", date: "mañana", startTime: "9 am", endTime: "10" })).toEqual({ ok: false, reason: "TIME_AMBIGUOUS", hour: 10 });
  });

  it("rejects impossible hours and keeps rejecting the past", () => {
    expect(resolver.resolve("CREATE_REMINDER", { title: "A", date: "mañana", time: "25 de la tarde" })).toMatchObject({ ok: false, reason: "TIME_INVALID" });
    expect(resolver.resolve("CREATE_REMINDER", { title: "A", date: "mañana", time: "13 de la tarde" })).toMatchObject({ ok: false, reason: "TIME_INVALID" });
    expect(resolver.resolve("CREATE_REMINDER", { title: "A", date: "hoy", time: "9 de la mañana" })).toMatchObject({ ok: false, reason: "INSTANT_PAST" });
  });
});

describe("agenda day resolution", () => {
  const day = (date: unknown) => resolver.resolve("GET_TODAY_SCHEDULE", date === undefined ? {} : { date });

  it("resolves hoy, mañana, pasado mañana, weekdays and ISO dates from today up to 14 days ahead", () => {
    expect(day(undefined)).toEqual({ ok: true, input: {} });
    expect(day("hoy")).toEqual({ ok: true, input: { date: "2026-09-20" } });
    expect(day("mañana")).toEqual({ ok: true, input: { date: "2026-09-21" } });
    expect(day("pasado mañana")).toEqual({ ok: true, input: { date: "2026-09-22" } });
    expect(day("el viernes")).toEqual({ ok: true, input: { date: "2026-09-25" } });
    expect(day("2026-10-04")).toEqual({ ok: true, input: { date: "2026-10-04" } });
  });

  it("rejects out-of-range, past, ambiguous and unparsable days with a reason", () => {
    expect(day("2026-10-05")).toEqual({ ok: false, reason: "DATE_OUT_OF_RANGE" });
    expect(day("2027-01-01")).toEqual({ ok: false, reason: "DATE_OUT_OF_RANGE" });
    expect(day("2026-09-19")).toEqual({ ok: false, reason: "DATE_PAST" });
    expect(day("domingo")).toEqual({ ok: false, reason: "WEEKDAY_AMBIGUOUS" });
    for (const hostile of ["ayer", "", "algún día", 5, null, {}]) expect(day(hostile)).toMatchObject({ ok: false, reason: "DATE_INVALID" });
  });
});
