import { describe, expect, it, vi } from "vitest";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { PlannerActionProposal } from "../src/shared/action-contracts";
import type { PlannerService } from "../src/main/planner/planner-service";

const success = { ok: true as const, data: { record: {} } };

const createPlannerService = (): PlannerService =>
  ({
    createTask: vi.fn(async () => success),
    updateTask: vi.fn(async () => success),
    completeTask: vi.fn(async () => success),
    createEvent: vi.fn(async () => success),
    updateEvent: vi.fn(async () => success),
    createReminder: vi.fn(async () => success),
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
  { action: "CREATE_REMINDER", input: { title: "Llamar", remindAt: "2026-09-17T10:00:00Z" }, method: "createReminder" },
  { action: "GET_TODAY_SCHEDULE", input: {}, method: "getTodaySchedule" },
  { action: "GET_WEEK_SCHEDULE", input: {}, method: "getWeekSchedule" }
];

describe("planner action executor", () => {
  it("maps every supported planner action to exactly one planner-service method", async () => {
    const plannerService = createPlannerService();
    const executor = createPlannerActionExecutor({ plannerService, logError: vi.fn() });

    for (const item of actionCases) {
      const proposal = {
        actionId: "11111111-1111-4111-8111-111111111111",
        action: item.action,
        input: item.input
      } as PlannerActionProposal;
      const outcome = await executor.execute(proposal, getActionPolicy(item.action));

      expect(outcome.status).toBe("SUCCEEDED");
      expect(vi.mocked(plannerService[item.method] as never)).toHaveBeenCalledTimes(1);
    }
  });

  it("maps a controlled planner failure without changing its Spanish message", async () => {
    const plannerService = createPlannerService();
    vi.mocked(plannerService.createTask).mockResolvedValueOnce({
      ok: false,
      error: { code: "PLANNER_TEXT_INVALID", userMessage: "La información del planificador no es válida." }
    });
    const executor = createPlannerActionExecutor({ plannerService, logError: vi.fn() });

    const outcome = await executor.execute(
      {
        actionId: "11111111-1111-4111-8111-111111111111",
        action: "CREATE_TASK",
        input: { title: " " }
      },
      getActionPolicy("CREATE_TASK")
    );

    expect(outcome).toMatchObject({
      status: "VALIDATION_FAILED",
      errorCode: "PLANNER_TEXT_INVALID",
      userSummary: "La información del planificador no es válida."
    });
  });
});
