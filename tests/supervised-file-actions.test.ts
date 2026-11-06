import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { evaluateActionProposal, getActionPolicy } from "../src/main/actions/action-policy";
import { describeSearchResults, createSupervisedFileActionExecutor } from "../src/main/actions/supervised-file-action-executor";
import { attachSpokenActionResponse } from "../src/main/ipc/register-action-ipc";
import { filesFailure, filesSuccess } from "../src/main/files/supervised-file-failures";
import type { SupervisedFileService } from "../src/main/files/supervised-file-service";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import type { SupervisedFileSearchData } from "../src/shared/supervised-file-contracts";

const identifiers = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444"
];

const searchData: SupervisedFileSearchData = {
  resultCount: 5,
  partial: true,
  items: [
    { ordinal: 1, name: "Curriculum Juli.pdf", kind: "DOCUMENT", rootLabel: "Documentos" },
    { ordinal: 2, name: "CV 2026.docx", kind: "DOCUMENT", rootLabel: "Descargas" },
    { ordinal: 3, name: "cv-antiguo.pdf", kind: "DOCUMENT", rootLabel: "Escritorio" },
    { ordinal: 4, name: "cv4.pdf", kind: "DOCUMENT", rootLabel: "Escritorio" },
    { ordinal: 5, name: "cv5.pdf", kind: "DOCUMENT", rootLabel: "Escritorio" }
  ]
};

const createFakeService = () => {
  const service = {
    search: vi.fn(async (_input: unknown) => filesSuccess(searchData)),
    revealFound: vi.fn(async (_ordinal: unknown) => filesSuccess({ revealed: true as const })),
    prepareOpen: vi.fn(async (_ordinal: unknown) => filesSuccess({ preparedId: "prepared-open", displayName: "Curriculum Juli.pdf", rootLabel: "Documentos" })),
    commitOpen: vi.fn(async (_id: unknown) => filesSuccess({ opened: true as const })),
    prepareCreateFolder: vi.fn(async (_input: unknown) => filesSuccess({ preparedId: "prepared-folder", folderName: "Fotos", locationLabel: "Documentos" })),
    commitCreateFolder: vi.fn(async (_id: unknown) => filesSuccess({ created: true as const }))
  };
  return service;
};

const createFlow = (service = createFakeService()) => {
  const unusedExecutor = { execute: vi.fn() } as never;
  const executor = createActionExecutor({
    plannerExecutor: unusedExecutor,
    applicationExecutor: unusedExecutor,
    approvedWebExecutor: unusedExecutor,
    filesExecutor: createSupervisedFileActionExecutor({ service: service as unknown as SupervisedFileService, logError: vi.fn() })
  });
  const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
  const historyService = { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService;
  const generateIdentifier = vi.fn();
  identifiers.forEach((identifier) => generateIdentifier.mockReturnValueOnce(identifier));
  const orchestrator = createActionOrchestrator({
    executor,
    historyService,
    generateIdentifier,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: vi.fn()
  });
  return { orchestrator, service, recordTerminal };
};

describe("supervised file action flows", () => {
  it("runs a search directly, with no confirmation, and returns only names, ordinals and labels", async () => {
    const { orchestrator, service, recordTerminal } = createFlow();
    const result = await orchestrator.propose({ action: "SEARCH_FILES", input: { query: "CV" } });

    expect(result).toMatchObject({ ok: true, data: { action: "SEARCH_FILES", status: "SUCCEEDED", riskLevel: 1 } });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(service.search).toHaveBeenCalledWith({ query: "CV" });
    expect(JSON.stringify(result)).not.toMatch(/C:\\|Users|absolutePath/);
    expect(result.ok && "data" in result.data && result.data.data).toMatchObject({ resultCount: 5, partial: true });
    expect(recordTerminal).toHaveBeenCalledOnce();
  });

  it("keeps file names, queries and results out of action history", async () => {
    const { orchestrator, recordTerminal } = createFlow();
    await orchestrator.propose({ action: "SEARCH_FILES", input: { query: "CV" } });
    const recorded = recordTerminal.mock.calls[0]?.[0] as unknown as Record<string, unknown>;

    expect(recorded).toMatchObject({
      action: "SEARCH_FILES",
      status: "SUCCEEDED",
      userSummary: "La acción de archivos se completó.",
      metadata: { scopeKind: "FILES", resultKind: "SUCCEEDED", itemCount: 5, partial: true }
    });
    expect(JSON.stringify(recorded)).not.toMatch(/Curriculum|CV 2026|cv-antiguo|"CV"|Juli|C:\\|Descargas/);
  });

  it("keeps names out of history for failures too", async () => {
    const service = createFakeService();
    service.search.mockResolvedValueOnce(filesFailure("FILES_INVALID_QUERY"));
    const { orchestrator, recordTerminal } = createFlow(service);
    await orchestrator.propose({ action: "SEARCH_FILES", input: { query: "secreto" } });
    const recorded = JSON.stringify(recordTerminal.mock.calls);
    expect(recorded).toContain("FILES_INVALID_QUERY");
    expect(recorded).not.toContain("secreto");
    expect(recorded).not.toContain("La búsqueda no es válida.");
  });

  it("reveals a found file directly without confirmation", async () => {
    const { orchestrator, service } = createFlow();
    const result = await orchestrator.propose({ action: "REVEAL_FOUND_FILE", input: { ordinal: 2 } });
    expect(result).toMatchObject({ ok: true, data: { action: "REVEAL_FOUND_FILE", status: "SUCCEEDED", riskLevel: 1 } });
    expect(service.revealFound).toHaveBeenCalledWith(2);
    expect(getActionPolicy("REVEAL_FOUND_FILE")).toMatchObject({ approval: "DIRECT", confirmation: { required: false } });
  });

  it("requires a Main-issued confirmation before opening and shows only name and root label", async () => {
    const { orchestrator, service } = createFlow();
    const proposed = await orchestrator.propose({ action: "OPEN_FOUND_FILE", input: { ordinal: 1 } });

    expect(proposed).toMatchObject({
      ok: true,
      data: {
        lifecycleState: "AWAITING_CONFIRMATION",
        action: "OPEN_FOUND_FILE",
        riskLevel: 2,
        confirmationId: identifiers[1],
        confirmation: { required: true, summary: "Se abrirá «Curriculum Juli.pdf» (Documentos)." }
      }
    });
    expect(JSON.stringify(proposed)).not.toMatch(/C:\\|Users|prepared-open/);
    expect(service.prepareOpen).toHaveBeenCalledWith(1);
    expect(service.commitOpen).not.toHaveBeenCalled();
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected confirmation.");

    const confirmed = await orchestrator.confirm(proposed.data.confirmationId);
    expect(confirmed).toMatchObject({ ok: true, data: { status: "SUCCEEDED", userSummary: "Listo, lo abrí." } });
    expect(service.commitOpen).toHaveBeenCalledWith("prepared-open");
    await expect(orchestrator.confirm(proposed.data.confirmationId)).resolves.toMatchObject({ ok: false });
    expect(service.commitOpen).toHaveBeenCalledOnce();
  });

  it("reports a blocked file type at propose time and opens no dialog", async () => {
    const service = createFakeService();
    service.prepareOpen.mockResolvedValueOnce(filesFailure("FILES_TYPE_BLOCKED") as never);
    const { orchestrator } = createFlow(service);
    const result = await orchestrator.propose({ action: "OPEN_FOUND_FILE", input: { ordinal: 1 } });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "FILES_TYPE_BLOCKED", userSummary: "No puedo abrir ese tipo de archivo." }
    });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(service.commitOpen).not.toHaveBeenCalled();
  });

  it("requires a confirmation before creating a folder and shows only the name and location label", async () => {
    const { orchestrator, service } = createFlow();
    const proposed = await orchestrator.propose({ action: "CREATE_FOLDER", input: { folderName: "Fotos", root: "DOCUMENTS" } });

    expect(proposed).toMatchObject({
      ok: true,
      data: {
        lifecycleState: "AWAITING_CONFIRMATION",
        action: "CREATE_FOLDER",
        riskLevel: 2,
        confirmation: { required: true, summary: "Se creará la carpeta «Fotos» en Documentos." }
      }
    });
    expect(service.commitCreateFolder).not.toHaveBeenCalled();
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected confirmation.");
    await expect(orchestrator.confirm(proposed.data.confirmationId)).resolves.toMatchObject({
      ok: true,
      data: { status: "SUCCEEDED", userSummary: "Listo, creé la carpeta." }
    });
    expect(service.commitCreateFolder).toHaveBeenCalledWith("prepared-folder");
  });

  it("reports an existing folder at propose time without creating a confirmation", async () => {
    const service = createFakeService();
    service.prepareCreateFolder.mockResolvedValueOnce(filesFailure("FILES_ALREADY_EXISTS") as never);
    const { orchestrator } = createFlow(service);
    const result = await orchestrator.propose({ action: "CREATE_FOLDER", input: { folderName: "Fotos", root: "DOCUMENTS" } });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "FILES_ALREADY_EXISTS", userSummary: "Ya existe un elemento con ese nombre. No se cambió nada." }
    });
    expect(service.commitCreateFolder).not.toHaveBeenCalled();
  });

  it("maps an operation failure after confirmation to an execution failure with a bounded message", async () => {
    const service = createFakeService();
    service.commitCreateFolder.mockResolvedValueOnce(filesFailure("FILES_OPERATION_FAILED") as never);
    const { orchestrator } = createFlow(service);
    const proposed = await orchestrator.propose({ action: "CREATE_FOLDER", input: { folderName: "Fotos", root: "DOCUMENTS" } });
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected confirmation.");
    await expect(orchestrator.confirm(proposed.data.confirmationId)).resolves.toMatchObject({
      ok: true,
      data: { status: "EXECUTION_FAILED", errorCode: "FILES_OPERATION_FAILED", userSummary: "No se pudo completar la operación con archivos." }
    });
  });

  it("converts an unexpected service exception into a controlled failure without its text", async () => {
    const service = createFakeService();
    service.search.mockRejectedValueOnce(new Error("private C:\\Users\\Juli failure"));
    const { orchestrator } = createFlow(service);
    const result = await orchestrator.propose({ action: "SEARCH_FILES", input: { query: "CV" } });
    expect(result).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", errorCode: "FILES_OPERATION_FAILED" } });
    expect(JSON.stringify(result)).not.toMatch(/private|Users/);
  });
});

describe("strict submissions and policy", () => {
  it.each([
    ["SEARCH_FILES", { query: "CV", path: "C:\\Users" }],
    ["SEARCH_FILES", { query: "CV", root: "SYSTEM" }],
    ["SEARCH_FILES", { query: "CV", kind: "EXECUTABLE" }],
    ["SEARCH_FILES", { rootId: "DOCUMENTS", query: "CV" }],
    ["SEARCH_FILES", { query: 5 }],
    ["REVEAL_FOUND_FILE", { ordinal: 0 }],
    ["REVEAL_FOUND_FILE", { ordinal: 11 }],
    ["REVEAL_FOUND_FILE", { ordinal: "1" }],
    ["REVEAL_FOUND_FILE", { ordinal: 1, path: "C:\\x" }],
    ["OPEN_FOUND_FILE", { ordinal: 1.5 }],
    ["OPEN_FOUND_FILE", { ordinal: 1, preparedId: "forged" }],
    ["CREATE_FOLDER", { folderName: "Fotos", preparedId: "forged" }],
    ["CREATE_FOLDER", { folderName: "Fotos", root: "DOCUMENTS", parentDirectory: { rootId: "DOCUMENTS", relativePath: "x" } }],
    ["CREATE_FOLDER", { folderName: "Fotos", parentOrdinal: 11 }],
    ["CREATE_FOLDER", { name: "Fotos", root: "DOCUMENTS" }]
  ])("rejects the malformed %s submission %j before any executor or service", async (action, input) => {
    const { orchestrator, service } = createFlow();
    await expect(orchestrator.propose({ action, input })).resolves.toMatchObject({ ok: false, error: { code: "ACTION_PROPOSAL_INVALID" } });
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });

  it.each(["RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "ORGANIZE_FILES", "DELETE_FILE", "DELETE_FOLDER"])(
    "rejects %s as unsupported without reaching an executor",
    async (action) => {
      const { orchestrator, service } = createFlow();
      expect(evaluateActionProposal({ action })).toMatchObject({ ok: false, error: { code: "ACTION_UNSUPPORTED" } });
      await expect(orchestrator.propose({ action, input: {} })).resolves.toMatchObject({ ok: false, error: { code: "ACTION_UNSUPPORTED" } });
      for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
    }
  );

  it("classifies the four actions with the approved classes", () => {
    expect(getActionPolicy("SEARCH_FILES")).toMatchObject({ approval: "DIRECT", riskLevel: 1 });
    expect(getActionPolicy("REVEAL_FOUND_FILE")).toMatchObject({ approval: "DIRECT", riskLevel: 1 });
    expect(getActionPolicy("OPEN_FOUND_FILE")).toMatchObject({ approval: "CONFIRMATION_REQUIRED", riskLevel: 2 });
    expect(getActionPolicy("CREATE_FOLDER")).toMatchObject({ approval: "CONFIRMATION_REQUIRED", riskLevel: 2 });
  });
});

describe("search result text", () => {
  it("states the count and the first three names with their ordinals", () => {
    const text = describeSearchResults(searchData);
    expect(text).toBe("Encontré 5 resultados: 1. Curriculum Juli.pdf (Documentos); 2. CV 2026.docx (Descargas); 3. cv-antiguo.pdf (Escritorio) y 2 más. Los resultados pueden ser parciales.");
    expect(text).not.toContain("cv4.pdf");
  });

  it("uses a distinct message for zero results", () => {
    expect(describeSearchResults({ resultCount: 0, partial: false, items: [] })).toBe("No encontré archivos que coincidan con tu búsqueda.");
  });

  it("uses the singular for one result and bounds long or unsafe names", () => {
    const text = describeSearchResults({
      resultCount: 1,
      partial: false,
      items: [{ ordinal: 1, name: `«${"a".repeat(200)}»\u0007`, kind: "DOCUMENT", rootLabel: "Documentos" }]
    });
    expect(text.startsWith("Encontré 1 resultado: 1. ")).toBe(true);
    expect(text.length).toBeLessThan(120);
    expect(text).not.toMatch(/[«»\u0007]/);
  });

  it("is what gets spoken, limited to three bounded names and no path", async () => {
    const { orchestrator } = createFlow();
    const result = await orchestrator.propose({ action: "SEARCH_FILES", input: { query: "CV" } });
    const remember = vi.fn((_windowId: number, _text: string) => ({ responseId: "r", text: "t" }) as never);
    attachSpokenActionResponse(1, result, { clear: vi.fn(), remember });
    const spoken = String(remember.mock.calls[0]?.[1]);
    expect(spoken).toContain("Curriculum Juli.pdf");
    expect(spoken).not.toContain("cv4.pdf");
    expect(spoken).not.toMatch(/C:\\|Users/);
  });
});
