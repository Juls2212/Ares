import { describe, expect, it, vi } from "vitest";
import { createHabitService } from "../src/main/habits/habit-service";
import type { HabitRepositories } from "../src/main/habits/habit-repository";
import type { HabitCompletionRecord, HabitRecord } from "../src/shared/habit-contracts";

const daily: HabitRecord = { id: "550e8400-e29b-41d4-a716-446655440000", title: "Leer", description: null, categoryId: null, icon: "BOOK", frequency: "DAILY", targetCount: 1, active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const weekly: HabitRecord = { ...daily, id: "550e8400-e29b-41d4-a716-446655440001", title: "Entrenar", frequency: "WEEKLY", targetCount: 3 };
const completion = (habitId: string, completedOn: string): HabitCompletionRecord => ({ id: `${habitId}-${completedOn}`, habitId, completedOn, completedAt: "2026-09-21T12:00:00.000Z" });

const createRepositories = (completions: HabitCompletionRecord[] = []): HabitRepositories => ({
  createHabit: vi.fn(async (input) => ({ ...daily, ...input })),
  findHabitById: vi.fn(async (id) => id === daily.id ? daily : id === weekly.id ? weekly : undefined),
  listHabits: vi.fn(async () => [daily, weekly]),
  updateHabit: vi.fn(async (input) => ({ ...daily, ...input })),
  findCategoryById: vi.fn(async () => true),
  completeHabit: vi.fn(async (input) => completion(input.habitId, input.completedOn)),
  listCompletions: vi.fn(async ({ habitIds, from, to }) => completions.filter((item) => habitIds.includes(item.habitId) && (from === undefined || item.completedOn >= from) && (to === undefined || item.completedOn <= to)))
});

describe("habit service", () => {
  it("creates only validated habits and reports missing category and habit references", async () => {
    const repositories = createRepositories();
    const service = createHabitService({ repositories, logError: vi.fn() });
    await expect(service.create({ title: "Leer", frequency: "DAILY", targetCount: 1 })).resolves.toMatchObject({ ok: true, data: { record: { title: "Leer" } } });
    vi.mocked(repositories.findCategoryById).mockResolvedValueOnce(false);
    await expect(service.create({ title: "Leer", frequency: "DAILY", targetCount: 1, categoryId: "550e8400-e29b-41d4-a716-446655440002" })).resolves.toMatchObject({ ok: false, error: { code: "HABIT_REFERENCE_NOT_FOUND" } });
    await expect(service.complete({ habitId: "550e8400-e29b-41d4-a716-446655440099", completedOn: "2026-09-21" })).resolves.toMatchObject({ ok: false, error: { code: "HABIT_NOT_FOUND" } });
  });

  it("delegates idempotent completion records without a duplicate write", async () => {
    const repositories = createRepositories();
    const service = createHabitService({ repositories, logError: vi.fn() });
    const first = await service.complete({ habitId: daily.id, completedOn: "2026-09-21" });
    const second = await service.complete({ habitId: daily.id, completedOn: "2026-09-21" });
    expect(first).toEqual(second);
    expect(repositories.completeHabit).toHaveBeenCalledTimes(2);
  });

  it("derives completed and pending daily progress plus daily streaks from real completion dates", async () => {
    const repositories = createRepositories([
      completion(daily.id, "2026-09-19"), completion(daily.id, "2026-09-20"), completion(daily.id, "2026-09-21")
    ]);
    vi.mocked(repositories.listHabits).mockResolvedValueOnce([daily]);
    const result = await createHabitService({ repositories, logError: vi.fn() }).getDailyProgress({ date: "2026-09-21" });
    expect(result).toMatchObject({ ok: true, data: { completed: [{ habit: { id: daily.id }, currentStreak: 3, longestStreak: 3 }], pending: [] } });
  });

  it("uses Monday through Sunday periods and merges weekly targets into weekly streaks", async () => {
    const repositories = createRepositories([
      completion(weekly.id, "2026-09-07"), completion(weekly.id, "2026-09-08"), completion(weekly.id, "2026-09-09"),
      completion(weekly.id, "2026-09-14"), completion(weekly.id, "2026-09-15"), completion(weekly.id, "2026-09-16"),
      completion(daily.id, "2026-09-15"), completion(daily.id, "2026-09-16"), completion(daily.id, "2026-09-17")
    ]);
    const result = await createHabitService({ repositories, logError: vi.fn() }).getWeeklyProgress({ weekStart: "2026-09-14" });
    expect(result).toMatchObject({ ok: true, data: { weekStart: "2026-09-14", weekEnd: "2026-09-20" } });
    if (!result.ok) throw new Error("Expected weekly progress to succeed.");
    expect(result.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ habit: expect.objectContaining({ id: weekly.id }), completionCount: 3, periodTargetCount: 3, targetMet: true, currentStreak: 2, longestStreak: 2 }),
      expect.objectContaining({ habit: expect.objectContaining({ id: daily.id }), completionCount: 3, periodTargetCount: 7, targetMet: false, currentStreak: 0, longestStreak: 3 })
    ]));
  });
});
