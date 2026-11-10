import { describe, expect, it, vi } from "vitest";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { PlannerActionProposal } from "../src/shared/action-contracts";
import type { PlannerService } from "../src/main/planner/planner-service";
import { LEGACY_TEST_MARKER } from "./helpers/read-source";
// LEGACY: scheduled for deletion in Refactor Phase 3.1. Only verifies the weekly schedule analysis and mutation actions (split out of planner-action-executor).
void LEGACY_TEST_MARKER;

const success = { ok: true as const, data: { record: {} } };

const createPlannerService = (): PlannerService =>
  ({
    createTask: vi.fn(async () => success),
    updateTask: vi.fn(async () => success),
    completeTask: vi.fn(async () => success),
    createEvent: vi.fn(async () => success),
    updateEvent: vi.fn(async () => success),
    deleteEvent: vi.fn(async () => ({ ok: true, data: { deleted: true } })),
    createReminder: vi.fn(async () => success),
    createWeeklyRoutine: vi.fn(async () => success),
    updateWeeklyRoutine: vi.fn(async () => success),
    deleteWeeklyRoutine: vi.fn(async () => ({ ok: true, data: { deleted: true } })),
    createWeeklySchedule: vi.fn(async () => success),
    updateWeeklySchedule: vi.fn(async () => success),
    listCategories: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })),
    listWeeklySchedules: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })),
    listWeeklyRoutines: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })),
    getTodaySchedule: vi.fn(async () => ({ ok: true, data: { localDate: "2026-09-17", tasks: [], events: [], reminders: [] } })),
    getWeekSchedule: vi.fn(async () => ({
      ok: true,
      data: { weekStart: "2026-09-14", weekEnd: "2026-09-20", tasks: [], events: [], reminders: [] }
    }))
  }) as unknown as PlannerService;

const actionCases: Array<{ action: PlannerActionProposal["action"]; input: unknown; method: keyof PlannerService }> = [
  { action: "CREATE_TASK", input: { title: "Informe" }, method: "createTask" },
  { action: "UPDATE_TASK", input: { taskId: "550e8400-e29b-41d4-a716-446655440000", title: "Informe" }, method: "updateTask" },
  { action: "COMPLETE_TASK", input: { taskId: "550e8400-e29b-41d4-a716-446655440000", completedAt: "2026-09-17T10:00:00Z" }, method: "completeTask" },
  { action: "CREATE_EVENT", input: { title: "Reunión", startAt: "2026-09-17T10:00:00Z" }, method: "createEvent" },
  { action: "UPDATE_EVENT", input: { eventId: "550e8400-e29b-41d4-a716-446655440000", title: "Reunión" }, method: "updateEvent" },
  { action: "DELETE_EVENT", input: { eventId: "550e8400-e29b-41d4-a716-446655440000" }, method: "deleteEvent" },
  { action: "CREATE_REMINDER", input: { title: "Llamar", remindAt: "2026-09-17T10:00:00Z" }, method: "createReminder" },
  { action: "GET_TODAY_SCHEDULE", input: {}, method: "getTodaySchedule" },
  { action: "GET_WEEK_SCHEDULE", input: {}, method: "getWeekSchedule" }
];

describe("legacy weekly schedule actions in the planner executor", () => {
  it("keeps weekly schedule analysis Main-grounded and available through the existing final-response summary", async () => {
    const plannerService = createPlannerService();
    vi.mocked(plannerService.listWeeklySchedules).mockResolvedValueOnce({
      ok: true,
      data: {
        items: [{ id: "schedule-private", title: "Universidad", description: null, color: null, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" }],
        total: 1
      }
    } as never);
    vi.mocked(plannerService.listWeeklyRoutines).mockResolvedValueOnce({
      ok: true,
      data: {
        items: [{ id: "routine-private", weeklyScheduleId: "schedule-private", title: "Álgebra", weekday: "MONDAY", startTime: "08:00", endTime: "10:00", categoryId: null, location: null, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" }],
        total: 1
      }
    } as never);
    const executor = createPlannerActionExecutor({ plannerService, timeZone: () => "America/Bogota", logError: vi.fn() });

    const outcome = await executor.execute(
      { actionId: "11111111-1111-4111-8111-111111111111", action: "GET_WEEKLY_SCHEDULE_DETAILS", input: { scheduleTitle: "Universidad" } },
      getActionPolicy("GET_WEEKLY_SCHEDULE_DETAILS")
    );

    expect(outcome).toMatchObject({ status: "SUCCEEDED", action: "GET_WEEKLY_SCHEDULE_DETAILS", userSummary: expect.stringContaining("Álgebra") });
    expect(outcome.userSummary).not.toContain("schedule-private");
    expect(vi.mocked(plannerService.createWeeklyRoutine)).not.toHaveBeenCalled();
    expect(vi.mocked(plannerService.updateWeeklyRoutine)).not.toHaveBeenCalled();
    expect(vi.mocked(plannerService.deleteWeeklyRoutine)).not.toHaveBeenCalled();
  });
  it("resolves weekly mutation references in Main and only returns grounded successful summaries", async () => {
    const plannerService = createPlannerService();
    const schedule = { id: "550e8400-e29b-41d4-a716-446655440000", title: "Universidad", description: null, color: null, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" };
    vi.mocked(plannerService.listWeeklySchedules).mockResolvedValue({ ok: true, data: { items: [schedule], total: 1 } } as never);
    vi.mocked(plannerService.createWeeklyRoutine).mockResolvedValue({
      ok: true,
      data: { record: { id: "private-routine-id", weeklyScheduleId: schedule.id, title: "Cálculo", weekday: "MONDAY", startTime: "08:00", endTime: "10:00", categoryId: null, location: null } }
    } as never);
    const executor = createPlannerActionExecutor({ plannerService, logError: vi.fn() });

    const created = await executor.execute(
      { actionId: "11111111-1111-4111-8111-111111111111", action: "CREATE_WEEKLY_ROUTINE", input: { scheduleTitle: "Universidad", title: "Cálculo", weekday: "MONDAY", startTime: "08:00", endTime: "10:00" } },
      getActionPolicy("CREATE_WEEKLY_ROUTINE")
    );
    expect(created).toMatchObject({ status: "SUCCEEDED", userSummary: "Listo, agregué «Cálculo» el lunes de 08:00 a 10:00 en «Universidad»." });
    expect(JSON.stringify(created)).not.toContain("private-routine-id");
    expect(plannerService.createWeeklyRoutine).toHaveBeenCalledWith(expect.objectContaining({ weeklyScheduleId: schedule.id, title: "Cálculo" }));

    vi.mocked(plannerService.listWeeklySchedules).mockResolvedValueOnce({ ok: true, data: { items: [], total: 0 } } as never);
    const missing = await executor.execute(
      { actionId: "22222222-2222-4222-8222-222222222222", action: "UPDATE_WEEKLY_SCHEDULE", input: { scheduleTitle: "Trabajo", title: "Trabajo nuevo" } },
      getActionPolicy("UPDATE_WEEKLY_SCHEDULE")
    );
    expect(missing).toMatchObject({ status: "VALIDATION_FAILED", userSummary: "No encontré ese horario semanal." });
    expect(plannerService.updateWeeklySchedule).not.toHaveBeenCalled();

    const otherSchedule = { ...schedule, id: "550e8400-e29b-41d4-a716-446655440002", title: "Trabajo" };
    vi.mocked(plannerService.listWeeklySchedules).mockResolvedValueOnce({ ok: true, data: { items: [schedule, otherSchedule], total: 2 } } as never);
    vi.mocked(plannerService.listWeeklySchedules).mockResolvedValueOnce({ ok: true, data: { items: [schedule, otherSchedule], total: 2 } } as never);
    const duplicate = await executor.execute(
      { actionId: "22222222-2222-4222-8222-222222222222", action: "UPDATE_WEEKLY_SCHEDULE", input: { scheduleTitle: "Universidad", title: "Trabajo" } },
      getActionPolicy("UPDATE_WEEKLY_SCHEDULE")
    );
    expect(duplicate).toMatchObject({ status: "VALIDATION_FAILED", userSummary: "Ya existe un horario con ese nombre. Indica otro nombre." });
    expect(plannerService.updateWeeklySchedule).not.toHaveBeenCalled();

    vi.mocked(plannerService.createWeeklyRoutine).mockResolvedValueOnce({
      ok: false,
      error: { code: "PLANNER_NOT_FOUND", userMessage: "No se pudo actualizar el bloque semanal." }
    } as never);
    const failed = await executor.execute(
      { actionId: "33333333-3333-4333-8333-333333333333", action: "CREATE_WEEKLY_ROUTINE", input: { scheduleTitle: "Universidad", title: "Cálculo", weekday: "MONDAY", startTime: "08:00", endTime: "10:00" } },
      getActionPolicy("CREATE_WEEKLY_ROUTINE")
    );
    expect(failed).toMatchObject({ status: "VALIDATION_FAILED", userSummary: "No se pudo actualizar el bloque semanal." });
    expect(failed.userSummary).not.toContain("Listo");
  });
});
