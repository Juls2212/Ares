import { describe, expect, it, vi } from "vitest";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createEventDeletionService } from "../src/main/planner/event-deletion-service";
import type { PlannerService } from "../src/main/planner/planner-service";

const eventId = "550e8400-e29b-41d4-a716-446655440000";
const otherEventId = "550e8400-e29b-41d4-a716-446655440001";

const createFixture = () => {
  const plannerService = { deleteEvent: vi.fn(async () => ({ ok: true as const, data: { deleted: true as const } })) };
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
      if (proposal.action !== "DELETE_EVENT") throw new Error("Unexpected action in event deletion test.");
      return plannerExecutor.execute(proposal, policy);
    } },
    historyService,
    generateIdentifier,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: vi.fn()
  });
  return { service: createEventDeletionService({ getOrchestrator: () => orchestrator, logError: vi.fn() }), plannerService };
};

describe("Main-backed event deletion", () => {
  it("validates UUIDs and rejects unsupported fields before issuing confirmation", async () => {
    const { service, plannerService } = createFixture();
    expect(await service.request({ eventId: "not-a-uuid" })).toMatchObject({ ok: false, error: { code: "PLANNER_IDENTIFIER_INVALID" } });
    expect(await service.request({ eventId, extra: true })).toMatchObject({ ok: false, error: { code: "PLANNER_UNKNOWN_FIELD" } });
    expect(await service.confirm({ eventId, confirmationId: "token", extra: true })).toMatchObject({ ok: false });
    expect(plannerService.deleteEvent).not.toHaveBeenCalled();
  });

  it("deletes exactly once only after a matching reinforced confirmation", async () => {
    const { service, plannerService } = createFixture();
    const requested = await service.request({ eventId });
    if (!requested.ok) throw new Error("Expected deletion request.");
    const confirmationId = requested.data.confirmationId;
    expect(plannerService.deleteEvent).not.toHaveBeenCalled();
    expect(await service.confirm({ eventId: otherEventId, confirmationId })).toMatchObject({ ok: false });
    expect(plannerService.deleteEvent).not.toHaveBeenCalled();
    expect(await service.confirm({ eventId, confirmationId })).toEqual({ ok: true, data: { deleted: true } });
    expect(plannerService.deleteEvent).toHaveBeenCalledTimes(1);
    expect(plannerService.deleteEvent).toHaveBeenCalledWith({ eventId });
    expect(await service.confirm({ eventId, confirmationId })).toMatchObject({ ok: false });
    expect(plannerService.deleteEvent).toHaveBeenCalledTimes(1);
  });

  it("cancellation invalidates the pending confirmation without deletion", async () => {
    const { service, plannerService } = createFixture();
    const requested = await service.request({ eventId });
    if (!requested.ok) throw new Error("Expected deletion request.");
    expect(await service.cancel({ eventId, confirmationId: requested.data.confirmationId })).toEqual({
      ok: true, data: { cancelled: true }
    });
    expect(await service.confirm({ eventId, confirmationId: requested.data.confirmationId })).toMatchObject({ ok: false });
    expect(plannerService.deleteEvent).not.toHaveBeenCalled();
  });

  it("preserves controlled not-found handling without exposing repository details", async () => {
    const { service, plannerService } = createFixture();
    plannerService.deleteEvent.mockResolvedValueOnce({
      ok: false,
      error: { code: "PLANNER_NOT_FOUND", userMessage: "raw database detail" }
    } as never);
    const requested = await service.request({ eventId });
    if (!requested.ok) throw new Error("Expected deletion request.");
    const result = await service.confirm({ eventId, confirmationId: requested.data.confirmationId });
    expect(result).toEqual({
      ok: false,
      error: { code: "PLANNER_NOT_FOUND", userMessage: "El evento ya no está disponible." }
    });
    expect(JSON.stringify(result)).not.toContain("raw database detail");
  });
});
