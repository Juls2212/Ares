import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFileMutationService } from "../src/main/files/file-mutation-service";
import {
  validateCreateFolderInput,
  validateMoveFileInput,
  validateRenameFileInput,
  validateRenameFolderInput,
  validateSingleWindowsName
} from "../src/main/files/file-validation";

const documentsRoot = "C:\\Users\\Ares\\Documents";
const downloadsRoot = "C:\\Users\\Ares\\Downloads";

type NodeKind = "FILE" | "DIRECTORY" | "SYMLINK";

type NodeDefinition = {
  kind: NodeKind;
  canonicalPath?: string;
};

const createSystemError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const createStats = (node: NodeDefinition) => ({
  isFile: () => node.kind === "FILE",
  isDirectory: () => node.kind === "DIRECTORY",
  isSymbolicLink: () => node.kind === "SYMLINK"
});

const createMutationHarness = (overrides: Record<string, unknown> = {}) => {
  const nodes = new Map<string, NodeDefinition>();
  const roots = {
    DOCUMENTS: documentsRoot,
    DOWNLOADS: downloadsRoot,
    DESKTOP: "C:\\Users\\Ares\\Desktop"
  } as const;
  const rootResolver = {
    resolve: vi.fn(async (rootId: unknown) => {
      if (typeof rootId === "string" && rootId in roots) {
        return {
          ok: true as const,
          data: { rootId: rootId as keyof typeof roots, canonicalPath: roots[rootId as keyof typeof roots] }
        };
      }
      return {
        ok: false as const,
        error: { code: "FILE_ROOT_INVALID", userMessage: "La ubicación seleccionada no está autorizada." }
      };
    })
  };
  const lstat = vi.fn(async (targetPath: string) => {
    const node = nodes.get(targetPath);
    if (!node) throw createSystemError("ENOENT");
    return createStats(node);
  });
  const realpath = vi.fn(async (targetPath: string) => {
    const node = nodes.get(targetPath);
    if (!node) throw createSystemError("ENOENT");
    return node.canonicalPath ?? targetPath;
  });
  const mkdir = vi.fn(async (targetPath: string) => {
    if (nodes.has(targetPath)) throw createSystemError("EEXIST");
    nodes.set(targetPath, { kind: "DIRECTORY" });
  });
  const atomicMove = {
    moveNoReplace: vi.fn((sourcePath: string, destinationPath: string) => {
      const source = nodes.get(sourcePath);
      if (!source) return { ok: false as const, reason: "SOURCE_NOT_FOUND" as const };
      if (nodes.has(destinationPath)) return { ok: false as const, reason: "COLLISION" as const };
      nodes.delete(sourcePath);
      nodes.set(destinationPath, { ...source, canonicalPath: undefined });
      return { ok: true as const };
    })
  };
  const logError = vi.fn();
  const service = createFileMutationService({
    rootResolver,
    lstat,
    realpath,
    mkdir,
    atomicMove,
    logError,
    ...overrides
  });
  return { nodes, roots, rootResolver, lstat, realpath, mkdir, atomicMove, logError, service };
};

const addNode = (
  harness: ReturnType<typeof createMutationHarness>,
  parent: string,
  name: string,
  kind: NodeKind
): string => {
  const targetPath = path.win32.join(parent, name);
  harness.nodes.set(targetPath, { kind });
  return targetPath;
};

describe("file mutation validation", () => {
  it("accepts safe single-item mutation inputs without rewriting names", () => {
    expect(
      validateCreateFolderInput({
        parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" },
        name: "Invoices 2026"
      })
    ).toEqual({
      ok: true,
      data: {
        parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" },
        name: "Invoices 2026"
      }
    });
    expect(
      validateMoveFileInput({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" }
      })
    ).toMatchObject({ ok: true });
  });

  it.each([
    " ",
    " report",
    "report ",
    "report.",
    "CON",
    "LPT1.txt",
    "folder\\child",
    "..",
    "file.txt:stream",
    "C:\\Windows",
    "https://example.test",
    "report & calc",
    "report\u0000.txt"
  ])("rejects unsafe or reserved Windows names: %s", (name) => {
    expect(validateSingleWindowsName(name).ok).toBe(false);
  });

  it("rejects unknown keys, case-only no-op renames, and same-directory moves", () => {
    expect(validateCreateFolderInput({ parentDirectory: {}, name: "Work", recursive: true })).toMatchObject({
      ok: false,
      error: { code: "FILE_UNKNOWN_FIELD" }
    });
    expect(
      validateRenameFileInput({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        newName: "report.TXT"
      })
    ).toMatchObject({ ok: false, error: { code: "FILE_NO_OP" } });
    expect(
      validateMoveFileInput({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOCUMENTS", relativePath: "work" }
      })
    ).toMatchObject({ ok: false, error: { code: "FILE_NO_OP" } });
  });
});

describe("Main-only file mutation service", () => {
  it("creates exactly one directory after verifying its approved parent and collision state", async () => {
    const harness = createMutationHarness();
    const parent = addNode(harness, documentsRoot, "Work", "DIRECTORY");

    const result = await harness.service.createFolder({
      parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" },
      name: "Invoices"
    });

    const created = path.win32.join(parent, "Invoices");
    expect(harness.mkdir).toHaveBeenCalledWith(created);
    expect(result).toEqual({
      ok: true,
      data: {
        operation: "CREATE_FOLDER",
        entryType: "DIRECTORY",
        reference: { rootId: "DOCUMENTS", relativePath: "Work\\Invoices" }
      }
    });
    expect(JSON.stringify(result)).not.toContain(documentsRoot);
  });

  it("renames files and folders only within their verified canonical parent", async () => {
    const harness = createMutationHarness();
    const parent = addNode(harness, documentsRoot, "Work", "DIRECTORY");
    const file = addNode(harness, parent, "Report.txt", "FILE");
    const folder = addNode(harness, parent, "Archive", "DIRECTORY");

    await expect(
      harness.service.renameFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        newName: "Summary.txt"
      })
    ).resolves.toMatchObject({
      ok: true,
      data: { operation: "RENAME_FILE", reference: { relativePath: "Work\\Summary.txt" } }
    });
    await expect(
      harness.service.renameFolder({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Archive" },
        newName: "Archive 2026"
      })
    ).resolves.toMatchObject({
      ok: true,
      data: { operation: "RENAME_FOLDER", reference: { relativePath: "Work\\Archive 2026" } }
    });
    expect(harness.atomicMove.moveNoReplace).toHaveBeenNthCalledWith(
      1,
      file,
      path.win32.join(parent, "Summary.txt")
    );
    expect(harness.atomicMove.moveNoReplace).toHaveBeenNthCalledWith(
      2,
      folder,
      path.win32.join(parent, "Archive 2026")
    );
  });

  it("moves one verified file directly and preserves its filename", async () => {
    const harness = createMutationHarness();
    const sourceDirectory = addNode(harness, documentsRoot, "Work", "DIRECTORY");
    const source = addNode(harness, sourceDirectory, "Report.txt", "FILE");
    const destination = addNode(harness, downloadsRoot, "Archive", "DIRECTORY");

    const result = await harness.service.moveFile({
      source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
      destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" }
    });

    expect(harness.atomicMove.moveNoReplace).toHaveBeenCalledWith(
      source,
      path.win32.join(destination, "Report.txt")
    );
    expect(result).toEqual({
      ok: true,
      data: {
        operation: "MOVE_FILE",
        entryType: "FILE",
        reference: { rootId: "DOWNLOADS", relativePath: "Archive\\Report.txt" }
      }
    });
  });

  it("rejects containment escapes, wrong types, reparse points, and collisions before mutation", async () => {
    const escaped = createMutationHarness();
    const escapedParent = addNode(escaped, documentsRoot, "Work", "DIRECTORY");
    escaped.nodes.get(escapedParent)!.canonicalPath = "C:\\Windows";
    await expect(
      escaped.service.createFolder({
        parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" },
        name: "Invoices"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_MUTATION_FAILED" } });
    expect(escaped.mkdir).not.toHaveBeenCalled();

    const escapedDestination = createMutationHarness();
    const escapedSourceDirectory = addNode(escapedDestination, documentsRoot, "Work", "DIRECTORY");
    addNode(escapedDestination, escapedSourceDirectory, "Report.txt", "FILE");
    const escapedArchive = addNode(escapedDestination, downloadsRoot, "Archive", "DIRECTORY");
    escapedDestination.nodes.get(escapedArchive)!.canonicalPath = "C:\\Windows";
    await expect(
      escapedDestination.service.moveFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_MUTATION_FAILED" } });
    expect(escapedDestination.atomicMove.moveNoReplace).not.toHaveBeenCalled();

    const wrongType = createMutationHarness();
    addNode(wrongType, documentsRoot, "NotAFile", "DIRECTORY");
    await expect(
      wrongType.service.renameFile({
        source: { rootId: "DOCUMENTS", relativePath: "NotAFile" },
        newName: "Renamed.txt"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_SOURCE_TYPE_INVALID" } });
    const wrongDestination = createMutationHarness();
    const wrongDestinationSourceDirectory = addNode(wrongDestination, documentsRoot, "Work", "DIRECTORY");
    addNode(wrongDestination, wrongDestinationSourceDirectory, "Report.txt", "FILE");
    addNode(wrongDestination, downloadsRoot, "NotADirectory", "FILE");
    await expect(
      wrongDestination.service.moveFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOWNLOADS", relativePath: "NotADirectory" }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_DESTINATION_TYPE_INVALID" } });

    const link = createMutationHarness();
    addNode(link, documentsRoot, "Link", "SYMLINK");
    await expect(
      link.service.renameFolder({
        source: { rootId: "DOCUMENTS", relativePath: "Link" },
        newName: "Renamed"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_REPARSE_POINT_REJECTED" } });

    const collision = createMutationHarness();
    const collisionParent = addNode(collision, documentsRoot, "Work", "DIRECTORY");
    addNode(collision, collisionParent, "Existing", "DIRECTORY");
    await expect(
      collision.service.createFolder({
        parentDirectory: { rootId: "DOCUMENTS", relativePath: "Work" },
        name: "Existing"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_COLLISION" } });
    expect(collision.mkdir).not.toHaveBeenCalled();

    const renameCollision = createMutationHarness();
    const renameCollisionParent = addNode(renameCollision, documentsRoot, "Work", "DIRECTORY");
    addNode(renameCollision, renameCollisionParent, "Report.txt", "FILE");
    addNode(renameCollision, renameCollisionParent, "Summary.txt", "FILE");
    await expect(
      renameCollision.service.renameFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        newName: "Summary.txt"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_COLLISION" } });
    expect(renameCollision.atomicMove.moveNoReplace).not.toHaveBeenCalled();

    const moveCollision = createMutationHarness();
    const moveSourceDirectory = addNode(moveCollision, documentsRoot, "Work", "DIRECTORY");
    addNode(moveCollision, moveSourceDirectory, "Report.txt", "FILE");
    const moveDestination = addNode(moveCollision, downloadsRoot, "Archive", "DIRECTORY");
    addNode(moveCollision, moveDestination, "Report.txt", "FILE");
    await expect(
      moveCollision.service.moveFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_COLLISION" } });
    expect(moveCollision.atomicMove.moveNoReplace).not.toHaveBeenCalled();
  });

  it("fails safely for cross-volume, concurrent, and raw filesystem failures without fallback behavior", async () => {
    const crossVolume = createMutationHarness({
      atomicMove: {
        moveNoReplace: vi.fn(() => ({ ok: false as const, reason: "CROSS_VOLUME" as const }))
      }
    });
    const sourceDirectory = addNode(crossVolume, documentsRoot, "Work", "DIRECTORY");
    addNode(crossVolume, sourceDirectory, "Report.txt", "FILE");
    addNode(crossVolume, downloadsRoot, "Archive", "DIRECTORY");
    await expect(
      crossVolume.service.moveFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_CROSS_VOLUME_UNSUPPORTED" } });

    const concurrent = createMutationHarness();
    const parent = addNode(concurrent, documentsRoot, "Work", "DIRECTORY");
    const source = addNode(concurrent, parent, "Report.txt", "FILE");
    let sourceChecks = 0;
    concurrent.lstat.mockImplementation(async (targetPath: string) => {
      if (targetPath === source) {
        sourceChecks += 1;
        if (sourceChecks > 1) throw createSystemError("ENOENT");
      }
      const node = concurrent.nodes.get(targetPath);
      if (!node) throw createSystemError("ENOENT");
      return createStats(node);
    });
    await expect(
      concurrent.service.renameFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        newName: "Summary.txt"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_SOURCE_NOT_FOUND" } });
    expect(concurrent.atomicMove.moveNoReplace).not.toHaveBeenCalled();

    const concurrentDestination = createMutationHarness();
    const concurrentDestinationParent = addNode(concurrentDestination, documentsRoot, "Work", "DIRECTORY");
    addNode(concurrentDestination, concurrentDestinationParent, "Report.txt", "FILE");
    const targetPath = path.win32.join(concurrentDestinationParent, "Summary.txt");
    let targetChecks = 0;
    concurrentDestination.lstat.mockImplementation(async (targetPathToCheck: string) => {
      if (targetPathToCheck === targetPath) {
        targetChecks += 1;
        if (targetChecks > 1) return createStats({ kind: "FILE" });
      }
      const node = concurrentDestination.nodes.get(targetPathToCheck);
      if (!node) throw createSystemError("ENOENT");
      return createStats(node);
    });
    await expect(
      concurrentDestination.service.renameFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        newName: "Summary.txt"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_COLLISION" } });
    expect(concurrentDestination.atomicMove.moveNoReplace).not.toHaveBeenCalled();

    const missingDestination = createMutationHarness();
    const missingDestinationSourceDirectory = addNode(missingDestination, documentsRoot, "Work", "DIRECTORY");
    addNode(missingDestination, missingDestinationSourceDirectory, "Report.txt", "FILE");
    const archive = addNode(missingDestination, downloadsRoot, "Archive", "DIRECTORY");
    let archiveChecks = 0;
    missingDestination.lstat.mockImplementation(async (targetPathToCheck: string) => {
      if (targetPathToCheck === archive) {
        archiveChecks += 1;
        if (archiveChecks > 1) throw createSystemError("ENOENT");
      }
      const node = missingDestination.nodes.get(targetPathToCheck);
      if (!node) throw createSystemError("ENOENT");
      return createStats(node);
    });
    await expect(
      missingDestination.service.moveFile({
        source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
        destinationDirectory: { rootId: "DOWNLOADS", relativePath: "Archive" }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_DESTINATION_NOT_FOUND" } });
    expect(missingDestination.atomicMove.moveNoReplace).not.toHaveBeenCalled();

    const rawFailure = createMutationHarness({
      atomicMove: {
        moveNoReplace: vi.fn(() => {
          throw new Error(`Native move failed for ${documentsRoot}\\Work\\Report.txt`);
        })
      }
    });
    const rawParent = addNode(rawFailure, documentsRoot, "Work", "DIRECTORY");
    addNode(rawFailure, rawParent, "Report.txt", "FILE");
    const rawResult = await rawFailure.service.renameFile({
      source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
      newName: "Summary.txt"
    });
    expect(rawResult).toMatchObject({ ok: false, error: { code: "FILE_MUTATION_FAILED" } });
    expect(JSON.stringify(rawResult)).not.toContain(documentsRoot);
    expect(JSON.stringify(rawResult)).not.toContain("Native move failed");
  });

  it("maps an unavailable native bridge to a controlled redacted result", async () => {
    const unavailable = createMutationHarness({
      atomicMove: {
        moveNoReplace: vi.fn(() => ({ ok: false as const, reason: "UNAVAILABLE" as const }))
      }
    });
    const parent = addNode(unavailable, documentsRoot, "Work", "DIRECTORY");
    addNode(unavailable, parent, "Report.txt", "FILE");

    const result = await unavailable.service.renameFile({
      source: { rootId: "DOCUMENTS", relativePath: "Work\\Report.txt" },
      newName: "Summary.txt"
    });

    expect(result).toMatchObject({ ok: false, error: { code: "FILE_NATIVE_MOVE_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(documentsRoot);
  });

  it("uses the native no-replace wrapper without copy, delete, content, or shell APIs", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/main/files/file-mutation-service.ts"),
      "utf8"
    );
    expect(source).toContain("defaultMkdir");
    expect(source).toContain("createWindowsAtomicMove");
    expect(source).not.toContain("defaultRename");
    expect(source).not.toMatch(/copyFile|unlink|rm\(|rmdir|writeFile|appendFile|readFile|createReadStream|watch\s*\(/);
    expect(source).not.toMatch(/child_process|shell|spawn|exec|PowerShell|cmd\.exe|registry/);
  });
});
