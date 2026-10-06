import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { closeDatabaseConnection, getDatabase } from "../src/main/database/database-client";
import { habitCompletions, habits } from "../src/main/database/schema";
import { createHabitRepositories } from "../src/main/habits/habit-repository";
import { createHabitService } from "../src/main/habits/habit-service";
import type { HabitOperationResult } from "../src/shared/habit-contracts";

const database = getDatabase();
const service = createHabitService({
  repositories: createHabitRepositories(database),
  logError: () => undefined
});
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const createdHabitIds: string[] = [];

const getSuccess = <T>(result: HabitOperationResult<T>): T => {
  if (!result.ok) {
    throw new Error(`Expected habit operation to succeed: ${result.error.code}`);
  }
  expect(result.ok).toBe(true);
  return result.data;
};

afterEach(async () => {
  if (createdHabitIds.length > 0) {
    await database.delete(habits).where(inArray(habits.id, createdHabitIds));
  }
  createdHabitIds.length = 0;
});

afterAll(async () => {
  await closeDatabaseConnection();
});

describe("habit database integration", () => {
  it("persists habits, keeps one completion per local date, and calculates progress", async () => {
    const daily = getSuccess(
      await service.create({
        title: `Daily habit ${suffix}`,
        frequency: "DAILY",
        targetCount: 1
      })
    ).record;
    const weekly = getSuccess(
      await service.create({
        title: `Weekly habit ${suffix}`,
        frequency: "WEEKLY",
        targetCount: 3
      })
    ).record;
    createdHabitIds.push(daily.id, weekly.id);
    expect(daily.icon).toBe("SPARK");
    expect(weekly.icon).toBe("SPARK");

    const firstCompletion = getSuccess(
      await service.complete({ habitId: daily.id, completedOn: "2026-09-21" })
    ).record;
    const repeatedCompletion = getSuccess(
      await service.complete({ habitId: daily.id, completedOn: "2026-09-21" })
    ).record;
    expect(repeatedCompletion.id).toBe(firstCompletion.id);

    for (const completedOn of ["2026-09-15", "2026-09-16", "2026-09-17"]) {
      getSuccess(await service.complete({ habitId: weekly.id, completedOn }));
    }

    const [storedDailyCompletion] = await database
      .select()
      .from(habitCompletions)
      .where(inArray(habitCompletions.habitId, [daily.id]));
    expect(storedDailyCompletion.completedOn).toBe("2026-09-21");

    const dailyProgress = getSuccess(await service.getDailyProgress({ date: "2026-09-21" }));
    expect(dailyProgress.completed).toHaveLength(1);
    expect(dailyProgress.completed[0]?.habit.id).toBe(daily.id);

    const weeklyProgress = getSuccess(await service.getWeeklyProgress({ weekStart: "2026-09-14" }));
    expect(weeklyProgress.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          habit: expect.objectContaining({ id: weekly.id }),
          completionCount: 3,
          periodTargetCount: 3,
          targetMet: true,
          currentStreak: 1,
          longestStreak: 1
        })
      ])
    );
  });
});
