import { describe, expect, it, vi } from "vitest";
import { createFileActionExecutor } from "../src/main/actions/file-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { FileActionProposal } from "../src/shared/action-contracts";
import type { FileMutationService } from "../src/main/files/file-mutation-service";
import type { FileSearchService } from "../src/main/files/file-search-service";
import type { FileOrganizationExecutor } from "../src/main/files/file-organization-executor";
import type { FileOrganizationPlanGenerator } from "../src/main/files/file-organization-plan-generator";

const actionId = "11111111-1111-4111-8111-111111111111";

const createSearchService = (): FileSearchService => ({
  search: vi.fn(async () => ({
    ok: true as const,
    data: { items: [], total: 0, truncated: false, skippedEntryCount: 0 }
  }))
});

const createMutationService = (): FileMutationService => ({
  createFolder: vi.fn(async () => ({
    ok: true as const,
    data: { operation: "CREATE_FOLDER" as const, entryType: "DIRECTORY" as const, reference: { rootId: "DOCUMENTS" as const, relativePath: "Work\\Archive" } }
  })),
  renameFile: vi.fn(async () => ({
    ok: true as const,
    data: { operation: "RENAME_FILE" as const, entryType: "FILE" as const, reference: { rootId: "DOCUMENTS" as const, relativePath: "Work\\Summary.txt" } }
  })),
  renameFolder: vi.fn(async () => ({
    ok: true as const,
    data: { operation: "RENAME_FOLDER" as const, entryType: "DIRECTORY" as const, reference: { rootId: "DOCUMENTS" as const, relativePath: "Work\\Archive 2026" } }
  })),
  moveFile: vi.fn(async () => ({
    ok: true as const,
    data: { operation: "MOVE_FILE" as const, entryType: "FILE" as const, reference: { rootId: "DOWNLOADS" as const, relativePath: "Archive\\Report.txt" } }
  }))
});

const actionCases: Array<{ action: FileActionProposal["action"]; input: unknown; method: keyof FileSearchService | keyof FileMutationService }> = [
  { action: "SEARCH_FILES", input: { rootId: "DOCUMENTS", query: "report" }, method: "search" },
  { action: "CREATE_FOLDER", input: { parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" }, name: "Archive" }, method: "createFolder" },
  { action: "RENAME_FILE", input: { source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" }, newName: "Summary.txt" }, method: "renameFile" },
  { action: "RENAME_FOLDER", input: { source: { rootId: "DOCUMENTS", relativePath: "Work\\Archive" }, newName: "Archive 2026" }, method: "renameFolder" },
  { action: "MOVE_FILE", input: { source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" }, destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" } }, method: "moveFile" }
];

describe("file action executor", () => {
  it("maps every approved file action to exactly one Main-only file service method", async () => {
    const fileSearchService = createSearchService();
    const fileMutationService = createMutationService();
    const executor = createFileActionExecutor({ fileSearchService, fileMutationService, logError: vi.fn() });

    for (const item of actionCases) {
      const proposal = { actionId, action: item.action, input: item.input } as FileActionProposal;
      const outcome = await executor.execute(proposal, getActionPolicy(item.action));

      expect(outcome.status).toBe("SUCCEEDED");
      if (item.method === "search") expect(fileSearchService.search).toHaveBeenCalledWith(item.input);
      else expect(fileMutationService[item.method]).toHaveBeenCalledWith(item.input);
    }
  });

  it("preserves controlled file failures without exposing paths or native errors", async () => {
    const fileSearchService = createSearchService();
    const fileMutationService = createMutationService();
    vi.mocked(fileMutationService.renameFile).mockResolvedValueOnce({
      ok: false,
      error: { code: "FILE_NATIVE_MOVE_UNAVAILABLE", userMessage: "La operación segura de archivos no está disponible." }
    });
    const executor = createFileActionExecutor({ fileSearchService, fileMutationService, logError: vi.fn() });

    const outcome = await executor.execute({
      actionId,
      action: "RENAME_FILE",
      input: { source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" }, newName: "Summary.txt" }
    }, getActionPolicy("RENAME_FILE"));

    expect(outcome).toMatchObject({
      status: "EXECUTION_FAILED",
      errorCode: "FILE_NATIVE_MOVE_UNAVAILABLE",
      userSummary: "La operación segura de archivos no está disponible."
    });
    expect(JSON.stringify(outcome)).not.toContain("C:\\");
    expect(JSON.stringify(outcome)).not.toContain("MoveFileW");
  });

  it("maps unexpected service failures to a controlled terminal outcome", async () => {
    const fileSearchService = createSearchService();
    const fileMutationService = createMutationService();
    vi.mocked(fileSearchService.search).mockRejectedValueOnce(new Error("C:\\private\\native failure"));
    const logError = vi.fn();
    const executor = createFileActionExecutor({ fileSearchService, fileMutationService, logError });

    const outcome = await executor.execute({ actionId, action: "SEARCH_FILES", input: { rootId: "DOCUMENTS", query: "report" } }, getActionPolicy("SEARCH_FILES"));

    expect(outcome).toMatchObject({
      status: "EXECUTION_FAILED",
      errorCode: "ACTION_EXECUTION_UNAVAILABLE",
      userSummary: "No se pudo completar la acción de archivos solicitada."
    });
    expect(JSON.stringify(outcome)).not.toContain("private");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("private");
  });

  it("prepares and executes ORGANIZE_FILES only from the Main-generated plan", async () => {
    const fileSearchService = createSearchService();
    const fileMutationService = createMutationService();
    const plan = {
      rootId: "DOCUMENTS" as const,
      folder: { rootId: "DOCUMENTS" as const, relativePath: "Inbox" },
      items: [],
      plannedCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      categoryCounts: { DOCUMENTS: 0, IMAGES: 0, AUDIO: 0, VIDEOS: 0, ARCHIVES: 0, OTHER: 0 },
      skipped: [],
      mixedContent: false,
      empty: true
    };
    const organizationPlanGenerator: FileOrganizationPlanGenerator = {
      generate: vi.fn(async () => ({ ok: true as const, data: plan }))
    };
    const organizationExecutor: FileOrganizationExecutor = {
      execute: vi.fn(async () => ({ ok: true as const, data: { plannedCount: 0, movedCount: 0, skippedCount: 0, conflictCount: 0, partial: false, categoryCounts: plan.categoryCounts } }))
    };
    const executor = createFileActionExecutor({
      fileSearchService,
      fileMutationService,
      organizationPlanGenerator,
      organizationExecutor,
      logError: vi.fn()
    });
    const proposal = {
      actionId,
      action: "ORGANIZE_FILES" as const,
      input: { folder: { rootId: "DOCUMENTS" as const, relativePath: "Inbox" } },
      plan
    };

    await expect(executor.prepareOrganization?.(proposal)).resolves.toEqual({ ok: true, data: plan });
    const outcome = await executor.execute(proposal, getActionPolicy("ORGANIZE_FILES"));

    expect(organizationPlanGenerator.generate).toHaveBeenCalledWith(proposal.input);
    expect(organizationExecutor.execute).toHaveBeenCalledWith(plan);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", action: "ORGANIZE_FILES" });
    expect(JSON.stringify(outcome)).not.toContain("Inbox");
  });
});
