import { describe, expect, it } from "vitest";
import {
  validateCompleteTaskInput,
  validateCreateCategoryInput,
  validateCreateEventInput,
  validateCreateReminderInput,
  validateCreateTaskInput,
  validateGetWeekScheduleInput,
  validateReminderListInput,
  validateUpdateCategoryInput,
  validateUpdateEventInput,
  validateUpdateTaskInput
} from "../src/main/planner/planner-validation";
import type { PlannerOperationResult } from "../src/shared/planner-contracts";

const categoryId = "550e8400-e29b-41d4-a716-446655440000";
const taskId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const eventId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const dateTime = "2026-09-17T09:30:00-05:00";

const expectFailureCode = <T>(result: PlannerOperationResult<T>, code: string): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
};

describe("planner validation", () => {
  it("accepts and trims valid category input", () => {
    const result = validateCreateCategoryInput({
      name: "  Trabajo  ",
      color: " #1A2B3C ",
      icon: "  briefcase  "
    });

    expect(result).toEqual({
      ok: true,
      data: { name: "Trabajo", color: "#1A2B3C", icon: "briefcase" }
    });
  });

  it("rejects blank category names, invalid colors, and oversized category text", () => {
    expectFailureCode(validateCreateCategoryInput({ name: "   " }), "PLANNER_TEXT_INVALID");
    expectFailureCode(
      validateCreateCategoryInput({ name: "Trabajo", color: "#12345G" }),
      "PLANNER_COLOR_INVALID"
    );
    expectFailureCode(
      validateCreateCategoryInput({ name: "x".repeat(121) }),
      "PLANNER_TEXT_TOO_LONG"
    );
  });

  it("validates category identifiers and rejects empty updates", () => {
    expectFailureCode(
      validateUpdateCategoryInput({ categoryId: "not-a-uuid", name: "Trabajo" }),
      "PLANNER_IDENTIFIER_INVALID"
    );
    expectFailureCode(validateUpdateCategoryInput({ categoryId }), "PLANNER_UPDATE_EMPTY");
  });

  it("rejects unknown keys and never includes raw input in the controlled error", () => {
    const secret = "do-not-expose-this-planner-input";
    const result = validateCreateTaskInput({ title: "Informe", unapprovedField: secret });

    expectFailureCode(result, "PLANNER_UNKNOWN_FIELD");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(result)).not.toContain("postgresql://");
  });

  it("requires strict real calendar dates and local times", () => {
    expectFailureCode(validateCreateTaskInput({ title: "   " }), "PLANNER_TEXT_INVALID");
    expectFailureCode(
      validateCreateTaskInput({ title: "Informe", dueDate: "2026-02-29" }),
      "PLANNER_DATE_INVALID"
    );
    expectFailureCode(
      validateCreateTaskInput({ title: "Informe", dueDate: "2026-02-28", dueTime: "24:00" }),
      "PLANNER_TIME_INVALID"
    );
    expectFailureCode(
      validateGetWeekScheduleInput({ weekStart: "2026-9-7" }),
      "PLANNER_DATE_INVALID"
    );
  });

  it("requires explicit time-zone offsets for exact instants", () => {
    expectFailureCode(
      validateCreateEventInput({ title: "Reunión", startAt: "2026-09-17T09:30:00" }),
      "PLANNER_DATE_TIME_INVALID"
    );
    expect(validateCompleteTaskInput({ taskId, completedAt: "2026-09-17T14:30:00Z" })).toEqual({
      ok: true,
      data: { taskId, completedAt: "2026-09-17T14:30:00Z" }
    });
  });

  it("enforces task due-date and completion-state consistency", () => {
    expectFailureCode(
      validateCreateTaskInput({ title: "Informe", dueTime: "09:30" }),
      "PLANNER_TASK_DUE_TIME_REQUIRES_DATE"
    );
    expectFailureCode(
      validateCreateTaskInput({ title: "Informe", status: "COMPLETED" }),
      "PLANNER_TASK_COMPLETION_STATE_INVALID"
    );
    expectFailureCode(
      validateCreateTaskInput({ title: "Informe", completedAt: dateTime }),
      "PLANNER_TASK_COMPLETION_STATE_INVALID"
    );

    expect(
      validateCreateTaskInput({
        title: "  Informe final  ",
        dueDate: "2026-09-18",
        dueTime: "09:30",
        priority: "HIGH",
        status: "COMPLETED",
        completedAt: dateTime
      })
    ).toEqual({
      ok: true,
      data: {
        title: "Informe final",
        dueDate: "2026-09-18",
        dueTime: "09:30",
        priority: "HIGH",
        status: "COMPLETED",
        completedAt: dateTime
      }
    });
  });

  it("requires paired state fields, validates task enums, and permits state-dependent date updates", () => {
    expectFailureCode(
      validateUpdateTaskInput({ taskId, status: "COMPLETED" }),
      "PLANNER_TASK_COMPLETION_STATE_INVALID"
    );
    expectFailureCode(
      validateUpdateTaskInput({ taskId, status: "PENDING", completedAt: dateTime }),
      "PLANNER_TASK_COMPLETION_STATE_INVALID"
    );
    expectFailureCode(
      validateUpdateTaskInput({ taskId, priority: "URGENT" }),
      "PLANNER_ENUM_INVALID"
    );
    expectFailureCode(
      validateUpdateTaskInput({ taskId, status: "UNKNOWN", completedAt: dateTime }),
      "PLANNER_ENUM_INVALID"
    );
    expect(validateUpdateTaskInput({ taskId, dueDate: null })).toEqual({
      ok: true,
      data: { taskId, dueDate: null }
    });
  });

  it("trims event titles and rejects invalid event time ranges", () => {
    expect(
      validateCreateEventInput({
        title: "  Reunión de proyecto  ",
        startAt: "2026-09-17T09:30:00-05:00",
        endAt: "2026-09-17T10:30:00-05:00",
        categoryId
      })
    ).toEqual({
      ok: true,
      data: {
        title: "Reunión de proyecto",
        startAt: "2026-09-17T09:30:00-05:00",
        endAt: "2026-09-17T10:30:00-05:00",
        categoryId
      }
    });
    expectFailureCode(
      validateCreateEventInput({
        title: "Reunión",
        startAt: "2026-09-17T10:30:00-05:00",
        endAt: "2026-09-17T10:30:00-05:00"
      }),
      "PLANNER_EVENT_TIME_RANGE_INVALID"
    );
    expectFailureCode(
      validateUpdateEventInput({
        eventId,
        startAt: "2026-09-17T11:30:00-05:00",
        endAt: "2026-09-17T10:30:00-05:00"
      }),
      "PLANNER_EVENT_TIME_RANGE_INVALID"
    );
  });

  it("accepts independent, task-linked, and event-linked reminders", () => {
    expect(validateCreateReminderInput({ title: "Llamar a Juan", remindAt: dateTime })).toEqual({
      ok: true,
      data: { title: "Llamar a Juan", remindAt: dateTime }
    });
    expect(
      validateCreateReminderInput({ title: "  Recordar tarea  ", remindAt: dateTime, taskId })
    ).toEqual({ ok: true, data: { title: "Recordar tarea", remindAt: dateTime, taskId } });
    expect(
      validateCreateReminderInput({ title: "Recordar evento", remindAt: dateTime, eventId })
    ).toEqual({ ok: true, data: { title: "Recordar evento", remindAt: dateTime, eventId } });
  });

  it("enforces reminder associations and delivery states", () => {
    expectFailureCode(
      validateCreateReminderInput({ title: "   ", remindAt: dateTime }),
      "PLANNER_TEXT_INVALID"
    );
    expectFailureCode(
      validateCreateReminderInput({ title: "Recordatorio", remindAt: dateTime, taskId, eventId }),
      "PLANNER_REMINDER_ASSOCIATION_INVALID"
    );
    expectFailureCode(
      validateCreateReminderInput({ title: "Recordatorio", remindAt: dateTime, status: "TRIGGERED" }),
      "PLANNER_REMINDER_DELIVERY_STATE_INVALID"
    );
    expectFailureCode(
      validateCreateReminderInput({
        title: "Recordatorio",
        remindAt: dateTime,
        status: "PENDING",
        deliveredAt: dateTime
      }),
      "PLANNER_REMINDER_DELIVERY_STATE_INVALID"
    );
    expectFailureCode(
      validateCreateReminderInput({ title: "Recordatorio", remindAt: dateTime, status: "UNKNOWN" }),
      "PLANNER_ENUM_INVALID"
    );
    expect(
      validateCreateReminderInput({
        title: "Recordatorio enviado",
        remindAt: dateTime,
        status: "TRIGGERED",
        deliveredAt: "2026-09-17T09:31:00-05:00"
      })
    ).toEqual({
      ok: true,
      data: {
        title: "Recordatorio enviado",
        remindAt: dateTime,
        status: "TRIGGERED",
        deliveredAt: "2026-09-17T09:31:00-05:00"
      }
    });
  });

  it("validates reminder list filters without querying a database", () => {
    expectFailureCode(
      validateReminderListInput({ statuses: ["PENDING", "UNKNOWN"] }),
      "PLANNER_ENUM_INVALID"
    );
    expectFailureCode(
      validateReminderListInput({ taskId, eventId }),
      "PLANNER_REMINDER_ASSOCIATION_INVALID"
    );
  });
});
