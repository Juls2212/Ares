import { describe, expect, it } from "vitest";
import {
  validateCompleteTaskInput,
  validateCreateCategoryInput,
  validateCreateEventInput,
  validateCreateReminderInput,
  validateCreateTaskInput,
  validateCreateWeeklyRoutineInput,
  validateCreateWeeklyScheduleInput,
  validateDeleteWeeklyRoutineInput,
  validateDeleteWeeklyScheduleInput,
  validateGetWeekScheduleInput,
  validateReminderListInput,
  validateUpdateCategoryInput,
  validateUpdateEventInput,
  validateUpdateTaskInput
  , validateUpdateWeeklyRoutineInput
  , validateWeeklyRoutineListInput
  , validateUpdateWeeklyScheduleInput
  , validateWeeklyScheduleListInput
} from "../src/main/planner/planner-validation";
import type { PlannerOperationResult } from "../src/shared/planner-contracts";
import { LEGACY_TEST_MARKER } from "./helpers/read-source";
// LEGACY: scheduled for deletion in Refactor Phase 3.1. Only verifies weekly routine and schedule validators (split out of planner-validation).
void LEGACY_TEST_MARKER;

const categoryId = "550e8400-e29b-41d4-a716-446655440000";
const taskId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const eventId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const weeklyScheduleId = "21ae1498-1a4e-4f85-86ae-0db35afc8921";
const dateTime = "2026-09-17T09:30:00-05:00";

const expectFailureCode = <T>(result: PlannerOperationResult<T>, code: string): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
};

describe("legacy weekly routine and schedule validation", () => {
  it("validates strict weekly routine fields and rejects invalid local ranges", () => {
    expect(validateCreateWeeklyRoutineInput({
      weeklyScheduleId,
      title: "  Clase de diseño  ",
      weekday: "MONDAY",
      startTime: "08:00",
      endTime: "10:00",
      location: "  Aula 4  "
    })).toEqual({ ok: true, data: { weeklyScheduleId, title: "Clase de diseño", weekday: "MONDAY", startTime: "08:00", endTime: "10:00", location: "Aula 4" } });
    expectFailureCode(validateCreateWeeklyRoutineInput({ weeklyScheduleId, title: "Clase", weekday: "MONDAY", startTime: "10:00", endTime: "10:00" }), "PLANNER_WEEKLY_ROUTINE_TIME_RANGE_INVALID");
    expectFailureCode(validateCreateWeeklyRoutineInput({ weeklyScheduleId, title: "Clase", weekday: "UNKNOWN", startTime: "08:00", endTime: "10:00" }), "PLANNER_ENUM_INVALID");
    expectFailureCode(validateCreateWeeklyRoutineInput({ weeklyScheduleId, title: "Clase", weekday: "MONDAY", startTime: "08:00", endTime: "10:00", location: "  " }), "PLANNER_TEXT_INVALID");
    expectFailureCode(validateCreateWeeklyRoutineInput({ weeklyScheduleId, title: "Clase", weekday: "MONDAY", startTime: "08:00", endTime: "10:00", extra: true }), "PLANNER_UNKNOWN_FIELD");
  });
  it("validates weekly routine updates, list filters, and identifiers", () => {
    expectFailureCode(validateUpdateWeeklyRoutineInput({ routineId: eventId, weeklyScheduleId }), "PLANNER_UPDATE_EMPTY");
    expectFailureCode(validateUpdateWeeklyRoutineInput({ routineId: eventId, weeklyScheduleId, startTime: "10:00", endTime: "09:00" }), "PLANNER_WEEKLY_ROUTINE_TIME_RANGE_INVALID");
    expect(validateWeeklyRoutineListInput({ weeklyScheduleId, weekday: "FRIDAY", categoryId })).toEqual({ ok: true, data: { weeklyScheduleId, weekday: "FRIDAY", categoryId } });
    expectFailureCode(validateWeeklyRoutineListInput({ weekday: "FRIDAY", unknown: true }), "PLANNER_UNKNOWN_FIELD");
    expectFailureCode(validateDeleteWeeklyRoutineInput({ routineId: "not-a-uuid" }), "PLANNER_IDENTIFIER_INVALID");
  });
  it("validates named weekly schedules and rejects blank, invalid, and unsupported input", () => {
    expect(validateCreateWeeklyScheduleInput({ title: "  Clases de U  ", description: "  Universidad  ", color: "#164C87" })).toEqual({ ok: true, data: { title: "Clases de U", description: "Universidad", color: "#164C87" } });
    expectFailureCode(validateCreateWeeklyScheduleInput({ title: "   " }), "PLANNER_TEXT_INVALID");
    expectFailureCode(validateCreateWeeklyScheduleInput({ title: "Clases", color: "blue" }), "PLANNER_COLOR_INVALID");
    expectFailureCode(validateUpdateWeeklyScheduleInput({ weeklyScheduleId, description: "  " }), "PLANNER_TEXT_INVALID");
    expect(validateWeeklyScheduleListInput({})).toEqual({ ok: true, data: {} });
    expectFailureCode(validateWeeklyScheduleListInput({ extra: true }), "PLANNER_UNKNOWN_FIELD");
    expectFailureCode(validateDeleteWeeklyScheduleInput({ weeklyScheduleId: "not-a-uuid" }), "PLANNER_IDENTIFIER_INVALID");
  });
});
