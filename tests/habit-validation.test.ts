import { describe, expect, it } from "vitest";
import {
  validateCompleteHabitInput,
  validateCreateHabitInput,
  validateHabitDailyProgressInput,
  validateHabitWeeklyProgressInput,
  validateUpdateHabitInput
} from "../src/main/habits/habit-validation";

const habitId = "550e8400-e29b-41d4-a716-446655440000";
const categoryId = "550e8400-e29b-41d4-a716-446655440001";

const expectFailure = (result: { ok: boolean; error?: { code: string } }, code: string): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error?.code).toBe(code);
};

describe("habit validation", () => {
  it("validates trimmed daily and weekly inputs without changing frequency targets", () => {
    expect(validateCreateHabitInput({ title: "  Leer  ", frequency: "DAILY", targetCount: 1, categoryId })).toEqual({ ok: true, data: { title: "Leer", icon: "SPARK", frequency: "DAILY", targetCount: 1, categoryId } });
    expect(validateCreateHabitInput({ title: "Entrenar", frequency: "WEEKLY", targetCount: 3, icon: "DUMBBELL" })).toEqual({ ok: true, data: { title: "Entrenar", icon: "DUMBBELL", frequency: "WEEKLY", targetCount: 3 } });
  });

  it("rejects unknown fields, blank text, mismatched targets, and invalid identifiers", () => {
    expectFailure(validateCreateHabitInput({ title: "", frequency: "DAILY", targetCount: 1 }), "HABIT_TEXT_INVALID");
    expectFailure(validateCreateHabitInput({ title: "Leer", frequency: "DAILY", targetCount: 2 }), "HABIT_TARGET_COUNT_INVALID");
    expectFailure(validateCreateHabitInput({ title: "Leer", frequency: "WEEKLY", targetCount: 8 }), "HABIT_TARGET_COUNT_INVALID");
    expectFailure(validateCreateHabitInput({ title: "Leer", frequency: "DAILY", targetCount: 1, extra: true }), "HABIT_UNKNOWN_FIELD");
    expectFailure(validateCreateHabitInput({ title: "Leer", frequency: "DAILY", targetCount: 1, categoryId: "bad" }), "HABIT_IDENTIFIER_INVALID");
    expectFailure(validateCreateHabitInput({ title: "Leer", frequency: "DAILY", targetCount: 1, icon: "SCRIPT" }), "HABIT_ICON_INVALID");
  });

  it("validates real calendar dates and Monday week starts", () => {
    expect(validateCompleteHabitInput({ habitId, completedOn: "2026-02-28" }).ok).toBe(true);
    expectFailure(validateCompleteHabitInput({ habitId, completedOn: "2026-02-30" }), "HABIT_DATE_INVALID");
    expect(validateHabitDailyProgressInput({ date: "2026-09-21" }).ok).toBe(true);
    expect(validateHabitWeeklyProgressInput({ weekStart: "2026-09-21" }).ok).toBe(true);
    expectFailure(validateHabitWeeklyProgressInput({ weekStart: "2026-09-22" }), "HABIT_DATE_INVALID");
  });

  it("rejects empty updates and preserves explicit nullable update fields", () => {
    expectFailure(validateUpdateHabitInput({ habitId }), "HABIT_UPDATE_EMPTY");
    expect(validateUpdateHabitInput({ habitId, description: null, categoryId: null, icon: "BOOK", active: false })).toEqual({ ok: true, data: { habitId, description: null, categoryId: null, icon: "BOOK", active: false } });
  });
});
