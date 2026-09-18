import { describe, expect, it, vi } from "vitest";
import type { ActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import type {
  ActionHistoryRecord,
  ActionOperationResult,
  ActionOutcome,
  ExecutableActionProposal,
  PlannerActionProposal
} from "../src/shared/action-contracts";

const identifiers = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444"
];

const historyRecord: ActionHistoryRecord = {
  id: "55555555-5555-4555-8555-555555555555",
  actionId: identifiers[0],
  action: "CREATE_TASK",
  riskLevel: 1,
  status: "SUCCEEDED",
  userSummary: "Se creó la tarea.",
  errorCode: null,
  metadata: { scopeKind: "PLANNER", resultKind: "SUCCEEDED" },
  startedAt: "2026-09-17T10:00:00.000Z",
  finishedAt: "2026-09-17T10:00:01.000Z",
  createdAt: "2026-09-17T10:00:01.000Z"
};

const createSuccessOutcome = (proposal: ExecutableActionProposal): ActionOutcome => ({
  actionId: proposal.actionId,
  action: proposal.action,
  riskLevel: proposal.action === "UPDATE_TASK" || proposal.action === "COMPLETE_TASK" || proposal.action === "UPDATE_EVENT" ? 2 : 1,
  status: "SUCCEEDED",
  ...(proposal.action === "OPEN_APPLICATION"
    ? { data: { applicationName: "Microsoft Word" } }
    : {}),
  userSummary:
    proposal.action === "OPEN_APPLICATION"
      ? "Se abrió Microsoft Word."
      : "La acción del planificador se completó."
});

const createExecutor = (): ActionExecutor => ({
  execute: vi.fn(async (proposal: ExecutableActionProposal) => createSuccessOutcome(proposal))
});

const createHistoryService = (): ActionHistoryService => ({
  recordTerminal: vi.fn(async (): Promise<ActionOperationResult<ActionHistoryRecord>> => ({
    ok: true,
    data: historyRecord
  })),
  list: vi.fn(async (): Promise<ActionOperationResult<{ items: ActionHistoryRecord[]; total: number }>> => ({
    ok: true,
    data: { items: [], total: 0 }
  }))
});

const createOrchestrator = (
  executor = createExecutor(),
  historyService = createHistoryService()
) => {
  const generateIdentifier = vi.fn();
  identifiers.forEach((identifier) => generateIdentifier.mockReturnValueOnce(identifier));
  return {
    executor,
    historyService,
    orchestrator: createActionOrchestrator({
      executor,
      historyService,
      generateIdentifier,
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      logError: vi.fn()
    })
  };
};

describe("action orchestrator", () => {
  it("executes a Level 1 planner action directly and records its terminal result", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();

    const result = await orchestrator.propose({ action: "CREATE_TASK", input: { title: "Informe" } });

    expect(result).toMatchObject({ ok: true, data: { status: "SUCCEEDED", action: "CREATE_TASK" } });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE_TASK",
        riskLevel: 1,
        status: "SUCCEEDED",
        metadata: { scopeKind: "PLANNER", resultKind: "SUCCEEDED" }
      })
    );
  });

  it("does not execute a Level 2 planner action before its exact confirmation", async () => {
    const { orchestrator, executor } = createOrchestrator();

    const proposed = await orchestrator.propose({
      action: "UPDATE_TASK",
      input: { taskId: "550e8400-e29b-41d4-a716-446655440000", title: "Informe final" }
    });

    expect(proposed).toMatchObject({
      ok: true,
      data: {
        lifecycleState: "AWAITING_CONFIRMATION",
        confirmationId: identifiers[1],
        action: "UPDATE_TASK",
        riskLevel: 2
      }
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("executes a confirmed proposal once and rejects concurrent replay", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();
    const proposed = await orchestrator.propose({
      action: "COMPLETE_TASK",
      input: {
        taskId: "550e8400-e29b-41d4-a716-446655440000",
        completedAt: "2026-09-17T10:00:00.000Z"
      }
    });
    if (!proposed.ok || !("confirmationId" in proposed.data)) {
      throw new Error("Expected an awaiting confirmation result.");
    }

    const [first, second] = await Promise.all([
      orchestrator.confirm(proposed.data.confirmationId),
      orchestrator.confirm(proposed.data.confirmationId)
    ]);

    expect(first).toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(second).toEqual({
      ok: false,
      error: {
        code: "ACTION_CONFIRMATION_UNAVAILABLE",
        userMessage: "La confirmación ya no está disponible."
      }
    });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(historyService.recordTerminal).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending proposal without execution and records the cancellation", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();
    const proposed = await orchestrator.propose({
      action: "UPDATE_EVENT",
      input: { eventId: "550e8400-e29b-41d4-a716-446655440000", title: "Reunión" }
    });
    if (!proposed.ok || !("confirmationId" in proposed.data)) {
      throw new Error("Expected an awaiting confirmation result.");
    }

    const result = await orchestrator.cancel(proposed.data.confirmationId);

    expect(result).toMatchObject({ ok: true, data: { status: "CANCELLED" } });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE_EVENT", status: "CANCELLED" })
    );
  });

  it("expires a pending confirmation exactly five minutes after proposal creation", async () => {
    const executor = createExecutor();
    const historyService = createHistoryService();
    const generateIdentifier = vi.fn();
    identifiers.forEach((identifier) => generateIdentifier.mockReturnValueOnce(identifier));
    let currentTime = new Date("2026-09-17T10:00:00.000Z");
    const orchestrator = createActionOrchestrator({
      executor,
      historyService,
      generateIdentifier,
      now: () => currentTime,
      logError: vi.fn()
    });

    const proposed = await orchestrator.propose({
      action: "UPDATE_TASK",
      input: { taskId: "550e8400-e29b-41d4-a716-446655440000", title: "Informe final" }
    });
    if (!proposed.ok || !("confirmationId" in proposed.data)) {
      throw new Error("Expected an awaiting confirmation result.");
    }

    currentTime = new Date("2026-09-17T10:05:00.000Z");
    const result = await orchestrator.confirm(proposed.data.confirmationId);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ACTION_CONFIRMATION_UNAVAILABLE",
        userMessage: "La confirmación ya no está disponible."
      }
    });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(historyService.recordTerminal).not.toHaveBeenCalled();
  });

  it("executes an alias-only OPEN_APPLICATION proposal and records only safe application metadata", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();

    const result = await orchestrator.propose({
      action: "OPEN_APPLICATION",
      input: { alias: "word-alias" }
    });

    expect(result).toMatchObject({ ok: true, data: { status: "SUCCEEDED", action: "OPEN_APPLICATION" } });
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: "OPEN_APPLICATION", input: { alias: "word-alias" } }),
      getActionPolicy("OPEN_APPLICATION")
    );
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          scopeKind: "APPLICATION",
          resultKind: "SUCCEEDED",
          applicationDisplayName: "Microsoft Word"
        }
      })
    );
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toContain(
      "word-alias"
    );
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toContain("C:\\");
  });

  it("rejects deferred, malformed, and unavailable proposals without execution", async () => {
    const { orchestrator, executor } = createOrchestrator();

    await expect(orchestrator.propose({ action: "CREATE_FOLDER" })).resolves.toEqual({
      ok: false,
      error: { code: "ACTION_DEFERRED", userMessage: "Esta acción todavía no está disponible." }
    });
    await expect(
      orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "Word", executablePath: "C:\\unsafe.exe" } })
    ).resolves.toEqual({
      ok: false,
      error: { code: "ACTION_PROPOSAL_INVALID", userMessage: "La propuesta de acción no es válida." }
    });
    await expect(
      orchestrator.propose({ action: "CREATE_TASK", actionId: identifiers[0], input: { title: "Informe" } })
    ).resolves.toEqual({
      ok: false,
      error: { code: "ACTION_PROPOSAL_INVALID", userMessage: "La propuesta de acción no es válida." }
    });
    await expect(orchestrator.confirm("not-an-opaque-id")).resolves.toEqual({
      ok: false,
      error: { code: "ACTION_CONFIRMATION_INVALID", userMessage: "La confirmación de la acción no es válida." }
    });
    await expect(orchestrator.confirm(identifiers[0])).resolves.toEqual({
      ok: false,
      error: { code: "ACTION_CONFIRMATION_UNAVAILABLE", userMessage: "La confirmación ya no está disponible." }
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("records controlled planner failures without exposing raw technical details", async () => {
    const executor: ActionExecutor = {
      execute: vi.fn(async (proposal: ExecutableActionProposal): Promise<ActionOutcome> => ({
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: 1,
        status: "VALIDATION_FAILED",
        errorCode: "PLANNER_TEXT_INVALID",
        userSummary: "La información del planificador no es válida."
      }))
    };
    const { orchestrator, historyService } = createOrchestrator(executor);

    const result = await orchestrator.propose({ action: "CREATE_TASK", input: { title: "  " } });

    expect(result).toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "PLANNER_TEXT_INVALID" }
    });
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ status: "VALIDATION_FAILED", errorCode: "PLANNER_TEXT_INVALID" })
    );
  });

  it("maps unexpected executor errors and avoids raw sensitive values", async () => {
    const password = "do-not-expose-this-password";
    const executor: ActionExecutor = {
      execute: vi.fn(async (): Promise<ActionOutcome> => {
        throw new Error(`database failure for ${password}`);
      })
    };
    const { orchestrator, historyService } = createOrchestrator(executor);

    const result = await orchestrator.propose({ action: "CREATE_TASK", input: { title: "Informe" } });

    expect(result).toEqual({
      ok: true,
      data: {
        actionId: identifiers[0],
        action: "CREATE_TASK",
        riskLevel: 1,
        status: "EXECUTION_FAILED",
        errorCode: "ACTION_EXECUTION_UNAVAILABLE",
        userSummary: "No se pudo completar la acción solicitada."
      }
    });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toContain(password);
  });

  it("does not re-execute a successful action when history persistence fails", async () => {
    const executor = createExecutor();
    const historyService: ActionHistoryService = {
      recordTerminal: vi.fn(async (): Promise<ActionOperationResult<ActionHistoryRecord>> => ({
        ok: false,
        error: { code: "ACTION_HISTORY_UNAVAILABLE", userMessage: "No se pudo acceder al historial de acciones." }
      })),
      list: vi.fn(async (): Promise<ActionOperationResult<{ items: ActionHistoryRecord[]; total: number }>> => ({
        ok: true,
        data: { items: [], total: 0 }
      }))
    };
    const { orchestrator } = createOrchestrator(executor, historyService);

    const result = await orchestrator.propose({ action: "CREATE_TASK", input: { title: "Informe" } });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "SUCCEEDED",
        errorCode: "ACTION_HISTORY_NOT_RECORDED",
        userSummary: "La acción se completó, pero no se pudo registrar en el historial."
      }
    });
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
});
