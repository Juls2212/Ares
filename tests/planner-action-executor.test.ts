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
    deleteEvent: vi.fn(async () => ({ ok: true, data: { deleted: true } })),
    createReminder: vi.fn(async () => success),
    listCategories: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })),
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

  it("returns a controlled failure, never undefined, for an action name the executor does not handle", async () => {
    const plannerService = createPlannerService();
    const logError = vi.fn();
    const executor = createPlannerActionExecutor({ plannerService, logError });

    for (const action of ["CREATE_WEEKLY_SCHEDULE", "GET_TODAY_AVAILABILITY", "COMPLETE_HABIT", "SEARCH_FILES", "NOT_AN_ACTION"]) {
      const outcome = await executor.execute(
        { actionId: "11111111-1111-4111-8111-111111111111", action, input: { title: "private title" } } as never,
        getActionPolicy("GET_TODAY_SCHEDULE")
      );
      expect(outcome, action).toEqual({
        actionId: "11111111-1111-4111-8111-111111111111",
        action,
        riskLevel: 1,
        status: "VALIDATION_FAILED",
        errorCode: "ACTION_UNSUPPORTED",
        userSummary: "No puedo hacer eso."
      });
      expect(JSON.stringify(outcome)).not.toContain("private title");
    }
    expect(logError).not.toHaveBeenCalled();
    for (const method of Object.values(plannerService)) expect(vi.mocked(method as never)).not.toHaveBeenCalled();
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

  it("composes a bounded grounded schedule from planner task and event records", async () => {
    const plannerService = createPlannerService();
    vi.mocked(plannerService.getTodaySchedule).mockResolvedValueOnce({
      ok: true,
      data: {
        localDate: "2026-09-17",
        tasks: [
          { id: "task-1", title: "Preparar informe", priority: "HIGH", status: "PENDING", dueTime: "09:30" },
          { id: "task-2", title: "Revisar agenda", priority: "LOW", status: "COMPLETED", dueTime: null },
          { id: "task-3", title: "Enviar correo", priority: "MEDIUM", status: "IN_PROGRESS", dueTime: "11:00" },
          { id: "task-4", title: "Tarea restante", priority: "LOW", status: "PENDING", dueTime: null }
        ],
        events: [
          { id: "event-1", title: "Reunión de equipo", startAt: "2026-09-17T15:30:00.000Z" },
          { id: "event-2", title: "Seguimiento", startAt: "2026-09-17T18:00:00.000Z" },
          { id: "event-3", title: "Cierre", startAt: "2026-09-17T20:00:00.000Z" },
          { id: "event-4", title: "Evento restante", startAt: "2026-09-17T22:00:00.000Z" }
        ],
        reminders: []
      }
    } as never);
    const executor = createPlannerActionExecutor({ plannerService, now: () => new Date("2026-09-17T14:00:00.000Z"), timeZone: () => "America/Bogota", logError: vi.fn() });
    const outcome = await executor.execute(
      { actionId: "11111111-1111-4111-8111-111111111111", action: "GET_TODAY_SCHEDULE", input: {} },
      getActionPolicy("GET_TODAY_SCHEDULE")
    );

    // The agenda is read in time order with 12-hour times; all 8 items fit on screen (up to 12), the voice gets the first 5.
    expect(outcome.userSummary.startsWith("Hoy tienes 8 cosas: a las 9 y media de la mañana, la tarea Preparar informe; a las 10 y media de la mañana, Reunión de equipo; a las 11 de la mañana, la tarea Enviar correo;")).toBe(true);
    expect(outcome.userSummary).toContain("a la 1 de la tarde, Seguimiento");
    expect(outcome.userSummary).toContain("a las 3 de la tarde, Cierre");
    expect(outcome.userSummary).toContain("la tarea Revisar agenda; y la tarea Tarea restante");
    expect(outcome.userSummary).not.toContain("más.");
    const spoken = (outcome as { data: { spokenSummary: string } }).data.spokenSummary;
    expect(spoken).toMatch(/^Hoy tienes 8 cosas: .*; y 3 más\.$/u);
    expect(spoken).not.toContain("Evento restante");
    expect(outcome.userSummary).not.toContain("task-1");
    expect(outcome.userSummary).not.toContain("event-1");
    expect(outcome.userSummary).not.toContain("2026-09-17T15:30:00.000Z");

    vi.mocked(plannerService.getTodaySchedule).mockResolvedValueOnce({
      ok: true,
      data: { localDate: "2026-09-17", tasks: [], events: [], reminders: [] }
    });
    await expect(
      executor.execute(
        { actionId: "11111111-1111-4111-8111-111111111111", action: "GET_TODAY_SCHEDULE", input: {} },
        getActionPolicy("GET_TODAY_SCHEDULE")
      )
    ).resolves.toMatchObject({ userSummary: "Hoy no tienes nada programado." });
  });

  it("derives current date and time from the injected Main clock without consulting planner data", async () => {
    const plannerService = createPlannerService();
    const executor = createPlannerActionExecutor({
      plannerService,
      now: () => new Date("2026-10-02T15:05:00.000Z"),
      timeZone: () => "America/Bogota",
      logError: vi.fn()
    });

    const outcome = await executor.execute(
      { actionId: "11111111-1111-4111-8111-111111111111", action: "GET_CURRENT_DATE_TIME", input: {} },
      getActionPolicy("GET_CURRENT_DATE_TIME")
    );

    expect(outcome).toMatchObject({ status: "SUCCEEDED", action: "GET_CURRENT_DATE_TIME" });
    expect(outcome.userSummary).toContain("2 de octubre de 2026");
    expect(outcome.userSummary).toContain("Son las 10 y 5 de la mañana.");
    expect(outcome.userSummary).not.toContain("2026-10-02T15:05:00.000Z");
    expect(plannerService.getTodaySchedule).not.toHaveBeenCalled();
  });



  it("distinguishes task-only and event-only schedules from the actual returned records", async () => {
    const plannerService = createPlannerService();
    const executor = createPlannerActionExecutor({ plannerService, now: () => new Date("2026-09-17T14:00:00.000Z"), timeZone: () => "America/Bogota", logError: vi.fn() });
    vi.mocked(plannerService.getTodaySchedule)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          localDate: "2026-09-17",
          tasks: [{ title: "Escribir minuta", priority: "MEDIUM", status: "PENDING", dueTime: null }],
          events: [],
          reminders: []
        }
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          localDate: "2026-09-17",
          tasks: [],
          events: [{ title: "Llamada", startAt: "2026-09-17T16:00:00.000Z" }],
          reminders: []
        }
      } as never);

    const proposal = { actionId: "11111111-1111-4111-8111-111111111111", action: "GET_TODAY_SCHEDULE" as const, input: {} };
    const taskOnly = await executor.execute(proposal, getActionPolicy("GET_TODAY_SCHEDULE"));
    const eventOnly = await executor.execute(proposal, getActionPolicy("GET_TODAY_SCHEDULE"));

    expect(taskOnly.userSummary).toBe("Hoy tienes una cosa: la tarea Escribir minuta.");
    expect(taskOnly.userSummary).not.toContain("recordatorio");
    expect(eventOnly.userSummary).toBe("Hoy tienes una cosa: a las 11 de la mañana, Llamada.");
    expect(eventOnly.userSummary).not.toContain("la tarea");
  });
});
