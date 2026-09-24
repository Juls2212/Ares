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
import type { FileOrganizationPlan } from "../src/shared/file-contracts";

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
  riskLevel: ["UPDATE_TASK", "COMPLETE_TASK", "UPDATE_EVENT", "CREATE_FOLDER", "RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "ORGANIZE_FILES"].includes(proposal.action) ? 2 : 1,
  status: "SUCCEEDED",
  ...(proposal.action === "OPEN_APPLICATION"
    ? { data: { applicationName: "Microsoft Word" } }
    : proposal.action === "OPEN_WEB_PAGE"
      ? { data: { applicationName: "Google Chrome", destination: "YOUTUBE" as const } }
    : {}),
  userSummary:
    proposal.action === "OPEN_APPLICATION"
      ? "Se abrió Microsoft Word."
      : proposal.action === "OPEN_WEB_PAGE"
        ? "Se abrió YouTube en Google Chrome."
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
  it("executes SEARCH_FILES as a Level 1 action and records only safe aggregate metadata", async () => {
    const executor: ActionExecutor = {
      execute: vi.fn(async (proposal: ExecutableActionProposal): Promise<ActionOutcome> => ({
        actionId: proposal.actionId,
        action: proposal.action,
        riskLevel: 1,
        status: "SUCCEEDED",
        data: {
          items: [
            {
              rootId: "DOCUMENTS",
              relativePath: "Private\\Report.txt",
              name: "Report.txt",
              entryType: "FILE",
              extension: "txt",
              size: 1,
              lastModified: "2026-09-17T10:00:00.000Z"
            }
          ],
          total: 1,
          truncated: false,
          skippedEntryCount: 2
        },
        userSummary: "Se completó la búsqueda de archivos autorizados."
      }))
    };
    const { orchestrator, historyService } = createOrchestrator(executor);

    const result = await orchestrator.propose({
      action: "SEARCH_FILES",
      input: { rootId: "DOCUMENTS", query: "report" }
    });

    expect(result).toMatchObject({ ok: true, data: { status: "SUCCEEDED", action: "SEARCH_FILES" } });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SEARCH_FILES",
        riskLevel: 1,
        status: "SUCCEEDED",
        metadata: {
          scopeKind: "FILES",
          resultKind: "SUCCEEDED",
          itemCount: 1,
          skippedCount: 2,
          partial: false
        }
      })
    );
    expect(JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls)).not.toContain(
      "Private\\Report.txt"
    );
  });

  it("does not execute a Level 2 file mutation before its exact confirmation", async () => {
    const { orchestrator, executor } = createOrchestrator();

    const proposed = await orchestrator.propose({
      action: "RENAME_FILE",
      input: { source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" }, newName: "Summary.txt" }
    });

    expect(proposed).toMatchObject({
      ok: true,
      data: {
        lifecycleState: "AWAITING_CONFIRMATION",
        confirmationId: identifiers[1],
        action: "RENAME_FILE",
        riskLevel: 2
      }
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("stores a Main-generated organization plan and executes it only after one confirmation", async () => {
    const organizationPlan: FileOrganizationPlan = {
      rootId: "DOCUMENTS",
      folder: { rootId: "DOCUMENTS", relativePath: "Inbox" },
      items: [],
      plannedCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      categoryCounts: { DOCUMENTS: 0, IMAGES: 0, AUDIO: 0, VIDEOS: 0, ARCHIVES: 0, OTHER: 0 },
      skipped: [],
      mixedContent: false,
      empty: true
    };
    const executor = createExecutor();
    executor.prepareOrganization = vi.fn(async () => ({ ok: true as const, data: organizationPlan }));
    const { orchestrator } = createOrchestrator(executor);

    const proposed = await orchestrator.propose({
      action: "ORGANIZE_FILES",
      input: { folder: { rootId: "DOCUMENTS", relativePath: "Inbox" } }
    });
    expect(proposed).toMatchObject({
      ok: true,
      data: { lifecycleState: "AWAITING_CONFIRMATION", action: "ORGANIZE_FILES", preview: organizationPlan }
    });
    expect(executor.execute).not.toHaveBeenCalled();
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected confirmation.");

    await Promise.all([orchestrator.confirm(proposed.data.confirmationId), orchestrator.confirm(proposed.data.confirmationId)]);
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ORGANIZE_FILES", plan: organizationPlan }),
      getActionPolicy("ORGANIZE_FILES")
    );
  });

  it("cancels and expires organization previews without executing stored plans", async () => {
    const organizationPlan: FileOrganizationPlan = {
      rootId: "DOCUMENTS",
      folder: { rootId: "DOCUMENTS", relativePath: "Inbox" },
      items: [],
      plannedCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      categoryCounts: { DOCUMENTS: 0, IMAGES: 0, AUDIO: 0, VIDEOS: 0, ARCHIVES: 0, OTHER: 0 },
      skipped: [],
      mixedContent: false,
      empty: true
    };
    const executor = createExecutor();
    executor.prepareOrganization = vi.fn(async () => ({ ok: true as const, data: organizationPlan }));
    const historyService = createHistoryService();
    let currentTime = new Date("2026-09-17T10:00:00.000Z");
    const generateIdentifier = vi.fn();
    identifiers.forEach((identifier) => generateIdentifier.mockReturnValueOnce(identifier));
    const orchestrator = createActionOrchestrator({
      executor,
      historyService,
      generateIdentifier,
      now: () => currentTime,
      logError: vi.fn()
    });
    const input = { action: "ORGANIZE_FILES" as const, input: { folder: { rootId: "DOCUMENTS" as const, relativePath: "Inbox" } } };

    const cancelled = await orchestrator.propose(input);
    if (!cancelled.ok || !("confirmationId" in cancelled.data)) throw new Error("Expected confirmation.");
    await orchestrator.cancel(cancelled.data.confirmationId);

    const expired = await orchestrator.propose(input);
    if (!expired.ok || !("confirmationId" in expired.data)) throw new Error("Expected confirmation.");
    currentTime = new Date("2026-09-17T10:05:00.000Z");
    await expect(orchestrator.confirm(expired.data.confirmationId)).resolves.toMatchObject({
      ok: false,
      error: { code: "ACTION_CONFIRMATION_UNAVAILABLE" }
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("executes a confirmed file move once and rejects concurrent replay", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();
    const proposed = await orchestrator.propose({
      action: "MOVE_FILE",
      input: {
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" }
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

  it("cancels a pending file mutation without execution and records the cancellation", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();
    const proposed = await orchestrator.propose({
      action: "CREATE_FOLDER",
      input: { parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" }, name: "Archive" }
    });
    if (!proposed.ok || !("confirmationId" in proposed.data)) {
      throw new Error("Expected an awaiting confirmation result.");
    }

    const result = await orchestrator.cancel(proposed.data.confirmationId);

    expect(result).toMatchObject({ ok: true, data: { status: "CANCELLED" } });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE_FOLDER", status: "CANCELLED", metadata: { scopeKind: "FILES", resultKind: "CANCELLED" } })
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
      action: "RENAME_FOLDER",
      input: { source: { rootId: "DOCUMENTS", relativePath: "Work\\Archive" }, newName: "Archive 2026" }
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
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RENAME_FOLDER",
        riskLevel: 2,
        status: "CANCELLED",
        metadata: { scopeKind: "FILES", resultKind: "CANCELLED" }
      })
    );
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

  it("executes the Level 1 fixed web-page proposal and records no URL, alias, or launch details", async () => {
    const { orchestrator, executor, historyService } = createOrchestrator();

    const result = await orchestrator.propose({
      action: "OPEN_WEB_PAGE",
      input: { destination: "YOUTUBE", browser: "CHROME" }
    });

    expect(result).toMatchObject({ ok: true, data: { status: "SUCCEEDED", action: "OPEN_WEB_PAGE", riskLevel: 1 } });
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: "OPEN_WEB_PAGE", input: { destination: "YOUTUBE", browser: "CHROME" } }),
      getActionPolicy("OPEN_WEB_PAGE")
    );
    expect(historyService.recordTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "OPEN_WEB_PAGE",
        metadata: {
          scopeKind: "APPLICATION",
          resultKind: "SUCCEEDED",
          applicationDisplayName: "Google Chrome"
        }
      })
    );
    const historyInput = JSON.stringify(vi.mocked(historyService.recordTerminal).mock.calls);
    expect(historyInput).not.toContain("http");
    expect(historyInput).not.toContain("chrome");
  });

  it("rejects malformed and unavailable proposals without execution", async () => {
    const { orchestrator, executor } = createOrchestrator();

    await expect(orchestrator.propose({ action: "ORGANIZE_FILES" })).resolves.toEqual({
      ok: false,
      error: { code: "ACTION_PROPOSAL_INVALID", userMessage: "La propuesta de acción no es válida." }
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
