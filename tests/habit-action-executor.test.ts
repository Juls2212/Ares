import { describe, expect, it, vi } from "vitest";

import { createHabitActionExecutor } from "../src/main/actions/habit-action-executor";
import type { HabitMutationReferences } from "../src/main/actions/habit-mutation-references";
import type { HabitService } from "../src/main/habits/habit-service";
import { getActionPolicy } from "../src/main/actions/action-policy";

const habit = {
  id: "550e8400-e29b-41d4-a716-446655440010", title: "Leer", description: null, categoryId: null,
  icon: "BOOK" as const, frequency: "DAILY" as const, targetCount: 1, active: true,
  createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z"
};

const references: HabitMutationReferences = {
  resolveHabit: vi.fn(async () => ({ state: "RESOLVED" as const, habit })),
  resolveCategory: vi.fn(async () => ({ state: "MISSING" as const }))
};

const service = (alreadyCompleted = false): HabitService => ({
  create: vi.fn(async (input) => ({ ok: true as const, data: { record: { ...habit, ...(input as object) } } })),
  list: vi.fn(async () => ({ ok: true as const, data: { items: [habit], total: 1 } })),
  update: vi.fn(async () => ({ ok: true as const, data: { record: habit } })),
  complete: vi.fn(async () => ({ ok: true as const, data: { record: { id: "550e8400-e29b-41d4-a716-446655440011", habitId: habit.id, completedOn: "2026-10-04", completedAt: "2026-10-04T12:00:00.000Z" } } })),
  isCompletedOn: vi.fn(async () => ({ ok: true as const, data: alreadyCompleted })),
  getDailyProgress: vi.fn(async () => ({ ok: true as const, data: { date: "2026-10-04", completed: [], pending: [{ habit, completed: false, completion: null, currentStreak: 2, longestStreak: 5 }] } })),
  getWeeklyProgress: vi.fn(async () => ({ ok: true as const, data: { weekStart: "2026-09-29", weekEnd: "2026-10-05", items: [] } }))
});

describe("habit action executor", () => {
  it("composes a Main-grounded daily summary without exposing records", async () => {
    const executor = createHabitActionExecutor({ habitService: service(), references, now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: () => "America/Bogota" });
    const outcome = await executor.execute({ actionId: "action-1", action: "GET_HABIT_PROGRESS", input: { scope: "TODAY" } }, getActionPolicy("GET_HABIT_PROGRESS"));
    expect(outcome).toMatchObject({ status: "SUCCEEDED", userSummary: "Hoy completaste 0 de 1 hábitos. Pendientes: «Leer».", data: {} });
  });

  it("does not write a completion already confirmed for Main's local day", async () => {
    const habits = service(true);
    const executor = createHabitActionExecutor({ habitService: habits, references, now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: () => "America/Bogota" });
    const outcome = await executor.execute({ actionId: "action-2", action: "COMPLETE_HABIT", input: { habitTitle: "Leer" } }, getActionPolicy("COMPLETE_HABIT"));
    expect(outcome).toMatchObject({ status: "SUCCEEDED", userSummary: "«Leer» ya estaba completado hoy." });
    expect(habits.complete).not.toHaveBeenCalled();
  });

  it("uses weekly Main progress for an all-habits weekly request", async () => {
    const habits = service();
    habits.getWeeklyProgress = vi.fn(async () => ({ ok: true as const, data: {
      weekStart: "2026-09-29", weekEnd: "2026-10-05",
      items: [{ habit, completionCount: 2, targetCount: 1, periodTargetCount: 7, targetMet: true, currentStreak: 2, longestStreak: 5 }]
    } }));
    const executor = createHabitActionExecutor({ habitService: habits, references, now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: () => "America/Bogota" });
    const outcome = await executor.execute({ actionId: "action-3", action: "GET_HABIT_PROGRESS", input: { scope: "WEEK" } }, getActionPolicy("GET_HABIT_PROGRESS"));
    expect(outcome.userSummary).toBe("Progreso de esta semana: «Leer»: 2 de 1.");
    expect(habits.getDailyProgress).not.toHaveBeenCalled();
  });
});
