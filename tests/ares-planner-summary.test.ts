import { describe, expect, it } from "vitest";
import { getPlannerPanelState, getUpcomingEvents, summarizeToday } from "../src/renderer/ares-planner-summary";
import type { EventRecord, TodayScheduleData } from "../src/shared/planner-contracts";

const event = (id: string, startAt: string): EventRecord => ({
  id,
  title: `Evento ${id}`,
  description: null,
  startAt,
  endAt: null,
  categoryId: null,
  location: null,
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z"
});

describe("Ares planner rails", () => {
  it("summarizes only real today schedule task states and upcoming events", () => {
    const schedule = {
      localDate: "2026-09-28",
      tasks: [
        { id: "pending", status: "PENDING" },
        { id: "completed", status: "COMPLETED" },
        { id: "in-progress", status: "IN_PROGRESS" }
      ],
      events: [event("past", "2026-09-28T09:00:00.000Z"), event("next", "2026-09-28T12:00:00.000Z")],
      reminders: []
    } as unknown as TodayScheduleData;

    expect(summarizeToday(schedule, new Date("2026-09-28T10:00:00.000Z"))).toEqual({
      pendingTasks: 2,
      completedTasks: 1,
      upcomingEvents: 1
    });
  });

  it("shows no more than three real future events in chronological order", () => {
    const now = new Date("2026-09-28T10:00:00.000Z");
    const events = [
      event("third", "2026-09-28T13:00:00.000Z"),
      event("past", "2026-09-28T09:00:00.000Z"),
      event("first", "2026-09-28T11:00:00.000Z"),
      event("second", "2026-09-28T12:00:00.000Z"),
      event("fourth", "2026-09-28T14:00:00.000Z")
    ];
    expect(getUpcomingEvents(events, now).map((item) => item.id)).toEqual(["first", "second", "third"]);
  });

  it("uses a controlled unavailable state rather than an upstream error", () => {
    expect(getPlannerPanelState({ ok: false, error: { code: "PRIVATE", userMessage: "private detail" } }, "No se pudo cargar el resumen de hoy.")).toEqual({
      kind: "ERROR",
      userMessage: "No se pudo cargar el resumen de hoy."
    });
  });
});
