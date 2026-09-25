import { describe, expect, it, vi } from "vitest";

import type { EventRecord, PlannerApi, TaskRecord } from "../src/shared/planner-contracts";
import { loadCalendarData } from "../src/renderer/features/calendar/calendar-data";
import {
  createMonthGrid,
  firstSelectedDateForMonth,
  groupCalendarRecordsByDay,
  monthStartFor,
  nextMonthStartFor,
  toLocalCalendarDate,
  toLocalDateTimeWithOffset
} from "../src/renderer/features/calendar/calendar-date-utils";

const task = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "task-1",
  title: "Tarea real",
  description: null,
  dueDate: "2026-09-15",
  dueTime: "09:30",
  priority: "MEDIUM",
  status: "PENDING",
  categoryId: null,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides
});

const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: "event-1",
  title: "Evento real",
  description: null,
  startAt: "2026-09-15T14:00:00Z",
  endAt: null,
  categoryId: null,
  location: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...overrides
});

const plannerWith = (
  tasksResult: ReturnType<PlannerApi["tasks"]["list"]>,
  eventsResult: ReturnType<PlannerApi["events"]["list"]>
): PlannerApi => ({
  tasks: { list: vi.fn(() => tasksResult) },
  events: { list: vi.fn(() => eventsResult) }
} as unknown as PlannerApi);

describe("calendar date helpers", () => {
  it("generates a stable six-week grid beginning on Monday", () => {
    const grid = createMonthGrid(new Date(2026, 8, 1));

    expect(grid).toHaveLength(42);
    expect(grid[0].date.getDay()).toBe(1);
    expect(grid.some((day) => day.isoDate === "2026-09-01" && day.isCurrentMonth)).toBe(true);
  });

  it("supports previous, next, and today month selection without mutation", () => {
    const month = monthStartFor(new Date(2026, 8, 15));
    const today = new Date(2026, 8, 15);

    expect(nextMonthStartFor(month)).toEqual(new Date(2026, 9, 1));
    expect(firstSelectedDateForMonth(month, today)).toBe("2026-09-15");
    expect(firstSelectedDateForMonth(month, new Date(2026, 9, 15))).toBe("2026-09-01");
  });

  it("places dated tasks and local events on their real calendar day while excluding undated tasks", () => {
    const datedTask = task();
    const undatedTask = task({ id: "task-2", dueDate: null, dueTime: null });
    const plannerEvent = event();
    const eventDay = toLocalCalendarDate(new Date(plannerEvent.startAt));

    const grouped = groupCalendarRecordsByDay([datedTask, undatedTask], [plannerEvent]);

    expect(grouped.get(datedTask.dueDate!)?.tasks).toEqual([datedTask]);
    expect(grouped.get(eventDay)?.events).toEqual([plannerEvent]);
    expect([...grouped.values()].flatMap((items) => items.tasks)).not.toContain(undatedTask);
  });

  it("creates a complete local event query boundary with an explicit offset", () => {
    expect(toLocalDateTimeWithOffset(new Date(2026, 8, 1, 0, 0, 0))).toMatch(/T00:00:00[+-]\d{2}:\d{2}$/);
  });
});

describe("calendar planner reads", () => {
  it("loads tasks and events through only the approved list methods", async () => {
    const planner = plannerWith(
      Promise.resolve({ ok: true, data: { items: [task()], total: 1 } }),
      Promise.resolve({ ok: true, data: { items: [event()], total: 1 } })
    );

    const result = await loadCalendarData(planner, new Date(2026, 8, 1));

    expect(result).toMatchObject({ tasks: [task()], events: [event()] });
    expect(planner.tasks.list).toHaveBeenCalledOnce();
    expect(planner.events.list).toHaveBeenCalledOnce();
    expect(Object.keys(planner.tasks)).toEqual(["list"]);
    expect(Object.keys(planner.events)).toEqual(["list"]);
  });

  it("keeps successful events when the task source returns a controlled failure", async () => {
    const planner = plannerWith(
      Promise.resolve({ ok: false, error: { code: "PLANNER_DATABASE_UNAVAILABLE", userMessage: "unsafe source text" } }),
      Promise.resolve({ ok: true, data: { items: [event()], total: 1 } })
    );

    const result = await loadCalendarData(planner, new Date(2026, 8, 1));

    expect(result.tasks).toEqual([]);
    expect(result.events).toEqual([event()]);
    expect(result.taskError).toBe("No se pudieron cargar las tareas del calendario.");
    expect(result.taskError).not.toContain("unsafe source text");
  });

  it("keeps successful tasks when the event source throws", async () => {
    const planner = plannerWith(
      Promise.resolve({ ok: true, data: { items: [task()], total: 1 } }),
      Promise.reject(new Error("technical failure"))
    );

    const result = await loadCalendarData(planner, new Date(2026, 8, 1));

    expect(result.tasks).toEqual([task()]);
    expect(result.events).toEqual([]);
    expect(result.eventError).toBe("No se pudieron cargar los eventos del calendario.");
  });

  it("returns controlled empty source errors when planner access is unavailable", async () => {
    const result = await loadCalendarData(undefined, new Date(2026, 8, 1));

    expect(result.tasks).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.taskError).toBeDefined();
    expect(result.eventError).toBeDefined();
  });
});
