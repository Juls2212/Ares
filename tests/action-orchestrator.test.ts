import { describe, expect, it, vi } from "vitest";

import type { ActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import type {
  ActionHistoryRecord,
  ActionOperationResult,
  ActionOutcome,
  ExecutableActionProposal
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
  riskLevel: getActionPolicy(proposal.action).riskLevel,
  status: "SUCCEEDED",
  ...(proposal.action === "OPEN_APPLICATION" ? { data: { applicationName: "Google Chrome" } } : {}),
  userSummary: proposal.action === "OPEN_APPLICATION" ? "Se abrió Google Chrome." : "La acción se completó."
});

const createExecutor = (): ActionExecutor => ({
  execute: vi.fn(async (proposal: ExecutableActionProposal) => createSuccessOutcome(proposal))
});

const createHistoryService = (): ActionHistoryService => ({
  recordTerminal: vi.fn(async (): Promise<ActionOperationResult<ActionHistoryRecord>> => ({ ok: true, data: historyRecord })),
  list: vi.fn(async (): Promise<ActionOperationResult<{ items: ActionHistoryRecord[]; total: number }>> => ({ ok: true, data: { items: [], total: 0 } }))
});

const createOrchestrator = (executor = createExecutor(), historyService = createHistoryService()) => {
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
  it("executes enabled direct internal-memory actions through the existing executor", async () => {
    const { orchestrator, executor } = createOrchestrator();

    await expect(orchestrator.propose({ action: "CREATE_TASK", input: { title: "Informe" } })).resolves.toMatchObject({
      ok: true,
      data: { action: "CREATE_TASK", status: "SUCCEEDED", riskLevel: 1 }
    });
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("holds enabled weekly schedule and habit mutations until one standard confirmation", async () => {
    const { orchestrator, executor } = createOrchestrator();
    const routine = await orchestrator.propose({
      action: "CREATE_WEEKLY_ROUTINE",
      input: { scheduleTitle: "Universidad", title: "Cálculo", weekday: "MONDAY", startTime: "08:00", endTime: "10:00" }
    });
    expect(routine).toMatchObject({ ok: true, data: { lifecycleState: "AWAITING_CONFIRMATION", riskLevel: 2 } });
    if (!routine.ok || !("confirmationId" in routine.data)) throw new Error("Expected confirmation.");
    expect(executor.execute).not.toHaveBeenCalled();
    await expect(orchestrator.confirm(routine.data.confirmationId)).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    await expect(orchestrator.confirm(routine.data.confirmationId)).resolves.toMatchObject({ ok: false });

    const habit = await orchestrator.propose({ action: "COMPLETE_HABIT", input: { habitTitle: "Leer" } });
    expect(habit).toMatchObject({ ok: true, data: { action: "COMPLETE_HABIT", lifecycleState: "AWAITING_CONFIRMATION" } });
  });

  it("preflights catalog registration and holds the verified proposal until confirmation", async () => {
    const executor = createExecutor();
    executor.prepareCatalogRegistration = vi.fn(async () => ({
      ok: true as const,
      data: { catalogKey: "SPOTIFY" as const, alias: "spotify", applicationName: "Spotify" }
    }));
    const { orchestrator } = createOrchestrator(executor);

    const proposed = await orchestrator.propose({ action: "REGISTER_CATALOG_APPLICATION", input: { catalogKey: "SPOTIFY" } });
    expect(proposed).toMatchObject({
      ok: true,
      data: {
        lifecycleState: "AWAITING_CONFIRMATION",
        action: "REGISTER_CATALOG_APPLICATION",
        confirmation: { summary: "Se registrará Spotify como “spotify”." }
      }
    });
    expect(executor.execute).not.toHaveBeenCalled();
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected confirmation.");
    await expect(orchestrator.confirm(proposed.data.confirmationId)).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      action: "REGISTER_CATALOG_APPLICATION",
      input: { catalogKey: "SPOTIFY", alias: "spotify" }
    }), expect.anything());
  });

  it("reports a failed catalog preparation with its own message, never as not-found, and opens no confirmation", async () => {
    const executor = createExecutor();
    executor.prepareCatalogRegistration = vi.fn(async () => { throw new Error("private failure at C:\\secret"); });
    const { orchestrator, historyService } = createOrchestrator(executor);

    const proposed = await orchestrator.propose({ action: "REGISTER_CATALOG_APPLICATION", input: { catalogKey: "SPOTIFY" } });
    expect(proposed).toMatchObject({
      ok: true,
      data: {
        status: "VALIDATION_FAILED",
        errorCode: "APPLICATION_CATALOG_PREPARATION_FAILED",
        userSummary: "No pude preparar el registro de la aplicación."
      }
    });
    expect("lifecycleState" in (proposed.ok ? proposed.data : {})).toBe(false);
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toMatch(/private|C:\\|No encontré/);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("preserves reinforced event-deletion binding and replay protection", async () => {
    const { orchestrator, executor } = createOrchestrator();
    const eventId = "550e8400-e29b-41d4-a716-446655440000";
    const proposal = await orchestrator.propose({ action: "DELETE_EVENT", input: { eventId } });
    expect(proposal).toMatchObject({ ok: true, data: { lifecycleState: "AWAITING_CONFIRMATION", riskLevel: 3 } });
    if (!proposal.ok || !("confirmationId" in proposal.data)) throw new Error("Expected confirmation.");
    expect(await orchestrator.confirmEventDeletion("550e8400-e29b-41d4-a716-446655440001", proposal.data.confirmationId)).toMatchObject({ ok: false });
    expect(await orchestrator.confirmEventDeletion(eventId, proposal.data.confirmationId)).toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(await orchestrator.confirmEventDeletion(eventId, proposal.data.confirmationId)).toMatchObject({ ok: false });
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("uses the existing alias-only application proposal and records safe resolved metadata", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();
    const result = await orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "chrome" } });

    expect(result).toMatchObject({ ok: true, data: { action: "OPEN_APPLICATION", status: "SUCCEEDED" } });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ input: { alias: "chrome" } }), getActionPolicy("OPEN_APPLICATION"));
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toContain("chrome");
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toContain("C:\\");
  });

  it("executes approved web page and search proposals directly without confirmation or query history", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();

    await expect(orchestrator.propose({ action: "OPEN_APPROVED_PAGE", input: { site: "YOUTUBE" } })).resolves.toMatchObject({
      ok: true,
      data: { action: "OPEN_APPROVED_PAGE", status: "SUCCEEDED", riskLevel: 1 }
    });
    await expect(orchestrator.propose({ action: "SEARCH_APPROVED_SITE", input: { site: "SPOTIFY", query: "Natalia Lafourcade" } })).resolves.toMatchObject({
      ok: true,
      data: { action: "SEARCH_APPROVED_SITE", status: "SUCCEEDED", riskLevel: 1 }
    });
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toContain("Natalia Lafourcade");
  });

  it("rejects disabled future web and file proposals before an executor receives them", async () => {
    const { orchestrator, executor } = createOrchestrator();

    await expect(orchestrator.propose({ action: "OPEN_WEB_PAGE", input: { destination: "YOUTUBE", browser: "CHROME" } })).resolves.toMatchObject({
      ok: false,
      error: { code: "ACTION_UNSUPPORTED" }
    });
    await expect(orchestrator.propose({ action: "RENAME_FILE", input: { source: { rootId: "DOCUMENTS", relativePath: "a" }, newName: "b" } })).resolves.toMatchObject({
      ok: false,
      error: { code: "ACTION_UNSUPPORTED" }
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("rejects malformed registered-application input and unknown confirmations", async () => {
    const { orchestrator, executor } = createOrchestrator();
    await expect(orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "chrome", executablePath: "C:\\unsafe.exe" } })).resolves.toMatchObject({
      ok: false,
      error: { code: "ACTION_PROPOSAL_INVALID" }
    });
    await expect(orchestrator.confirm("not-an-opaque-id")).resolves.toMatchObject({ ok: false, error: { code: "ACTION_CONFIRMATION_INVALID" } });
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
