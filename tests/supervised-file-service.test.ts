import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LAST_SEARCH_LIFETIME_MS,
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_RESULTS,
  MAX_VISITED_ENTRIES,
  createSupervisedFileService,
  type SupervisedFilesystem
} from "../src/main/files/supervised-file-service";
import {
  BLOCKED_OPEN_EXTENSIONS,
  validateFolderName,
  validateSearchQuery
} from "../src/main/files/supervised-file-validation";
import { SUPERVISED_FILE_ROOTS, type SupervisedFileRoot } from "../src/shared/supervised-file-contracts";

type Node = { type: "dir" | "file" | "symlink" };

const HOME = "C:\\Users\\Juli";
const folderFor = (root: SupervisedFileRoot): string =>
  path.join(HOME, { DESKTOP: "Desktop", DOCUMENTS: "Documents", DOWNLOADS: "Downloads", PICTURES: "Pictures", MUSIC: "Music", VIDEOS: "Videos" }[root]);

/** A small in-memory filesystem; nothing here touches the real disk. */
const createFixture = () => {
  const nodes = new Map<string, Node>();
  const realpaths = new Map<string, string>();
  const key = (value: string) => path.resolve(value).toLocaleLowerCase("en-US");
  const put = (target: string, type: Node["type"]) => { nodes.set(key(target), { type }); };
  const addDir = (target: string) => put(target, "dir");
  const addFile = (target: string) => put(target, "file");
  const addSymlink = (target: string) => put(target, "symlink");
  for (const root of SUPERVISED_FILE_ROOTS) addDir(folderFor(root));

  const missing = () => Object.assign(new Error("private detail C:\\Users\\Juli"), { code: "ENOENT" });
  const childrenOf = (directory: string) =>
    [...nodes.entries()]
      .filter(([candidate]) => path.dirname(candidate) === key(directory) && candidate !== key(directory))
      .map(([candidate, node]) => ({
        name: path.basename(candidate),
        node,
        original: candidate
      }));
  const names = new Map<string, string>();
  const register = (target: string) => { names.set(key(target), path.basename(target)); };
  const trackedAdd = (target: string, type: Node["type"]) => { put(target, type); register(target); };

  const mkdirCalls: unknown[][] = [];
  const filesystem: SupervisedFilesystem = {
    readdir: vi.fn(async (directory: string) => {
      const node = nodes.get(key(directory));
      if (!node || node.type !== "dir") throw missing();
      return childrenOf(directory).map(({ name, node: child, original }) => {
        const displayName = names.get(original) ?? name;
        return {
          name: displayName,
          isDirectory: () => child.type === "dir",
          isSymbolicLink: () => child.type === "symlink"
        };
      });
    }),
    lstat: vi.fn(async (target: string) => {
      const node = nodes.get(key(target));
      if (!node) throw missing();
      return { isDirectory: () => node.type === "dir", isSymbolicLink: () => node.type === "symlink" };
    }),
    realpath: vi.fn(async (target: string) => {
      const override = realpaths.get(key(target));
      if (override) return override;
      if (!nodes.has(key(target))) throw missing();
      return target;
    }),
    rename: vi.fn(async () => undefined),
    mkdir: vi.fn(async (...args: unknown[]) => {
      mkdirCalls.push(args);
      const target = args[0] as string;
      if (nodes.has(key(target))) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      if (nodes.get(key(path.dirname(target)))?.type !== "dir") throw missing();
      trackedAdd(target, "dir");
    })
  };
  const remove = (target: string) => { nodes.delete(key(target)); };
  return {
    filesystem,
    mkdirCalls,
    remove,
    addDir: (target: string) => trackedAdd(target, "dir"),
    addFile: (target: string) => trackedAdd(target, "file"),
    addSymlink: (target: string) => trackedAdd(target, "symlink"),
    redirectRealpath: (target: string, destination: string) => { realpaths.set(key(target), destination); }
  };
};

const createService = (options: { now?: () => number; fixture?: ReturnType<typeof createFixture> } = {}) => {
  const fixture = options.fixture ?? createFixture();
  const showItemInFolder = vi.fn();
  const openPath = vi.fn(async (_target: string) => "");
  const logError = vi.fn();
  let counter = 0;
  const service = createSupervisedFileService({
    filesystem: fixture.filesystem,
    shell: { showItemInFolder, openPath, trashItem: vi.fn() },
    getKnownFolder: folderFor,
    now: options.now ?? (() => 1_000),
    generateIdentifier: () => `prepared-${++counter}`,
    logError
  });
  return { service, fixture, showItemInFolder, openPath, logError };
};

describe("supervised search matching", () => {
  it("matches case- and accent-insensitively on the entry name only", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "Currículum Vitae.PDF"));
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "notas.txt"));
    const result = await service.search({ query: "CURRICULUM" });
    expect(result).toMatchObject({ ok: true, data: { resultCount: 1, partial: false, items: [{ ordinal: 1, name: "Currículum Vitae.PDF", kind: "DOCUMENT", rootLabel: "Documentos" }] } });
  });

  it("finds an accented name from an unaccented query and the reverse", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DESKTOP"), "informe.docx"));
    await expect(service.search({ query: "InFórmé" })).resolves.toMatchObject({ ok: true, data: { resultCount: 1 } });
  });

  it("applies the closed kind filter through fixed extension sets", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DOWNLOADS"), "plan.pdf"));
    fixture.addFile(path.join(folderFor("DOWNLOADS"), "plan.png"));
    fixture.addFile(path.join(folderFor("DOWNLOADS"), "plan.mp3"));
    fixture.addFile(path.join(folderFor("DOWNLOADS"), "plan.mp4"));
    fixture.addDir(path.join(folderFor("DOWNLOADS"), "plan carpeta"));
    const kinds = async (kind: string) => {
      const result = await service.search({ query: "plan", kind });
      return result.ok ? result.data.items.map((item) => item.kind).sort() : [];
    };
    expect(await kinds("DOCUMENT")).toEqual(["DOCUMENT"]);
    expect(await kinds("IMAGE")).toEqual(["IMAGE"]);
    expect(await kinds("AUDIO")).toEqual(["AUDIO"]);
    expect(await kinds("VIDEO")).toEqual(["VIDEO"]);
    expect(await kinds("FOLDER")).toEqual(["FOLDER"]);
    expect((await kinds("ANY")).length).toBe(5);
  });

  it("searches one approved root or all of them", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("MUSIC"), "tema.mp3"));
    fixture.addFile(path.join(folderFor("VIDEOS"), "tema.mp4"));
    await expect(service.search({ query: "tema", root: "MUSIC" })).resolves.toMatchObject({ ok: true, data: { resultCount: 1 } });
    await expect(service.search({ query: "tema" })).resolves.toMatchObject({ ok: true, data: { resultCount: 2 } });
  });

  it("never matches file contents or the directory path, only the entry name", async () => {
    const { service, fixture } = createService();
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "proyecto"));
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "proyecto", "datos.txt"));
    await expect(service.search({ query: "proyecto", kind: "DOCUMENT" })).resolves.toMatchObject({ ok: true, data: { resultCount: 0 } });
  });

  it.each([
    "..\\secret", "C:\\Windows", "a/b", "a\\b", "*.pdf", "inf?rme", "http://example.com", "www.example.com",
    "", "   ", "x".repeat(65), "bad\u0000name", "~root", "a|b", "a<b", "a\"b"
  ])("rejects the path-like or invalid query %j", async (query) => {
    const { service } = createService();
    expect(validateSearchQuery(query)).toBeUndefined();
    await expect(service.search({ query })).resolves.toMatchObject({ ok: false, error: { code: "FILES_INVALID_QUERY" } });
  });

  it("rejects unknown fields, unknown roots, and unknown kinds", async () => {
    const { service } = createService();
    await expect(service.search({ query: "a", path: "C:\\x" })).resolves.toMatchObject({ ok: false });
    await expect(service.search({ query: "a", root: "SYSTEM" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    await expect(service.search({ query: "a", kind: "EXECUTABLE" })).resolves.toMatchObject({ ok: false });
    await expect(service.search("a")).resolves.toMatchObject({ ok: false });
  });
});

describe("supervised search bounds and skipping", () => {
  it("reports partial results when more than ten entries match and returns exactly ten", async () => {
    const { service, fixture } = createService();
    for (let index = 0; index < MAX_SEARCH_RESULTS + 2; index += 1) fixture.addFile(path.join(folderFor("DOCUMENTS"), `foto ${index}.png`));
    const result = await service.search({ query: "foto" });
    expect(result).toMatchObject({ ok: true, data: { resultCount: MAX_SEARCH_RESULTS, partial: true } });
    expect(result.ok && result.data.items.map((item) => item.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("does not report partial results for exactly ten matches", async () => {
    const { service, fixture } = createService();
    for (let index = 0; index < MAX_SEARCH_RESULTS; index += 1) fixture.addFile(path.join(folderFor("DOCUMENTS"), `foto ${index}.png`));
    await expect(service.search({ query: "foto" })).resolves.toMatchObject({ ok: true, data: { resultCount: 10, partial: false } });
  });

  it("stops at the depth bound and flags the result as partial", async () => {
    const { service, fixture } = createService();
    let current = folderFor("DOCUMENTS");
    for (let level = 1; level <= MAX_SEARCH_DEPTH + 2; level += 1) {
      current = path.join(current, `nivel${level}`);
      fixture.addDir(current);
    }
    fixture.addFile(path.join(current, "tesoro.pdf"));
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "nivel1", "visible tesoro.pdf"));
    const result = await service.search({ query: "tesoro", root: "DOCUMENTS" });
    expect(result).toMatchObject({ ok: true, data: { resultCount: 1, partial: true } });
    expect(result.ok && result.data.items[0]?.name).toBe("visible tesoro.pdf");
  });

  it("finds an entry located exactly at the maximum depth", async () => {
    const { service, fixture } = createService();
    let current = folderFor("DOCUMENTS");
    for (let level = 1; level < MAX_SEARCH_DEPTH; level += 1) {
      current = path.join(current, `n${level}`);
      fixture.addDir(current);
    }
    fixture.addFile(path.join(current, "limite.pdf"));
    await expect(service.search({ query: "limite", root: "DOCUMENTS" })).resolves.toMatchObject({ ok: true, data: { resultCount: 1 } });
  });

  it("stops after the visited-entry bound and flags the result as partial", async () => {
    const { service, fixture } = createService();
    const readdir = vi.fn(async () => Array.from({ length: MAX_VISITED_ENTRIES + 5 }, (_unused, index) => ({
      name: `relleno${index}.dat`,
      isDirectory: () => false,
      isSymbolicLink: () => false
    })));
    const bounded = createSupervisedFileService({
      filesystem: { ...fixture.filesystem, readdir },
      shell: { showItemInFolder: vi.fn(), openPath: vi.fn(), trashItem: vi.fn() },
      getKnownFolder: folderFor,
      now: () => 1_000,
      logError: vi.fn()
    });
    const result = await bounded.search({ query: "no-existe", root: "DOCUMENTS" });
    expect(result).toMatchObject({ ok: true, data: { resultCount: 0, partial: true } });
  });

  it("stops after five seconds and flags the result as partial", async () => {
    let clock = 0;
    const fixture = createFixture();
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "a"));
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "b"));
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "b", "objetivo.pdf"));
    const original = fixture.filesystem.readdir;
    fixture.filesystem.readdir = vi.fn(async (directory: string) => { clock += 6_000; return original(directory); });
    const { service } = createService({ now: () => clock, fixture });
    const result = await service.search({ query: "objetivo", root: "DOCUMENTS" });
    expect(result).toMatchObject({ ok: true, data: { resultCount: 0, partial: true } });
  });

  it("skips symlinks and junctions, hidden entries, system files, and well-known noise folders", async () => {
    const { service, fixture } = createService();
    const documents = folderFor("DOCUMENTS");
    fixture.addSymlink(path.join(documents, "enlace buscado"));
    fixture.addFile(path.join(documents, ".buscado-oculto"));
    fixture.addFile(path.join(documents, "$buscado"));
    fixture.addDir(path.join(documents, "node_modules"));
    fixture.addFile(path.join(documents, "node_modules", "buscado.js"));
    fixture.addDir(path.join(documents, ".git"));
    fixture.addFile(path.join(documents, ".git", "buscado"));
    fixture.addDir(path.join(documents, "AppData"));
    fixture.addFile(path.join(documents, "AppData", "buscado.cfg"));
    fixture.addDir(path.join(documents, "real"));
    fixture.addSymlink(path.join(documents, "real", "salto"));
    fixture.addFile(path.join(documents, "real", "buscado visible.txt"));
    const result = await service.search({ query: "buscado", root: "DOCUMENTS" });
    expect(result.ok && result.data.items.map((item) => item.name)).toEqual(["buscado visible.txt"]);
    expect(fixture.filesystem.readdir).not.toHaveBeenCalledWith(path.join(documents, "node_modules"));
    expect(fixture.filesystem.readdir).not.toHaveBeenCalledWith(path.join(documents, "salto"));
  });

  it("returns nothing a renderer, provider, or history could use as an absolute path", async () => {
    const { service, fixture, logError } = createService();
    fixture.addFile(path.join(folderFor("DOWNLOADS"), "contrato.pdf"));
    const result = await service.search({ query: "contrato" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/C:\\|Users|Downloads|absolutePath|\\\\/);
    expect(serialized).toContain("Descargas");
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/C:\\|Users|contrato/);
  });

  it("fails with a controlled code when no approved root can be resolved", async () => {
    const fixture = createFixture();
    const broken = createSupervisedFileService({
      filesystem: { ...fixture.filesystem, realpath: vi.fn(async () => { throw new Error("private C:\\detail"); }) },
      shell: { showItemInFolder: vi.fn(), openPath: vi.fn(), trashItem: vi.fn() },
      getKnownFolder: folderFor,
      logError: vi.fn()
    });
    const result = await broken.search({ query: "algo" });
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_OPERATION_FAILED" } });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

describe("last-search store", () => {
  it("expires after ten minutes", async () => {
    let clock = 0;
    const { service, fixture } = createService({ now: () => clock });
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "dato.pdf"));
    await service.search({ query: "dato" });
    clock = LAST_SEARCH_LIFETIME_MS - 1;
    await expect(service.revealFound(1)).resolves.toMatchObject({ ok: true });
    clock = LAST_SEARCH_LIFETIME_MS + 1;
    await expect(service.revealFound(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
  });

  it("is replaced by every new search, even one with no results", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "uno.pdf"));
    await service.search({ query: "uno" });
    await service.search({ query: "inexistente" });
    await expect(service.revealFound(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
  });

  it("assigns ordinals starting at one and rejects out-of-range ordinals", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "a1.pdf"));
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "a2.pdf"));
    const result = await service.search({ query: "a" });
    expect(result.ok && result.data.items.map((item) => item.ordinal)).toEqual([1, 2]);
    for (const ordinal of [0, 3, 11, -1, 1.5, "1", null, undefined]) {
      await expect(service.revealFound(ordinal)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    }
  });
});

describe("reveal", () => {
  it("shows the found entry only after re-validating it", async () => {
    const { service, fixture, showItemInFolder } = createService();
    const file = path.join(folderFor("DOCUMENTS"), "cv.pdf");
    fixture.addFile(file);
    await service.search({ query: "cv" });
    await expect(service.revealFound(1)).resolves.toEqual({ ok: true, data: { revealed: true } });
    expect(showItemInFolder).toHaveBeenCalledWith(file);
  });

  it("fails as stale when the file disappeared", async () => {
    const { service, fixture, showItemInFolder } = createService();
    const file = path.join(folderFor("DOCUMENTS"), "cv.pdf");
    fixture.addFile(file);
    await service.search({ query: "cv" });
    fixture.remove(file);
    await expect(service.revealFound(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it("fails when the entry was replaced by a symlink", async () => {
    const { service, fixture, showItemInFolder } = createService();
    const file = path.join(folderFor("DOCUMENTS"), "cv.pdf");
    fixture.addFile(file);
    await service.search({ query: "cv" });
    fixture.addSymlink(file);
    await expect(service.revealFound(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it("fails when the real path now points outside the approved root", async () => {
    const { service, fixture, showItemInFolder } = createService();
    const file = path.join(folderFor("DOCUMENTS"), "cv.pdf");
    fixture.addFile(file);
    await service.search({ query: "cv" });
    fixture.redirectRealpath(file, "C:\\Windows\\System32\\cv.pdf");
    await expect(service.revealFound(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    expect(showItemInFolder).not.toHaveBeenCalled();
  });
});

describe("open", () => {
  it.each([...BLOCKED_OPEN_EXTENSIONS])("blocks %s files", async (extension) => {
    const { service, fixture, openPath } = createService();
    fixture.addFile(path.join(folderFor("DOWNLOADS"), `programa${extension}`));
    await service.search({ query: "programa" });
    await expect(service.prepareOpen(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_TYPE_BLOCKED" } });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("blocks blocklisted types regardless of letter case and files with no extension", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DOWNLOADS"), "setup.EXE"));
    fixture.addFile(path.join(folderFor("DOWNLOADS"), "setupsinextension"));
    await service.search({ query: "setup" });
    await expect(service.prepareOpen(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_TYPE_BLOCKED" } });
    await expect(service.prepareOpen(2)).resolves.toMatchObject({ ok: false, error: { code: "FILES_TYPE_BLOCKED" } });
  });

  it("allows folders and ordinary documents", async () => {
    const { service, fixture } = createService();
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "tarea carpeta"));
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "tarea.pdf"));
    await service.search({ query: "tarea" });
    await expect(service.prepareOpen(1)).resolves.toMatchObject({ ok: true });
    await expect(service.prepareOpen(2)).resolves.toMatchObject({ ok: true });
  });

  it("returns a display name and a root label, never a path", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "tesis.pdf"));
    await service.search({ query: "tesis" });
    const prepared = await service.prepareOpen(1);
    expect(prepared).toMatchObject({ ok: true, data: { displayName: "tesis.pdf", rootLabel: "Documentos" } });
    expect(JSON.stringify(prepared)).not.toMatch(/C:\\|Users/);
  });

  it("fails as stale for an unknown ordinal before preparing anything", async () => {
    const { service } = createService();
    await expect(service.prepareOpen(1)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
  });

  it("opens the validated Main-held path once, after confirmation, and never twice", async () => {
    const { service, fixture, openPath } = createService();
    const file = path.join(folderFor("DOCUMENTS"), "tesis.pdf");
    fixture.addFile(file);
    await service.search({ query: "tesis" });
    const prepared = await service.prepareOpen(1);
    if (!prepared.ok) throw new Error("Expected a prepared open.");
    expect(openPath).not.toHaveBeenCalled();
    await expect(service.commitOpen(prepared.data.preparedId)).resolves.toEqual({ ok: true, data: { opened: true } });
    expect(openPath).toHaveBeenCalledWith(file);
    await expect(service.commitOpen(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    expect(openPath).toHaveBeenCalledOnce();
  });

  it("re-validates again at confirm and opens nothing when the file is gone", async () => {
    const { service, fixture, openPath } = createService();
    const file = path.join(folderFor("DOCUMENTS"), "tesis.pdf");
    fixture.addFile(file);
    await service.search({ query: "tesis" });
    const prepared = await service.prepareOpen(1);
    if (!prepared.ok) throw new Error("Expected a prepared open.");
    fixture.remove(file);
    await expect(service.commitOpen(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("opens the entry that was prepared even if a new search replaced the store before confirm", async () => {
    const { service, fixture, openPath } = createService();
    const file = path.join(folderFor("DOCUMENTS"), "tesis.pdf");
    fixture.addFile(file);
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "otro.pdf"));
    await service.search({ query: "tesis" });
    const prepared = await service.prepareOpen(1);
    if (!prepared.ok) throw new Error("Expected a prepared open.");
    await service.search({ query: "otro" });
    await service.commitOpen(prepared.data.preparedId);
    expect(openPath).toHaveBeenCalledWith(file);
  });

  it("rejects unknown, forged, and expired preparation references", async () => {
    let clock = 0;
    const { service, fixture, openPath } = createService({ now: () => clock });
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "tesis.pdf"));
    await service.search({ query: "tesis" });
    await expect(service.commitOpen("forged")).resolves.toMatchObject({ ok: false });
    await expect(service.commitOpen(undefined)).resolves.toMatchObject({ ok: false });
    const prepared = await service.prepareOpen(1);
    if (!prepared.ok) throw new Error("Expected a prepared open.");
    clock += 6 * 60 * 1000;
    await expect(service.commitOpen(prepared.data.preparedId)).resolves.toMatchObject({ ok: false });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("maps an operating-system open failure to a controlled code without its text", async () => {
    const { service, fixture, openPath } = createService();
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "tesis.pdf"));
    openPath.mockResolvedValueOnce("The system cannot find C:\\Users\\Juli\\tesis.pdf");
    await service.search({ query: "tesis" });
    const prepared = await service.prepareOpen(1);
    if (!prepared.ok) throw new Error("Expected a prepared open.");
    const result = await service.commitOpen(prepared.data.preparedId);
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_OPERATION_FAILED" } });
    expect(JSON.stringify(result)).not.toMatch(/system cannot|Users/);
  });
});

describe("folder name validation", () => {
  it.each(["Fotos", "Proyecto 2026", "a", "Año nuevo", "x".repeat(64), "carpeta.v2", "con_ñandú"])("accepts %j", (name) => {
    expect(validateFolderName(name)).toBe(name);
  });

  it.each([
    "", "   ", ".", "..", "a..b", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "x".repeat(65),
    "punto.", "bad\u0001name", "tab\tname",
    "CON", "prn", "Aux", "NUL", "COM1", "com9", "LPT1", "lpt9", "con.txt", "NUL.log"
  ])("rejects %j", (name) => {
    expect(validateFolderName(name)).toBeUndefined();
  });

  it("rejects a trailing space even though surrounding whitespace is trimmed first", () => {
    expect(validateFolderName("  Fotos  ")).toBe("Fotos");
    expect(validateFolderName("Fotos .")).toBeUndefined();
  });

  it("allows names that only look like reserved names", () => {
    expect(validateFolderName("COM10")).toBe("COM10");
    expect(validateFolderName("console")).toBe("console");
  });
});

describe("create folder", () => {
  const rootInput = { folderName: "Fotos", root: "DOCUMENTS" } as const;

  it("prepares without creating, then creates non-recursively after confirmation", async () => {
    const { service, fixture } = createService();
    const prepared = await service.prepareCreateFolder(rootInput);
    expect(prepared).toEqual({ ok: true, data: { preparedId: "prepared-1", folderName: "Fotos", locationLabel: "Documentos" } });
    expect(fixture.filesystem.mkdir).not.toHaveBeenCalled();
    await expect(service.commitCreateFolder("prepared-1")).resolves.toEqual({ ok: true, data: { created: true } });
    expect(fixture.mkdirCalls).toEqual([[path.join(folderFor("DOCUMENTS"), "Fotos")]]);
    expect(JSON.stringify(prepared)).not.toMatch(/C:\\|Users/);
  });

  it("never overwrites or merges: an existing target is reported at propose time", async () => {
    const { service, fixture } = createService();
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "Fotos"));
    await expect(service.prepareCreateFolder(rootInput)).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(fixture.filesystem.mkdir).not.toHaveBeenCalled();
  });

  it("treats an existing file with the same name as a conflict", async () => {
    const { service, fixture } = createService();
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "Fotos"));
    await expect(service.prepareCreateFolder(rootInput)).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
  });

  it("re-checks existence at confirm and creates nothing when the target appeared meanwhile", async () => {
    const { service, fixture } = createService();
    const prepared = await service.prepareCreateFolder(rootInput);
    if (!prepared.ok) throw new Error("Expected a prepared folder.");
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "Fotos"));
    await expect(service.commitCreateFolder(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
    expect(fixture.filesystem.mkdir).not.toHaveBeenCalled();
  });

  it("maps a creation race reported by the filesystem to the already-exists message", async () => {
    const { service, fixture } = createService();
    const prepared = await service.prepareCreateFolder(rootInput);
    if (!prepared.ok) throw new Error("Expected a prepared folder.");
    vi.mocked(fixture.filesystem.mkdir).mockRejectedValueOnce(Object.assign(new Error("exists"), { code: "EEXIST" }));
    await expect(service.commitCreateFolder(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_ALREADY_EXISTS" } });
  });

  it("reports a failed creation with a controlled code and no operating-system text", async () => {
    const { service, fixture, logError } = createService();
    const prepared = await service.prepareCreateFolder(rootInput);
    if (!prepared.ok) throw new Error("Expected a prepared folder.");
    vi.mocked(fixture.filesystem.mkdir).mockRejectedValueOnce(Object.assign(new Error("EACCES C:\\Users\\Juli\\Documents\\Fotos"), { code: "EACCES" }));
    const result = await service.commitCreateFolder(prepared.data.preparedId);
    expect(result).toMatchObject({ ok: false, error: { code: "FILES_OPERATION_FAILED" } });
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(/EACCES|Users|Fotos/);
  });

  it("never creates intermediate directories", async () => {
    const { service, fixture } = createService();
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "Padre"));
    await service.search({ query: "Padre", kind: "FOLDER" });
    const prepared = await service.prepareCreateFolder({ folderName: "Hijo", parentOrdinal: 1 });
    if (!prepared.ok) throw new Error("Expected a prepared folder.");
    fixture.remove(path.join(folderFor("DOCUMENTS"), "Padre"));
    await expect(service.commitCreateFolder(prepared.data.preparedId)).resolves.toMatchObject({ ok: false });
    expect(fixture.mkdirCalls).toEqual([]);
  });

  it("accepts a parent only as a folder entry from the last search", async () => {
    const { service, fixture } = createService();
    fixture.addDir(path.join(folderFor("DOCUMENTS"), "Proyectos"));
    fixture.addFile(path.join(folderFor("DOCUMENTS"), "Proyectos.pdf"));
    await service.search({ query: "Proyectos" });
    const prepared = await service.prepareCreateFolder({ folderName: "Nueva", parentOrdinal: 1 });
    expect(prepared).toMatchObject({ ok: true, data: { folderName: "Nueva", locationLabel: "Proyectos (Documentos)" } });
    await expect(service.prepareCreateFolder({ folderName: "Nueva", parentOrdinal: 2 })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    await expect(service.prepareCreateFolder({ folderName: "Nueva", parentOrdinal: 5 })).resolves.toMatchObject({ ok: false, error: { code: "FILES_STALE_SELECTION" } });
    await expect(service.prepareCreateFolder({ folderName: "Nueva", root: "MUSIC", parentOrdinal: 1 })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
  });

  it("requires a root when no parent entry is given and rejects typed paths or extra fields", async () => {
    const { service } = createService();
    await expect(service.prepareCreateFolder({ folderName: "Fotos" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    await expect(service.prepareCreateFolder({ folderName: "Fotos", root: "C:\\Windows" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    await expect(service.prepareCreateFolder({ folderName: "Fotos", root: "DOCUMENTS", path: "C:\\x" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_INVALID_NAME" } });
    await expect(service.prepareCreateFolder({ folderName: "..\\Fotos", root: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_INVALID_NAME" } });
    await expect(service.prepareCreateFolder("Fotos")).resolves.toMatchObject({ ok: false });
  });

  it("re-validates parent containment at propose and at confirm", async () => {
    const { service, fixture } = createService();
    const parent = path.join(folderFor("DOCUMENTS"), "Proyectos");
    fixture.addDir(parent);
    await service.search({ query: "Proyectos" });
    fixture.redirectRealpath(parent, "C:\\Windows\\System32");
    await expect(service.prepareCreateFolder({ folderName: "Nueva", parentOrdinal: 1 })).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });

    const second = createService();
    const secondParent = path.join(folderFor("DOCUMENTS"), "Proyectos");
    second.fixture.addDir(secondParent);
    await second.service.search({ query: "Proyectos" });
    const prepared = await second.service.prepareCreateFolder({ folderName: "Nueva", parentOrdinal: 1 });
    if (!prepared.ok) throw new Error("Expected a prepared folder.");
    second.fixture.redirectRealpath(secondParent, "C:\\Windows\\System32");
    await expect(second.service.commitCreateFolder(prepared.data.preparedId)).resolves.toMatchObject({ ok: false, error: { code: "FILES_OUT_OF_SCOPE" } });
    expect(second.fixture.filesystem.mkdir).not.toHaveBeenCalled();
  });

  it("refuses a parent that became a symlink", async () => {
    const { service, fixture } = createService();
    const parent = path.join(folderFor("DOCUMENTS"), "Proyectos");
    fixture.addDir(parent);
    await service.search({ query: "Proyectos" });
    fixture.addSymlink(parent);
    await expect(service.prepareCreateFolder({ folderName: "Nueva", parentOrdinal: 1 })).resolves.toMatchObject({ ok: false });
  });

  it("refuses an invalid name before touching the filesystem", async () => {
    const { service, fixture } = createService();
    for (const folderName of ["CON", "a/b", "", "x".repeat(65), "fin."]) {
      await expect(service.prepareCreateFolder({ folderName, root: "DOCUMENTS" })).resolves.toMatchObject({ ok: false, error: { code: "FILES_INVALID_NAME" } });
    }
    expect(fixture.filesystem.lstat).not.toHaveBeenCalledWith(expect.stringContaining("CON"));
    expect(fixture.filesystem.mkdir).not.toHaveBeenCalled();
  });
});
