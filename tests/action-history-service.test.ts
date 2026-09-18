import { describe, expect, it, vi } from "vitest";
import {
  ActionHistoryRepositoryError,
  type ActionHistoryRepository
} from "../src/main/actions/action-history-repository";
import {
  createActionHistoryService,
  sanitizeActionHistoryMetadata
} from "../src/main/actions/action-history-service";
import type { ActionHistoryRecord } from "../src/shared/action-contracts";

const historyRecord: ActionHistoryRecord = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  actionId: "action-1",
  action: "CREATE_TASK",
  riskLevel: 1,
  status: "SUCCEEDED",
  userSummary: "Se creó una tarea.",
  errorCode: null,
  metadata: { itemCount: 1, scopeKind: "PLANNER" },
  startedAt: "2026-09-17T10:00:00.000Z",
  finishedAt: "2026-09-17T10:00:01.000Z",
  createdAt: "2026-09-17T10:00:01.000Z"
};

const createRepository = (): ActionHistoryRepository => ({
  record: vi.fn().mockResolvedValue(historyRecord),
  list: vi.fn().mockResolvedValue([historyRecord])
});

const validInput = {
  action: "CREATE_TASK",
  riskLevel: 1,
  status: "SUCCEEDED",
  userSummary: "  Se creó una tarea.  ",
  startedAt: "2026-09-17T10:00:00.000Z",
  finishedAt: "2026-09-17T10:00:01.000Z"
};

describe("action history service", () => {
  it("records only terminal entries and sanitizes metadata before persistence", async () => {
    const repository = createRepository();
    const service = createActionHistoryService({
      repository,
      generateActionId: () => "generated-action-id",
      logError: () => undefined
    });

    const result = await service.recordTerminal({
      ...validInput,
      metadata: {
        itemCount: 1,
        partial: false,
        scopeKind: "PLANNER",
        databaseUrl: "postgresql://user:password@127.0.0.1/private",
        sourcePath: "C:\\private\\document.txt",
        prompt: "raw model prompt",
        command: "Remove-Item C:\\private"
      }
    });

    expect(result).toEqual({ ok: true, data: historyRecord });
    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "generated-action-id",
        userSummary: "Se creó una tarea.",
        metadata: { itemCount: 1, partial: false, scopeKind: "PLANNER" }
      })
    );
    expect(JSON.stringify(vi.mocked(repository.record).mock.calls)).not.toContain("password");
    expect(JSON.stringify(vi.mocked(repository.record).mock.calls)).not.toContain("Remove-Item");
  });

  it("rejects invalid lifecycle values and unexpected fields", async () => {
    const service = createActionHistoryService({ repository: createRepository(), logError: () => undefined });

    const result = await service.recordTerminal({ ...validInput, status: "RUNNING", rawPrompt: "secret" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ACTION_HISTORY_INVALID",
        userMessage: "No se pudo registrar el historial de la acción."
      }
    });
  });

  it("rejects history summaries and error codes that could expose technical details", async () => {
    const repository = createRepository();
    const service = createActionHistoryService({ repository, logError: () => undefined });

    const result = await service.recordTerminal({
      ...validInput,
      userSummary: "postgresql://user:password@127.0.0.1/private",
      errorCode: "database rejected password"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ACTION_HISTORY_INVALID",
        userMessage: "No se pudo registrar el historial de la acción."
      }
    });
    expect(repository.record).not.toHaveBeenCalled();
  });

  it("maps persistence failures without leaking technical details", async () => {
    const password = "do-not-expose-this-password";
    const repository: ActionHistoryRepository = {
      record: vi.fn().mockRejectedValue(new Error(`database rejected ${password}`)),
      list: vi.fn().mockRejectedValue(new ActionHistoryRepositoryError())
    };
    const logError = vi.fn();
    const service = createActionHistoryService({ repository, logError });

    const recordResult = await service.recordTerminal(validInput);
    const listResult = await service.list({});

    expect(recordResult).toEqual({
      ok: false,
      error: {
        code: "ACTION_HISTORY_UNAVAILABLE",
        userMessage: "No se pudo acceder al historial de acciones."
      }
    });
    expect(listResult).toEqual({
      ok: false,
      error: {
        code: "ACTION_HISTORY_UNAVAILABLE",
        userMessage: "No se pudo acceder al historial de acciones."
      }
    });
    expect(JSON.stringify(recordResult)).not.toContain(password);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(password);
  });

  it("lists history with bounded filters and stable repository ordering", async () => {
    const repository = createRepository();
    const service = createActionHistoryService({ repository, logError: () => undefined });

    const result = await service.list({ actions: ["CREATE_TASK"], limit: 10 });

    expect(result).toEqual({ ok: true, data: { items: [historyRecord], total: 1 } });
    expect(repository.list).toHaveBeenCalledWith({ actions: ["CREATE_TASK"], limit: 10 });
  });

  it("removes values that are not approved safe metadata", () => {
    expect(
      sanitizeActionHistoryMetadata({
        itemCount: 2,
        resultKind: "PARTIAL_SUCCESS",
        audio: "captured-audio",
        stackTrace: "stack",
        fileContents: "private",
        nested: { token: "secret" }
      })
    ).toEqual({ itemCount: 2, resultKind: "PARTIAL_SUCCESS" });
  });

  it("retains only a safe registered application display name for OPEN_APPLICATION history", async () => {
    const repository = createRepository();
    const service = createActionHistoryService({ repository, logError: () => undefined });
    const executablePath = "C:\\Program Files\\Private\\application.exe";

    await service.recordTerminal({
      action: "OPEN_APPLICATION",
      riskLevel: 1,
      status: "SUCCEEDED",
      userSummary: "Se abrió Microsoft Word.",
      metadata: {
        scopeKind: "APPLICATION",
        resultKind: "SUCCEEDED",
        applicationDisplayName: "Microsoft Word",
        alias: "Word",
        executablePath,
        canonicalPath: executablePath,
        command: "application.exe",
        processId: 1234,
        spawnError: "technical failure"
      },
      startedAt: "2026-09-17T10:00:00.000Z",
      finishedAt: "2026-09-17T10:00:01.000Z"
    });

    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          scopeKind: "APPLICATION",
          resultKind: "SUCCEEDED",
          applicationDisplayName: "Microsoft Word"
        }
      })
    );
    const [persisted] = vi.mocked(repository.record).mock.calls[0];
    expect(persisted.metadata).not.toHaveProperty("alias");
    expect(persisted.metadata).not.toHaveProperty("executablePath");
    expect(persisted.metadata).not.toHaveProperty("canonicalPath");
    expect(persisted.metadata).not.toHaveProperty("command");
    expect(persisted.metadata).not.toHaveProperty("processId");
    expect(persisted.metadata).not.toHaveProperty("spawnError");
    expect(JSON.stringify(persisted)).not.toContain(executablePath);
  });
});
