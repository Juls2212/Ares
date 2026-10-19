import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createSupervisedFileService } from "../src/main/files/supervised-file-service";
import { createVirtualFilesystem, folderFor, type VirtualFilesystem } from "./helpers/virtual-filesystem";

const documents = folderFor("DOCUMENTS");
const downloads = folderFor("DOWNLOADS");

const createHarness = (setup?: (fixture: VirtualFilesystem) => void) => {
  const fixture = createVirtualFilesystem();
  setup?.(fixture);
  const trashItem = vi.fn(async (_target: string) => undefined);
  const logError = vi.fn();
  let counter = 0;
  const service = createSupervisedFileService({
    filesystem: fixture.filesystem,
    shell: { showItemInFolder: vi.fn(), openPath: vi.fn(async () => ""), trashItem },
    getKnownFolder: folderFor,
    now: () => 1_000,
    generateIdentifier: () => `prepared-${++counter}`,
    logError
  });
  return { service, fixture, trashItem, logError };
};

const searchAll = async (service: ReturnType<typeof createHarness>["service"], query = "a") => {
  await service.search({ query });
};

describe("rename", () => {
  const setup = (fixture: VirtualFilesystem) => {
    fixture.addFile(path.join(documents, "informe.pdf"));
    fixture.addFile(path.join(documents, "notas"));
    fixture.addDir(path.join(documents, "Proyectos"));
    fixture.addFile(path.join(documents, "Proyectos", "plan.txt"));
  };

  it("keeps the original extension unless the new name supplies one", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "informe" });
    await expect(service.prepareRename({ ordinal: 1, newName: "Informe final" })).resolves.toMatchObject({
      ok: true, data: { currentName: "informe.pdf", newName: "Informe final.pdf", kind: "DOCUMENT", rootLabel: "Documentos" }
    });
    await expect(service.prepareRename({ ordinal: 1, newName: "Informe v2.0" })).resolves.toMatchObject({ ok: true, data: { newName: "Informe v2.0.pdf" } });
    await expect(service.prepareRename({ ordinal: 1, newName: "Resumen.docx" })).resolves.toMatchObject({ ok: true, data: { newName: "Resumen.docx" } });
  });

  it("renames exactly one entry with a single rename call, in the same folder", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "informe" });
    const prepared = await service.prepareRename({ ordinal: 1, newName: "Final" });
    if (!prepared.ok) throw new Error("Expected a prepared rename.");
    expect(fixture.renameCalls).toEqual([]);
    await expect(service.commitRename(prepared.data.preparedId)).resolves.toEqual({ ok: true, data: { renamed: true } });
    expect(fixture.renameCalls).toEqual([[path.join(documents, "informe.pdf"), path.join(documents, "Final.pdf")]]);
    expect(fixture.exists(path.join(documents, "Final.pdf"))).toBe(true);
  });

  it.each(["", "a/b", "a\\b", "..", ".", "a:b", "CON", "nul.txt", "fin.", "x".repeat(65), "bad\u0001"])("rejects the invalid name %j", async (newName) => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "informe" });
    await expect(service.prepareRename({ ordinal: 1, newName })).resolves.toMatchObject({ ok: false, error: { code: "FILES_INVALID_NAME" } });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("rejects a name whose final extension is blocklisted, whatever the original type", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "a" });
    for (const ordinal of [1, 2]) {
      for (const newName of ["virus.exe", "script.PS1", "acceso.lnk", "x.dll", "y.msix"]) {
        await expect(service.prepareRename({ ordinal, newName })).resolves.toMatchObject({ ok: false, error: { code: "FILES_TYPE_BLOCKED" } });
      }
    }
  });

  it("never turns an extensionless file into a typed one by accident, and keeps its extensionless form", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "notas" });
    await expect(service.prepareRename({ ordinal: 1, newName: "apuntes" })).resolves.toMatchObject({ ok: true, data: { newName: "apuntes" } });
  });

  it("uses a folder name as given", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "Proyectos" });
    await expect(service.prepareRename({ ordinal: 1, newName: "Trabajos" })).resolves.toMatchObject({ ok: true, data: { newName: "Trabajos", kind: "FOLDER" } });
  });

  it("never overwrites, including case-insensitive collisions", async () => {
    const { service, fixture } = createHarness((f) => { setup(f); f.addFile(path.join(documents, "Existente.pdf")); });
    await service.search({ query: "informe" });
    for (const newName of ["existente", "EXISTENTE", "ExIsTeNtE.PDF"]) {
      await expect(service.prepareRename({ ordinal: 1, newName })).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    }
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
    expect(fixture.overwrites).toEqual([]);
  });

  it("re-checks the collision at confirm and renames nothing when the target appeared", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "informe" });
    const prepared = await service.prepareRename({ ordinal: 1, newName: "Nuevo" });
    if (!prepared.ok) throw new Error("Expected a prepared rename.");
    fixture.addFile(path.join(documents, "Nuevo.pdf"));
    await expect(service.commitRename(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
    expect(fixture.overwrites).toEqual([]);
  });

  it("allows a case-only change of the same entry but rejects an identical name", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "informe" });
    await expect(service.prepareRename({ ordinal: 1, newName: "INFORME" })).resolves.toMatchObject({ ok: true, data: { newName: "INFORME.pdf" } });
    await expect(service.prepareRename({ ordinal: 1, newName: "informe" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
  });

  it("re-validates containment and existence at propose and at confirm", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "informe" });
    const file = path.join(documents, "informe.pdf");
    fixture.redirectRealpath(file, "C:\\Windows\\System32\\informe.pdf");
    await expect(service.prepareRename({ ordinal: 1, newName: "X" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });

    const second = createHarness(setup);
    await second.service.search({ query: "informe" });
    const prepared = await second.service.prepareRename({ ordinal: 1, newName: "X" });
    if (!prepared.ok) throw new Error("Expected a prepared rename.");
    second.fixture.remove(path.join(documents, "informe.pdf"));
    await expect(second.service.commitRename(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_TARGET_NOT_FOUND" } });
    expect(second.fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("refuses a symlink and a stale ordinal, and rejects extra fields", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "informe" });
    await expect(service.prepareRename({ ordinal: 5, newName: "X" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    await expect(service.prepareRename({ ordinal: 1, newName: "X", path: "C:\\x" })).resolves.toMatchObject({ ok: false });
    fixture.addSymlink(path.join(documents, "informe.pdf"));
    await expect(service.prepareRename({ ordinal: 1, newName: "X" })).resolves.toMatchObject({ ok: false });
  });

  it("refreshes the last-search entry so ordinals do not point to stale paths", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "a" });
    const before = await service.search({ query: "informe" });
    expect(before.ok && before.data.items[0]?.name).toBe("informe.pdf");
    const prepared = await service.prepareRename({ ordinal: 1, newName: "Final" });
    if (!prepared.ok) throw new Error("Expected a prepared rename.");
    await service.commitRename(prepared.data.preparedId);
    expect(service.resolveFoundFileByName("final")).toEqual({ state: "RESOLVED", ordinal: 1 });
    expect(service.resolveFoundFileByName("informe")).toEqual({ state: "NONE" });
    await expect(service.revealFound(1)).resolves.toMatchObject({ ok: true });
    expect(fixture.exists(path.join(documents, "Final.pdf"))).toBe(true);
  });

  it("updates entries nested in a renamed folder", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "pro" });
    await service.search({ query: "p", root: "DOCUMENTS" });
    const folder = service.resolveFoundFolderByName("Proyectos");
    if (folder.state !== "RESOLVED") throw new Error("Expected the folder to resolve.");
    const prepared = await service.prepareRename({ ordinal: folder.ordinal, newName: "Trabajos" });
    if (!prepared.ok) throw new Error("Expected a prepared rename.");
    await service.commitRename(prepared.data.preparedId);
    const plan = service.resolveFoundFileByName("plan");
    if (plan.state !== "RESOLVED") throw new Error("Expected the nested file to resolve.");
    await expect(service.revealFound(plan.ordinal)).resolves.toMatchObject({ ok: true });
  });

  it("reports a failed rename without operating-system text and logs only a constant", async () => {
    const { service, fixture, logError } = createHarness(setup);
    await service.search({ query: "informe" });
    const prepared = await service.prepareRename({ ordinal: 1, newName: "X" });
    if (!prepared.ok) throw new Error("Expected a prepared rename.");
    fixture.failRenameFor(path.join(documents, "informe.pdf"), "EPERM");
    const result = await service.commitRename(prepared.data.preparedId);
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_OPERATION_FAILED" } });
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(/EPERM|Users|informe/);
  });
});

describe("move", () => {
  const setup = (fixture: VirtualFilesystem) => {
    fixture.addFile(path.join(documents, "factura1.pdf"));
    fixture.addFile(path.join(documents, "factura2.pdf"));
    fixture.addDir(path.join(documents, "Archivo"));
    fixture.addFile(path.join(downloads, "foto.png"));
  };

  it("moves selected results to an approved root with sequential single renames after confirm", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura" });
    const prepared = await service.prepareMove({ ordinals: [1, 2], destinationRoot: "DOWNLOADS" });
    expect(prepared).toEqual({ ok: true, data: { preparedId: "prepared-1", itemCount: 2, destinationLabel: "Descargas" } });
    expect(fixture.renameCalls).toEqual([]);
    await expect(service.commitMove("prepared-1")).resolves.toEqual({ ok: true, data: { movedCount: 2, failedCount: 0 } });
    expect(fixture.renameCalls).toEqual([
      [path.join(documents, "factura1.pdf"), path.join(downloads, "factura1.pdf")],
      [path.join(documents, "factura2.pdf"), path.join(downloads, "factura2.pdf")]
    ]);
    expect(fixture.overwrites).toEqual([]);
  });

  it("supports the closed all-current-results flag and a FOLDER entry as destination", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "a" });
    const folder = service.resolveFoundFolderByName("Archivo");
    if (folder.state !== "RESOLVED") throw new Error("Expected the folder to resolve.");
    const files = ["factura1.pdf", "factura2.pdf"];
    const prepared = await service.prepareMove({ ordinals: [1, 2].filter((o) => o !== folder.ordinal).slice(0, 1), destinationOrdinal: folder.ordinal });
    expect(prepared).toMatchObject({ ok: true, data: { destinationLabel: "Archivo (Documentos)" } });
    expect(files.length).toBe(2);
    expect(fixture.renameCalls).toEqual([]);
  });

  it("aborts the whole request before anything moves when any name collides", async () => {
    const { service, fixture } = createHarness((f) => { setup(f); f.addFile(path.join(downloads, "FACTURA2.PDF")); });
    await service.search({ query: "factura" });
    await expect(service.prepareMove({ ordinals: [1, 2], destinationRoot: "DOWNLOADS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("aborts when the selection holds two entries with the same name", async () => {
    const { service, fixture } = createHarness((f) => { setup(f); f.addDir(path.join(documents, "Archivo")); f.addFile(path.join(documents, "Archivo", "factura1.pdf")); });
    await service.search({ query: "factura1" });
    await expect(service.prepareMove({ all: true, destinationRoot: "DESKTOP" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("moving an item that is already in the destination is a collision, not a silent no-op", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "factura1" });
    await expect(service.prepareMove({ ordinals: [1], destinationRoot: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
  });

  it("rejects moving a folder into itself or its own descendant", async () => {
    const { service, fixture } = createHarness((f) => {
      f.addDir(path.join(documents, "Padre"));
      f.addDir(path.join(documents, "Padre", "Padre hijo"));
    });
    await service.search({ query: "padre", root: "DOCUMENTS" });
    const padre = service.resolveFoundFolderByName("Padre");
    const hijo = service.resolveFoundFolderByName("Padre hijo");
    if (padre.state !== "RESOLVED" || hijo.state !== "RESOLVED") throw new Error("Expected folders to resolve.");
    await expect(service.prepareMove({ ordinals: [padre.ordinal], destinationOrdinal: padre.ordinal })).resolves.toMatchObject({ ok: false, error: { code: "FILES_DESTINATION_INVALID" } });
    await expect(service.prepareMove({ ordinals: [padre.ordinal], destinationOrdinal: hijo.ordinal })).resolves.toMatchObject({ ok: false, error: { code: "FILES_DESTINATION_INVALID" } });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("cannot move an approved root itself or anything outside a root", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura1" });
    fixture.redirectRealpath(path.join(documents, "factura1.pdf"), documents);
    await expect(service.prepareMove({ ordinals: [1], destinationRoot: "DOWNLOADS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    await expect(service.prepareMove({ ordinals: [1], destinationRoot: "SYSTEM" })).resolves.toMatchObject({ ok: false });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("requires a real, non-symlink directory inside an approved root as destination", async () => {
    const { service, fixture } = createHarness((f) => { setup(f); f.addFile(path.join(documents, "esfolder")); });
    await service.search({ query: "esfolder" });
    await expect(service.prepareMove({ ordinals: [1], destinationOrdinal: 1 })).resolves.toMatchObject({ ok: false, error: { code: "FILES_DESTINATION_INVALID" } });
    await service.search({ query: "factura1" });
    await expect(service.prepareMove({ ordinals: [1] })).resolves.toMatchObject({ ok: false, error: { code: "FILES_DESTINATION_INVALID" } });
    await service.search({ query: "Archivo" });
    fixture.addSymlink(path.join(documents, "Archivo"));
    await expect(service.prepareMove({ ordinals: [1], destinationOrdinal: 1 })).resolves.toMatchObject({ ok: false });
  });

  it("rejects an invalid selection shape or a typed path", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "factura" });
    for (const input of [
      { destinationRoot: "DOWNLOADS" },
      { ordinals: [], destinationRoot: "DOWNLOADS" },
      { ordinals: [1, 1], destinationRoot: "DOWNLOADS" },
      { ordinals: [11], destinationRoot: "DOWNLOADS" },
      { ordinals: [1], all: true, destinationRoot: "DOWNLOADS" },
      { all: false, destinationRoot: "DOWNLOADS" },
      { ordinals: [1], destinationRoot: "DOWNLOADS", destinationPath: "C:\\x" },
      { ordinals: [1], destination: "C:\\Windows" }
    ]) {
      await expect(service.prepareMove(input)).resolves.toMatchObject({ ok: false });
    }
  });

  it("re-validates every item and the destination at confirm", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura" });
    const prepared = await service.prepareMove({ ordinals: [1, 2], destinationRoot: "DOWNLOADS" });
    if (!prepared.ok) throw new Error("Expected a prepared move.");
    fixture.remove(path.join(documents, "factura2.pdf"));
    await expect(service.commitMove(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_TARGET_NOT_FOUND" } });
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();

    const second = createHarness(setup);
    await second.service.search({ query: "factura" });
    const preparedAgain = await second.service.prepareMove({ ordinals: [1, 2], destinationRoot: "DOWNLOADS" });
    if (!preparedAgain.ok) throw new Error("Expected a prepared move.");
    second.fixture.addFile(path.join(downloads, "factura1.pdf"));
    await expect(second.service.commitMove(preparedAgain.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(second.fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("reports a controlled failure for another volume (EXDEV) and never falls back to copying", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura1" });
    const prepared = await service.prepareMove({ ordinals: [1], destinationRoot: "DOWNLOADS" });
    if (!prepared.ok) throw new Error("Expected a prepared move.");
    fixture.failRenameFor(path.join(documents, "factura1.pdf"), "EXDEV");
    const result = await service.commitMove(prepared.data.preparedId);
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_OPERATION_FAILED", counts: { moved: 0, failed: 1 } } });
    expect(JSON.stringify(result)).not.toMatch(/EXDEV|Users|factura/);
    expect(fixture.renameCalls).toHaveLength(1);
  });

  it("stops at the first mid-way failure, reports counts only, and invalidates the last search", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura" });
    const prepared = await service.prepareMove({ ordinals: [1, 2], destinationRoot: "DOWNLOADS" });
    if (!prepared.ok) throw new Error("Expected a prepared move.");
    fixture.failRenameFor(path.join(documents, "factura2.pdf"), "EBUSY");
    const result = await service.commitMove(prepared.data.preparedId);
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_PARTIAL_COMPLETION", counts: { moved: 1, failed: 1 } } });
    expect(JSON.stringify(result)).not.toMatch(/EBUSY|Users|factura/);
    expect(service.getActiveSearchInfo()).toBeUndefined();
  });

  it("invalidates the last search after a successful move, so no ordinal points to an old path", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "factura" });
    const prepared = await service.prepareMove({ ordinals: [1], destinationRoot: "DOWNLOADS" });
    if (!prepared.ok) throw new Error("Expected a prepared move.");
    await service.commitMove(prepared.data.preparedId);
    expect(service.getActiveSearchInfo()).toBeUndefined();
  });

  it("executes a prepared move only once", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura1" });
    const prepared = await service.prepareMove({ ordinals: [1], destinationRoot: "DOWNLOADS" });
    if (!prepared.ok) throw new Error("Expected a prepared move.");
    await service.commitMove(prepared.data.preparedId);
    await expect(service.commitMove(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    expect(fixture.renameCalls).toHaveLength(1);
  });
});

describe("organize", () => {
  const setup = (fixture: VirtualFilesystem) => {
    fixture.addFile(path.join(downloads, "factura1.pdf"));
    fixture.addFile(path.join(downloads, "factura2.pdf"));
  };

  it("creates the destination folder only when missing, inside the approved root, in one confirmed operation", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura" });
    const prepared = await service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS" });
    expect(prepared).toEqual({
      ok: true,
      data: { preparedId: "prepared-1", itemCount: 2, folderName: "Facturas", createFolder: true, destinationLabel: "Documentos" }
    });
    expect(fixture.mkdirCalls).toEqual([]);
    expect(fixture.renameCalls).toEqual([]);
    await expect(service.commitOrganize("prepared-1")).resolves.toEqual({ ok: true, data: { movedCount: 2, failedCount: 0 } });
    expect(fixture.mkdirCalls).toEqual([path.join(documents, "Facturas")]);
    expect(fixture.renameCalls.map(([from]) => path.basename(from))).toEqual(["factura1.pdf", "factura2.pdf"]);
    expect(fixture.renameCalls.every(([, to]) => to.startsWith(path.join(documents, "Facturas")))).toBe(true);
  });

  it("moves into an existing folder without creating it", async () => {
    const { service, fixture } = createHarness((f) => { setup(f); f.addDir(path.join(documents, "Facturas")); });
    await service.search({ query: "factura", root: "DOWNLOADS" });
    const prepared = await service.prepareOrganize({ ordinals: [1], folderName: "facturas", root: "DOCUMENTS" });
    expect(prepared).toMatchObject({ ok: true, data: { createFolder: false } });
    if (!prepared.ok) throw new Error("Expected a prepared organize.");
    await service.commitOrganize(prepared.data.preparedId);
    expect(fixture.mkdirCalls).toEqual([]);
  });

  it("applies the folder-name rules and requires an approved root", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura" });
    for (const folderName of ["CON", "a/b", "..", "", "fin.", "x".repeat(65)]) {
      await expect(service.prepareOrganize({ all: true, folderName, root: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_INVALID_NAME" } });
    }
    await expect(service.prepareOrganize({ all: true, folderName: "Facturas", root: "C:\\" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    await expect(service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS", path: "C:\\x" })).resolves.toMatchObject({ ok: false });
    expect(fixture.mkdirCalls).toEqual([]);
  });

  it("rejects a destination that exists as a file, a symlink, or a collision", async () => {
    const asFile = createHarness((f) => { setup(f); f.addFile(path.join(documents, "Facturas")); });
    await asFile.service.search({ query: "factura", root: "DOWNLOADS" });
    await expect(asFile.service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_DESTINATION_INVALID" } });

    const asLink = createHarness((f) => { setup(f); f.addSymlink(path.join(documents, "Facturas")); });
    await asLink.service.search({ query: "factura", root: "DOWNLOADS" });
    await expect(asLink.service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_DESTINATION_INVALID" } });

    const collision = createHarness((f) => { setup(f); f.addDir(path.join(documents, "Facturas")); f.addFile(path.join(documents, "Facturas", "FACTURA1.PDF")); });
    await collision.service.search({ query: "factura", root: "DOWNLOADS" });
    await expect(collision.service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(collision.fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("refuses to organize a folder into itself", async () => {
    const { service } = createHarness((f) => { f.addDir(path.join(documents, "Facturas")); });
    await service.search({ query: "Facturas", root: "DOCUMENTS" });
    await expect(service.prepareOrganize({ ordinals: [1], folderName: "Facturas", root: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_DESTINATION_INVALID" } });
  });

  it("aborts at confirm if the planned folder appeared or vanished meanwhile", async () => {
    const created = createHarness(setup);
    await created.service.search({ query: "factura" });
    const preparedCreate = await created.service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS" });
    if (!preparedCreate.ok) throw new Error("Expected a prepared organize.");
    created.fixture.addDir(path.join(documents, "Facturas"));
    await expect(created.service.commitOrganize(preparedCreate.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(created.fixture.filesystem.mkdir).not.toHaveBeenCalled();
    expect(created.fixture.filesystem.rename).not.toHaveBeenCalled();

    const vanished = createHarness((f) => { setup(f); f.addDir(path.join(documents, "Facturas")); });
    await vanished.service.search({ query: "factura", root: "DOWNLOADS" });
    const preparedMove = await vanished.service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS" });
    if (!preparedMove.ok) throw new Error("Expected a prepared organize.");
    vanished.fixture.remove(path.join(documents, "Facturas"));
    await expect(vanished.service.commitOrganize(preparedMove.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
  });

  it("reports counts only when the move stops after the folder was created", async () => {
    const { service, fixture } = createHarness(setup);
    await service.search({ query: "factura" });
    const prepared = await service.prepareOrganize({ all: true, folderName: "Facturas", root: "DOCUMENTS" });
    if (!prepared.ok) throw new Error("Expected a prepared organize.");
    fixture.failRenameFor(path.join(downloads, "factura2.pdf"), "EPERM");
    const result = await service.commitOrganize(prepared.data.preparedId);
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_PARTIAL_COMPLETION", counts: { moved: 1, failed: 1 } } });
    expect(JSON.stringify(result)).not.toMatch(/EPERM|Users|Facturas|factura/);
    expect(service.getActiveSearchInfo()).toBeUndefined();
  });

  it("never reads file contents: the port exposes no read operation", async () => {
    const { fixture } = createHarness(setup);
    expect(Object.keys(fixture.filesystem).sort()).toEqual(["lstat", "mkdir", "readdir", "realpath", "rename"]);
  });
});

describe("delete (Recycle Bin only)", () => {
  const setup = (fixture: VirtualFilesystem) => {
    fixture.addFile(path.join(documents, "viejo.txt"));
    fixture.addDir(path.join(documents, "Borrador"));
    fixture.addFile(path.join(documents, "Borrador", "dentro.txt"));
  };

  it("sends one entry to the Recycle Bin after confirm and touches the filesystem in no other way", async () => {
    const { service, fixture, trashItem } = createHarness(setup);
    await service.search({ query: "viejo" });
    const prepared = await service.prepareDelete(1);
    expect(prepared).toEqual({ ok: true, data: { preparedId: "prepared-1", displayName: "viejo.txt", kind: "DOCUMENT", rootLabel: "Documentos" } });
    expect(trashItem).not.toHaveBeenCalled();
    await expect(service.commitDelete("prepared-1")).resolves.toEqual({ ok: true, data: { trashed: true } });
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(path.join(documents, "viejo.txt"));
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
    expect(fixture.filesystem.mkdir).not.toHaveBeenCalled();
  });

  it("has no permanent-removal operation in the filesystem port at all", () => {
    const { fixture } = createHarness();
    for (const forbidden of ["rm", "unlink", "rmdir", "remove", "delete", "copyFile", "writeFile"]) {
      expect(forbidden in fixture.filesystem).toBe(false);
    }
  });

  it("describes a folder as a folder", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "Borrador" });
    await expect(service.prepareDelete(1)).resolves.toMatchObject({ ok: true, data: { kind: "FOLDER", displayName: "Borrador" } });
  });

  it("never falls back to a permanent deletion when the Recycle Bin fails", async () => {
    const { service, fixture, trashItem, logError } = createHarness(setup);
    trashItem.mockRejectedValueOnce(new Error("The Recycle Bin is unavailable at C:\\Users\\Juli\\Documents\\viejo.txt"));
    await service.search({ query: "viejo" });
    const prepared = await service.prepareDelete(1);
    if (!prepared.ok) throw new Error("Expected a prepared delete.");
    const result = await service.commitDelete(prepared.data.preparedId);
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_RECYCLE_UNAVAILABLE" } });
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(/Recycle Bin is|Users|viejo/);
    expect(trashItem).toHaveBeenCalledOnce();
    expect(fixture.exists(path.join(documents, "viejo.txt"))).toBe(true);
    expect(fixture.filesystem.rename).not.toHaveBeenCalled();
  });

  it("rejects roots, symlinks, and entries whose real path leaves the root", async () => {
    const { service, fixture, trashItem } = createHarness(setup);
    await service.search({ query: "viejo" });
    fixture.redirectRealpath(path.join(documents, "viejo.txt"), "C:\\Windows\\viejo.txt");
    await expect(service.prepareDelete(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });

    const second = createHarness(setup);
    await second.service.search({ query: "viejo" });
    second.fixture.redirectRealpath(path.join(documents, "viejo.txt"), documents);
    await expect(second.service.prepareDelete(1)).resolves.toMatchObject({ ok: false });

    const third = createHarness(setup);
    await third.service.search({ query: "viejo" });
    third.fixture.addSymlink(path.join(documents, "viejo.txt"));
    await expect(third.service.prepareDelete(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    expect(trashItem).not.toHaveBeenCalled();
  });

  it("re-validates at confirm and sends nothing when the target changed", async () => {
    const { service, fixture, trashItem } = createHarness(setup);
    await service.search({ query: "viejo" });
    const prepared = await service.prepareDelete(1);
    if (!prepared.ok) throw new Error("Expected a prepared delete.");
    fixture.remove(path.join(documents, "viejo.txt"));
    await expect(service.commitDelete(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_TARGET_NOT_FOUND" } });

    const second = createHarness(setup);
    await second.service.search({ query: "viejo" });
    const preparedAgain = await second.service.prepareDelete(1);
    if (!preparedAgain.ok) throw new Error("Expected a prepared delete.");
    second.fixture.redirectRealpath(path.join(documents, "viejo.txt"), "C:\\Windows\\viejo.txt");
    await expect(second.service.commitDelete(preparedAgain.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    expect(trashItem).not.toHaveBeenCalled();
    expect(second.trashItem).not.toHaveBeenCalled();
  });

  it("accepts exactly one ordinal and uses each preparation only once", async () => {
    const { service, trashItem } = createHarness(setup);
    await service.search({ query: "viejo" });
    for (const input of [[1, 2], { ordinal: 1 }, 0, 11, 1.5, "1", undefined, null]) {
      await expect(service.prepareDelete(input)).resolves.toMatchObject({ ok: false });
    }
    const prepared = await service.prepareDelete(1);
    if (!prepared.ok) throw new Error("Expected a prepared delete.");
    await service.commitDelete(prepared.data.preparedId);
    await expect(service.commitDelete(prepared.data.preparedId)).resolves.toMatchObject({ ok: false });
    expect(trashItem).toHaveBeenCalledOnce();
  });

  it("invalidates the last search after a deletion so ordinals cannot shift onto another item", async () => {
    const { service } = createHarness(setup);
    await service.search({ query: "o" });
    const prepared = await service.prepareDelete(1);
    if (!prepared.ok) throw new Error("Expected a prepared delete.");
    await service.commitDelete(prepared.data.preparedId);
    expect(service.getActiveSearchInfo()).toBeUndefined();
    await expect(service.prepareDelete(2)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
  });

  it("never deletes without an explicit prepared search selection", async () => {
    const { service, trashItem } = createHarness(setup);
    await expect(service.prepareDelete(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    await expect(service.commitDelete("anything")).resolves.toMatchObject({ ok: false });
    expect(trashItem).not.toHaveBeenCalled();
  });
});

describe("logs and results carry no names or paths", () => {
  it("logs only constant messages across failing mutations", async () => {
    const { service, fixture, logError } = createHarness((f) => {
      f.addFile(path.join(documents, "secreto.txt"));
      f.addFile(path.join(downloads, "secreto2.txt"));
    });
    await searchAll(service, "secreto");
    const prepared = await service.prepareMove({ ordinals: [1], destinationRoot: "DOWNLOADS" });
    if (!prepared.ok) throw new Error("Expected a prepared move.");
    fixture.failRenameFor(path.join(documents, "secreto.txt"), "EACCES");
    const result = await service.commitMove(prepared.data.preparedId);
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(/secreto|Users|EACCES|C:\\/);
  });
});
