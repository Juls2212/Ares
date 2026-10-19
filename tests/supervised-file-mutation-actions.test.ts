import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { evaluateActionProposal, getActionPolicy } from "../src/main/actions/action-policy";
import { ENABLED_ASSISTANT_CAPABILITIES } from "../src/main/actions/capability-registry";
import { createSupervisedFileActionExecutor } from "../src/main/actions/supervised-file-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { attachSpokenActionResponse } from "../src/main/ipc/register-action-ipc";
import { FILES_FAILURES } from "../src/main/files/supervised-file-failures";
import { createSupervisedFileService } from "../src/main/files/supervised-file-service";
import { createVirtualFilesystem, folderFor, type VirtualFilesystem } from "./helpers/virtual-filesystem";

const documents = folderFor("DOCUMENTS");
const downloads = folderFor("DOWNLOADS");

const createFlow = (setup: (fixture: VirtualFilesystem) => void) => {
  const fixture = createVirtualFilesystem();
  setup(fixture);
  const trashItem = vi.fn(async (_target: string) => undefined);
  const service = createSupervisedFileService({
    filesystem: fixture.filesystem,
    shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => ""), trashItem },
    getKnownFolder: folderFor,
    now: () => 1_000,
    logError: vi.fn()
  });
  const unused = { execute: vi.fn() } as never;
  const executor = createActionExecutor({
    plannerExecutor: unused,
    applicationExecutor: unused,
    approvedWebExecutor: unused,
    filesExecutor: createSupervisedFileActionExecutor({ service, logError: vi.fn() })
  });
  const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
  let counter = 0;
  const orchestrator = createActionOrchestrator({
    executor,
    historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
    generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: vi.fn()
  });
  return { orchestrator, service, fixture, trashItem, recordTerminal };
};

const confirmationOf = (result: Awaited<ReturnType<ReturnType<typeof createFlow>["orchestrator"]["propose"]>>) => {
  if (!result.ok || !("confirmationId" in result.data)) throw new Error("Expected a confirmation.");
  return result.data;
};

describe("rename flow", () => {
  const setup = (fixture: VirtualFilesystem) => {
    fixture.addFile(path.join(documents, "informe.pdf"));
  };

  it("holds the rename for one standard confirmation, then renames once", async () => {
    const { orchestrator, service, fixture } = createFlow(setup);
    await service.search({ query: "informe" });
    const proposed = await orchestrator.propose({ action: "RENAME_FOUND_ITEM", input: { ordinal: 1, newName: "Informe final" } });
    const awaiting = confirmationOf(proposed);
    expect(awaiting).toMatchObject({
      action: "RENAME_FOUND_ITEM",
      riskLevel: 2,
      confirmation: { required: true, summary: "Se renombrará «informe.pdf» a «Informe final.pdf» en Documentos." }
    });
    expect(JSON.stringify(proposed)).not.toMatch(/C:\\|Users|prepared/);
    expect(fixture.renameCalls).toEqual([]);

    await expect(orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
      ok: true, data: { status: "SUCCEEDED", userSummary: "Listo, cambié el nombre." }
    });
    expect(fixture.renameCalls).toHaveLength(1);
    await expect(orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
    expect(fixture.renameCalls).toHaveLength(1);
  });

  it("reports a collision at propose time with its own message and opens no dialog", async () => {
    const { orchestrator, service, fixture } = createFlow((f) => { setup(f); f.addFile(path.join(documents, "Final.pdf")); });
    await service.search({ query: "informe" });
    const result = await orchestrator.propose({ action: "RENAME_FOUND_ITEM", input: { ordinal: 1, newName: "final" } });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "FILES_ALREADY_EXISTS", userSummary: FILES_FAILURES.FILES_ALREADY_EXISTS }
    });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });
});

describe("move and organize flows", () => {
  const setup = (fixture: VirtualFilesystem) => {
    fixture.addFile(path.join(downloads, "factura1.pdf"));
    fixture.addFile(path.join(downloads, "factura2.pdf"));
  };

  it("moves after a single confirmation and states only the item count and destination label", async () => {
    const { orchestrator, service, fixture, recordTerminal } = createFlow(setup);
    await service.search({ query: "factura" });
    const proposed = await orchestrator.propose({ action: "MOVE_FOUND_ITEMS", input: { all: true, destinationRoot: "DOCUMENTS" } });
    const awaiting = confirmationOf(proposed);
    expect(awaiting).toMatchObject({ riskLevel: 2, confirmation: { summary: "Se moverán 2 elementos a Documentos." } });
    expect(JSON.stringify(proposed)).not.toMatch(/factura|C:\\|Users/);
    expect(fixture.renameCalls).toEqual([]);

    const confirmed = await orchestrator.confirm(awaiting.confirmationId);
    expect(confirmed).toMatchObject({ ok: true, data: { status: "SUCCEEDED", data: { movedCount: 2, failedCount: 0 }, userSummary: "Listo, moví 2 elementos." } });
    const history = recordTerminal.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(history).toMatchObject({ action: "MOVE_FOUND_ITEMS", metadata: { scopeKind: "FILES", movedCount: 2, failedCount: 0 } });
    expect(JSON.stringify(history)).not.toMatch(/factura|C:\\|Users|Documentos/);
  });

  it("aborts the whole move at propose time on a collision, before any dialog", async () => {
    const { orchestrator, service, fixture } = createFlow((f) => { setup(f); f.addFile(path.join(documents, "factura2.pdf")); });
    await service.search({ query: "factura", root: "DOWNLOADS" });
    const result = await orchestrator.propose({ action: "MOVE_FOUND_ITEMS", input: { ordinals: [1, 2], destinationRoot: "DOCUMENTS" } });
    expect(result).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "FILES_ALREADY_EXISTS" } });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("reports only counts when a move stops half-way, in the outcome and in history", async () => {
    const { orchestrator, service, fixture, recordTerminal } = createFlow(setup);
    await service.search({ query: "factura" });
    const awaiting = confirmationOf(await orchestrator.propose({ action: "MOVE_FOUND_ITEMS", input: { all: true, destinationRoot: "DOCUMENTS" } }));
    fixture.failRenameFor(path.join(downloads, "factura2.pdf"), "EBUSY");
    const confirmed = await orchestrator.confirm(awaiting.confirmationId);
    expect(confirmed).toMatchObject({
      ok: true,
      data: {
        status: "EXECUTION_FAILED",
        errorCode: "FILES_PARTIAL_COMPLETION",
        data: { movedCount: 1, failedCount: 1 }
      }
    });
    expect(confirmed.ok && confirmed.data.userSummary).toBe(
      `${FILES_FAILURES.FILES_PARTIAL_COMPLETION} Se movieron 1 elemento y 1 elemento no se pudieron mover.`
    );
    const history = recordTerminal.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(history).toMatchObject({ metadata: { movedCount: 1, failedCount: 1 }, errorCode: "FILES_PARTIAL_COMPLETION" });
    expect(JSON.stringify([confirmed, history])).not.toMatch(/factura|EBUSY|C:\\|Users/);
  });

  it("organizes with one confirmation that covers creating the folder and moving the items", async () => {
    const { orchestrator, service, fixture } = createFlow(setup);
    await service.search({ query: "factura" });
    const proposed = await orchestrator.propose({
      action: "ORGANIZE_FOUND_ITEMS",
      input: { all: true, folderName: "Facturas", root: "DOCUMENTS" }
    });
    const awaiting = confirmationOf(proposed);
    expect(awaiting).toMatchObject({
      riskLevel: 2,
      confirmation: { summary: "Se creará la carpeta «Facturas» en Documentos y se moverán 2 elementos a ella." }
    });
    expect(fixture.mkdirCalls).toEqual([]);
    expect(fixture.renameCalls).toEqual([]);
    await expect(orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
      ok: true, data: { status: "SUCCEEDED", userSummary: "Listo, organicé 2 elementos." }
    });
    expect(fixture.mkdirCalls).toHaveLength(1);
    expect(fixture.renameCalls).toHaveLength(2);
  });

  it("says when the destination folder already exists", async () => {
    const { orchestrator, service } = createFlow((f) => { setup(f); f.addDir(path.join(documents, "Facturas")); });
    await service.search({ query: "factura", root: "DOWNLOADS" });
    const awaiting = confirmationOf(await orchestrator.propose({
      action: "ORGANIZE_FOUND_ITEMS",
      input: { ordinals: [1], folderName: "Facturas", root: "DOCUMENTS" }
    }));
    expect(awaiting.confirmation.summary).toBe("Se moverán 1 elemento a la carpeta existente «Facturas» en Documentos.");
  });
});

describe("delete flow (reinforced confirmation, Recycle Bin only)", () => {
  const setup = (fixture: VirtualFilesystem) => {
    fixture.addFile(path.join(documents, "viejo.txt"));
    fixture.addDir(path.join(documents, "Borrador"));
  };

  it("uses the reinforced class and risk level, and trashes nothing before confirmation", async () => {
    expect(getActionPolicy("DELETE_FOUND_ITEM")).toMatchObject({
      approval: "REINFORCED_CONFIRMATION_REQUIRED", riskLevel: 3, confirmation: { required: true }
    });
    const { orchestrator, service, trashItem, fixture } = createFlow(setup);
    await service.search({ query: "viejo" });
    const proposed = await orchestrator.propose({ action: "DELETE_FOUND_ITEM", input: { ordinal: 1 } });
    const awaiting = confirmationOf(proposed);
    expect(awaiting).toMatchObject({
      action: "DELETE_FOUND_ITEM",
      riskLevel: 3,
      confirmation: { required: true, summary: "Se enviará a la Papelera el archivo «viejo.txt» (Documentos). Podrás restaurarlo desde la Papelera." }
    });
    expect(JSON.stringify(proposed)).not.toMatch(/C:\\|Users|prepared/);
    expect(trashItem).not.toHaveBeenCalled();

    await expect(orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
      ok: true, data: { status: "SUCCEEDED", userSummary: "Listo, envié el elemento a la Papelera." }
    });
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(path.join(documents, "viejo.txt"));
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
    await expect(orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
    expect(trashItem).toHaveBeenCalledOnce();
  });

  it("states that a folder goes to the Papelera with all its contents", async () => {
    const { orchestrator, service } = createFlow(setup);
    await service.search({ query: "Borrador" });
    const awaiting = confirmationOf(await orchestrator.propose({ action: "DELETE_FOUND_ITEM", input: { ordinal: 1 } }));
    expect(awaiting.confirmation.summary).toBe(
      "Se enviará a la Papelera la carpeta «Borrador» (Documentos) y todo su contenido. Podrás restaurarlo desde la Papelera."
    );
  });

  it("deletes nothing when the person cancels", async () => {
    const { orchestrator, service, trashItem } = createFlow(setup);
    await service.search({ query: "viejo" });
    const awaiting = confirmationOf(await orchestrator.propose({ action: "DELETE_FOUND_ITEM", input: { ordinal: 1 } }));
    await expect(orchestrator.cancel(awaiting.confirmationId)).resolves.toMatchObject({ ok: true, data: { status: "CANCELLED" } });
    await expect(orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
    expect(trashItem).not.toHaveBeenCalled();
  });

  it("re-validates at confirm and trashes nothing if the item changed", async () => {
    const { orchestrator, service, fixture, trashItem } = createFlow(setup);
    await service.search({ query: "viejo" });
    const awaiting = confirmationOf(await orchestrator.propose({ action: "DELETE_FOUND_ITEM", input: { ordinal: 1 } }));
    fixture.redirectRealpath(path.join(documents, "viejo.txt"), "C:\\Windows\\viejo.txt");
    await expect(orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
      ok: true, data: { status: "VALIDATION_FAILED", errorCode: "FILES_OUT_OF_SCOPE" }
    });
    expect(trashItem).not.toHaveBeenCalled();
  });

  it("reports an unavailable Recycle Bin and deletes nothing, with no fallback", async () => {
    const { orchestrator, service, trashItem, fixture, recordTerminal } = createFlow(setup);
    trashItem.mockRejectedValueOnce(new Error("Recycle Bin unavailable C:\\Users\\Juli"));
    await service.search({ query: "viejo" });
    const awaiting = confirmationOf(await orchestrator.propose({ action: "DELETE_FOUND_ITEM", input: { ordinal: 1 } }));
    const confirmed = await orchestrator.confirm(awaiting.confirmationId);
    expect(confirmed).toMatchObject({
      ok: true,
      data: { status: "EXECUTION_FAILED", errorCode: "FILES_RECYCLE_UNAVAILABLE", userSummary: FILES_FAILURES.FILES_RECYCLE_UNAVAILABLE }
    });
    expect(fixture.exists(path.join(documents, "viejo.txt"))).toBe(true);
    expect(JSON.stringify([confirmed, recordTerminal.mock.calls])).not.toMatch(/Recycle Bin unavailable|Users|viejo/);
  });

  it.each([
    [{ ordinals: [1, 2] }],
    [{ ordinal: 1, ordinals: [1] }],
    [{ all: true }],
    [{ ordinal: [1, 2] }],
    [{ ordinal: 0 }],
    [{ ordinal: 11 }],
    [{ ordinal: "1" }],
    [{ ordinal: 1, preparedId: "forged" }],
    [{ ordinal: 1, path: "C:\\Users\\Juli\\Documents\\viejo.txt" }],
    [{ name: "viejo.txt" }],
    [{}]
  ])("rejects the delete submission %j before any service call", async (input) => {
    const { orchestrator, service, trashItem } = createFlow(setup);
    await service.search({ query: "viejo" });
    const spy = vi.spyOn(service, "prepareDelete");
    await expect(orchestrator.propose({ action: "DELETE_FOUND_ITEM", input })).resolves.toMatchObject({
      ok: false, error: { code: "ACTION_PROPOSAL_INVALID" }
    });
    expect(spy).not.toHaveBeenCalled();
    expect(trashItem).not.toHaveBeenCalled();
  });

  it("never deletes without an explicit prior selection", async () => {
    const { orchestrator, trashItem } = createFlow(setup);
    const result = await orchestrator.propose({ action: "DELETE_FOUND_ITEM", input: { ordinal: 1 } });
    expect(result).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "FILES_STALE_SELECTION" } });
    expect(trashItem).not.toHaveBeenCalled();
  });
});

describe("strict submissions for the new actions", () => {
  it.each([
    ["RENAME_FOUND_ITEM", { ordinal: 1 }],
    ["RENAME_FOUND_ITEM", { ordinal: 1, newName: 5 }],
    ["RENAME_FOUND_ITEM", { ordinal: 1, newName: "x", path: "C:\\x" }],
    ["RENAME_FOUND_ITEM", { ordinal: 12, newName: "x" }],
    ["MOVE_FOUND_ITEMS", { ordinals: [1], destinationRoot: "C:\\Windows" }],
    ["MOVE_FOUND_ITEMS", { ordinals: [1] }],
    ["MOVE_FOUND_ITEMS", { all: true }],
    ["MOVE_FOUND_ITEMS", { ordinals: [1], all: true, destinationRoot: "DOCUMENTS" }],
    ["MOVE_FOUND_ITEMS", { ordinals: [1], destinationRoot: "DOCUMENTS", destination: "C:\\x" }],
    ["MOVE_FOUND_ITEMS", { ordinals: Array.from({ length: 11 }, (_unused, index) => index + 1), destinationRoot: "DOCUMENTS" }],
    ["ORGANIZE_FOUND_ITEMS", { all: true, folderName: "Facturas" }],
    ["ORGANIZE_FOUND_ITEMS", { all: true, root: "DOCUMENTS" }],
    ["ORGANIZE_FOUND_ITEMS", { all: true, folderName: "Facturas", root: "DOCUMENTS", classify: true }]
  ])("rejects the malformed %s submission %j before any service call", async (action, input) => {
    const { orchestrator, service } = createFlow(() => undefined);
    const spies = [vi.spyOn(service, "prepareRename"), vi.spyOn(service, "prepareMove"), vi.spyOn(service, "prepareOrganize")];
    await expect(orchestrator.propose({ action, input })).resolves.toMatchObject({ ok: false, error: { code: "ACTION_PROPOSAL_INVALID" } });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it.each(["RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "MOVE_FOLDER", "ORGANIZE_FILES", "DELETE_FILE", "DELETE_FOLDER"])(
    "still rejects the legacy %s action",
    async (action) => {
      const { orchestrator } = createFlow(() => undefined);
      expect(evaluateActionProposal({ action })).toMatchObject({ ok: false });
      await expect(orchestrator.propose({ action, input: {} })).resolves.toMatchObject({ ok: false });
    }
  );
});

describe("registry and policy", () => {
  it("enables exactly eight FILES actions with the approved classes", () => {
    const files = ENABLED_ASSISTANT_CAPABILITIES.filter((capability) => capability.domain === "FILES");
    expect(files).toHaveLength(8);
    expect(Object.fromEntries(files.map((capability) => [capability.action, capability.approval]))).toEqual({
      SEARCH_FILES: "DIRECT",
      REVEAL_FOUND_FILE: "DIRECT",
      OPEN_FOUND_FILE: "CONFIRMATION_REQUIRED",
      CREATE_FOLDER: "CONFIRMATION_REQUIRED",
      RENAME_FOUND_ITEM: "CONFIRMATION_REQUIRED",
      MOVE_FOUND_ITEMS: "CONFIRMATION_REQUIRED",
      ORGANIZE_FOUND_ITEMS: "CONFIRMATION_REQUIRED",
      DELETE_FOUND_ITEM: "REINFORCED_CONFIRMATION_REQUIRED"
    });
    for (const capability of files) expect(capability.executor).toBe("FILES");
    expect(files.every((capability) => capability.label.length > 0 && capability.label.length <= 60)).toBe(true);
  });
});

describe("history, logs and speech", () => {
  it("speaks only generic sentences or counts for the mutations, never names", async () => {
    const { orchestrator, service } = createFlow((fixture) => {
      fixture.addFile(path.join(downloads, "confidencial1.pdf"));
      fixture.addFile(path.join(downloads, "confidencial2.pdf"));
    });
    await service.search({ query: "confidencial" });
    const remember = vi.fn((_windowId: number, _text: string) => ({ responseId: "r", text: "t" }) as never);

    const rename = confirmationOf(await orchestrator.propose({ action: "RENAME_FOUND_ITEM", input: { ordinal: 1, newName: "Secreto" } }));
    attachSpokenActionResponse(1, await orchestrator.confirm(rename.confirmationId), { clear: vi.fn(), remember });
    await service.search({ query: "confidencial" });
    const move = confirmationOf(await orchestrator.propose({ action: "MOVE_FOUND_ITEMS", input: { all: true, destinationRoot: "DOCUMENTS" } }));
    attachSpokenActionResponse(1, await orchestrator.confirm(move.confirmationId), { clear: vi.fn(), remember });

    const spoken = remember.mock.calls.map(([, text]) => text);
    expect(spoken).toEqual(["Listo, cambié el nombre.", "Listo, moví 1 elemento."]);
    expect(JSON.stringify(spoken)).not.toMatch(/Secreto|confidencial|C:\\/);
  });

  it("keeps names, destinations and paths out of history for every new action", async () => {
    const { orchestrator, service, recordTerminal } = createFlow((fixture) => {
      fixture.addFile(path.join(downloads, "nombre-privado.pdf"));
      fixture.addFile(path.join(downloads, "nombre-privado2.pdf"));
      fixture.addFile(path.join(downloads, "nombre-privado3.pdf"));
    });
    await service.search({ query: "nombre-privado" });
    const rename = confirmationOf(await orchestrator.propose({ action: "RENAME_FOUND_ITEM", input: { ordinal: 1, newName: "Destino Privado" } }));
    await orchestrator.confirm(rename.confirmationId);
    await service.search({ query: "nombre-privado" });
    const organize = confirmationOf(await orchestrator.propose({ action: "ORGANIZE_FOUND_ITEMS", input: { ordinals: [1], folderName: "Carpeta Privada", root: "DOCUMENTS" } }));
    await orchestrator.confirm(organize.confirmationId);
    await service.search({ query: "nombre-privado" });
    const trash = confirmationOf(await orchestrator.propose({ action: "DELETE_FOUND_ITEM", input: { ordinal: 1 } }));
    await orchestrator.confirm(trash.confirmationId);

    const recorded = JSON.stringify(recordTerminal.mock.calls);
    expect(recorded).toContain("RENAME_FOUND_ITEM");
    expect(recorded).toContain("ORGANIZE_FOUND_ITEMS");
    expect(recorded).toContain("DELETE_FOUND_ITEM");
    expect(recorded).not.toMatch(/nombre-privado|Destino Privado|Carpeta Privada|Privad|C:\\|Users|Documentos|Descargas/);
    expect(recorded).toContain("La acción de archivos se completó.");
  });
});

describe("complete failure taxonomy", () => {
  it("defines a distinct bounded Spanish message for every code, with no placeholders", () => {
    expect(FILES_FAILURES).toEqual({
      FILES_NO_RESULTS: "No encontré archivos que coincidan con tu búsqueda.",
      FILES_SEARCH_PARTIAL: "Los resultados pueden ser parciales.",
      FILES_STALE_SELECTION: "Esa selección ya no está disponible. Haz una nueva búsqueda.",
      FILES_TARGET_NOT_FOUND: "Ese elemento ya no existe. Haz una nueva búsqueda.",
      FILES_TYPE_BLOCKED: "No puedo abrir ese tipo de archivo.",
      FILES_ALREADY_EXISTS: "Ya existe un elemento con ese nombre. No se cambió nada.",
      FILES_INVALID_NAME: "El nombre no es válido.",
      FILES_INVALID_QUERY: "La búsqueda no es válida.",
      FILES_OUT_OF_SCOPE: "Esa ubicación no está permitida.",
      FILES_DESTINATION_INVALID: "El destino no es válido o no está permitido. No se movió nada.",
      FILES_RECYCLE_UNAVAILABLE: "No pude enviar el elemento a la Papelera. No se eliminó nada.",
      FILES_PARTIAL_COMPLETION: "La operación se detuvo antes de terminar. Haz una nueva búsqueda para revisar el resultado.",
      FILES_OPERATION_FAILED: "No se pudo completar la operación con archivos."
    });
    const messages = Object.values(FILES_FAILURES);
    expect(new Set(messages).size).toBe(messages.length);
    expect(messages.every((message) => message.length <= 120 && !/[{}\\]|C:|undefined/.test(message))).toBe(true);
  });
});
