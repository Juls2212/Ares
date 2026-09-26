import { describe, expect, it, vi } from "vitest";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createTaskDeletionService } from "../src/main/planner/task-deletion-service";
import type { PlannerService } from "../src/main/planner/planner-service";

const taskId = "550e8400-e29b-41d4-a716-446655440000";
const otherTaskId = "550e8400-e29b-41d4-a716-446655440001";

const createFixture = (clock: () => Date = () => new Date("2026-09-17T10:00:00.000Z")) => {
  const plannerService = { deleteTask: vi.fn(async () => ({ ok: true as const, data: { deleted: true as const } })) };
  const historyService = {
    recordTerminal: vi.fn(async () => ({ ok: true as const, data: {} })),
    list: vi.fn()
  } as unknown as ActionHistoryService;
  const plannerExecutor = createPlannerActionExecutor({ plannerService: plannerService as unknown as PlannerService, logError: vi.fn() });
  const generateIdentifier = vi.fn()
    .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
    .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
  const orchestrator = createActionOrchestrator({
    executor: { execute: (proposal, policy) => {
      if (proposal.action !== "DELETE_TASK") throw new Error("Unexpected action in task deletion test.");
      return plannerExecutor.execute(proposal, policy);
    } },
    historyService,
    generateIdentifier,
    now: clock,
    logError: vi.fn()
  });
  return { service: createTaskDeletionService({ getOrchestrator: () => orchestrator, logError: vi.fn() }), plannerService };
};

describe("Main-backed task deletion", () => {
  it("rejects unknown and expired confirmations without calling the planner", async () => {
    let now = new Date("2026-09-17T10:00:00Z");
    const { service, plannerService } = createFixture(() => now);
    expect(await service.confirm({ taskId, confirmationId: "33333333-3333-4333-8333-333333333333" })).toMatchObject({ ok: false });
    const request = await service.request({ taskId });
    if (!request.ok) throw new Error("Expected pending confirmation.");
    now = new Date("2026-09-17T10:05:00Z");
    expect(await service.confirm({ taskId, confirmationId: request.data.confirmationId })).toMatchObject({ ok: false });
    expect(plannerService.deleteTask).not.toHaveBeenCalled();
  });

  it("consumes concurrent confirmations exactly once", async () => {
    const { service, plannerService } = createFixture();
    const request = await service.request({ taskId });
    if (!request.ok) throw new Error("Expected pending confirmation.");
    const decisions = await Promise.all([service.confirm({ taskId, confirmationId: request.data.confirmationId }), service.confirm({ taskId, confirmationId: request.data.confirmationId })]);
    expect(decisions.filter((result) => result.ok)).toHaveLength(1);
    expect(plannerService.deleteTask).toHaveBeenCalledOnce();
  });
  it("validates UUIDs and rejects unsupported fields before issuing confirmation", async () => {
    const { service, plannerService } = createFixture();
    expect(await service.request({ taskId: "not-a-uuid" })).toMatchObject({ ok: false, error: { code: "PLANNER_IDENTIFIER_INVALID" } });
    expect(await service.request({ taskId, extra: true })).toMatchObject({ ok: false, error: { code: "PLANNER_UNKNOWN_FIELD" } });
    expect(await service.confirm({ taskId, confirmationId: "token", extra: true })).toMatchObject({ ok: false });
    expect(plannerService.deleteTask).not.toHaveBeenCalled();
  });

  it("deletes exactly once only after a matching reinforced confirmation", async () => {
    const { service, plannerService } = createFixture();
    const requested = await service.request({ taskId });
    if (!requested.ok) throw new Error("Expected deletion request.");
    const confirmationId = requested.data.confirmationId;
    expect(plannerService.deleteTask).not.toHaveBeenCalled();
    expect(await service.confirm({ taskId: otherTaskId, confirmationId })).toMatchObject({ ok: false });
    expect(plannerService.deleteTask).not.toHaveBeenCalled();
    expect(await service.confirm({ taskId, confirmationId })).toEqual({ ok: true, data: { deleted: true } });
    expect(plannerService.deleteTask).toHaveBeenCalledTimes(1);
    expect(plannerService.deleteTask).toHaveBeenCalledWith({ taskId });
    expect(await service.confirm({ taskId, confirmationId })).toMatchObject({ ok: false });
    expect(plannerService.deleteTask).toHaveBeenCalledTimes(1);
  });

  it("cancellation invalidates the pending confirmation without deletion", async () => {
    const { service, plannerService } = createFixture();
    const requested = await service.request({ taskId });
    if (!requested.ok) throw new Error("Expected deletion request.");
    expect(await service.cancel({ taskId, confirmationId: requested.data.confirmationId })).toEqual({
      ok: true, data: { cancelled: true }
    });
    expect(await service.confirm({ taskId, confirmationId: requested.data.confirmationId })).toMatchObject({ ok: false });
    expect(plannerService.deleteTask).not.toHaveBeenCalled();
  });

  it("preserves controlled not-found handling without exposing repository details", async () => {
    const { service, plannerService } = createFixture();
    plannerService.deleteTask.mockResolvedValueOnce({
      ok: false,
      error: { code: "PLANNER_NOT_FOUND", userMessage: "raw database detail" }
    } as never);
    const requested = await service.request({ taskId });
    if (!requested.ok) throw new Error("Expected deletion request.");
    const result = await service.confirm({ taskId, confirmationId: requested.data.confirmationId });
    expect(result).toEqual({
      ok: false,
      error: { code: "PLANNER_NOT_FOUND", userMessage: "La tarea ya no está disponible." }
    });
    expect(JSON.stringify(result)).not.toContain("raw database detail");
  });
});
