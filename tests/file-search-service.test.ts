import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createApprovedFileRootResolver,
  type ResolvedApprovedFileRoot
} from "../src/main/files/approved-file-roots";
import {
  isCanonicalPathWithinRoot,
  resolveSearchScope
} from "../src/main/files/file-path-boundary";
import {
  createFileSearchService,
  type SearchDirectoryEntry,
  type SearchFileStats
} from "../src/main/files/file-search-service";
import type { ApprovedFileRoot } from "../src/shared/file-contracts";

const rootPath = "C:\\Users\\Ares\\Documents";

type EntryDefinition = {
  kind: "FILE" | "DIRECTORY" | "SYMLINK";
  size?: number;
  modifiedAt?: Date;
  canonicalPath?: string;
};

const createEntry = (name: string, definition: EntryDefinition): SearchDirectoryEntry => ({
  name,
  isFile: () => definition.kind === "FILE",
  isDirectory: () => definition.kind === "DIRECTORY",
  isSymbolicLink: () => definition.kind === "SYMLINK"
});

const createStats = (definition: EntryDefinition): SearchFileStats => ({
  isFile: () => definition.kind === "FILE",
  isDirectory: () => definition.kind === "DIRECTORY",
  isSymbolicLink: () => definition.kind === "SYMLINK",
  size: definition.size ?? 0,
  mtime: definition.modifiedAt ?? new Date("2026-01-02T03:04:05.000Z")
});

const createSearchHarness = (overrides: {
  entries?: Map<string, SearchDirectoryEntry[]>;
  definitions?: Map<string, EntryDefinition>;
  inaccessibleDirectories?: Set<string>;
} = {}) => {
  const entries = overrides.entries ?? new Map<string, SearchDirectoryEntry[]>();
  const definitions = overrides.definitions ?? new Map<string, EntryDefinition>();
  const inaccessibleDirectories = overrides.inaccessibleDirectories ?? new Set<string>();
  const root: ResolvedApprovedFileRoot = { rootId: "DOCUMENTS", canonicalPath: rootPath };
  const rootResolver = { resolve: vi.fn(async () => ({ ok: true as const, data: root })) };
  const readdir = vi.fn(async (targetPath: string) => {
    if (inaccessibleDirectories.has(targetPath)) throw new Error(`Denied ${targetPath}`);
    return entries.get(targetPath) ?? [];
  });
  const lstat = vi.fn(async (targetPath: string) => {
    const definition = definitions.get(targetPath);
    if (!definition) throw new Error(`Missing ${targetPath}`);
    return createStats(definition);
  });
  const realpath = vi.fn(async (targetPath: string) => {
    const definition = definitions.get(targetPath);
    return definition?.canonicalPath ?? targetPath;
  });
  const logError = vi.fn();
  return {
    entries,
    definitions,
    readdir,
    lstat,
    realpath,
    logError,
    service: createFileSearchService({ rootResolver, readdir, lstat, realpath, logError })
  };
};

const addEntry = (
  harness: ReturnType<typeof createSearchHarness>,
  parentPath: string,
  name: string,
  definition: EntryDefinition
): string => {
  const targetPath = path.win32.join(parentPath, name);
  harness.definitions.set(targetPath, definition);
  harness.entries.set(parentPath, [...(harness.entries.get(parentPath) ?? []), createEntry(name, definition)]);
  return targetPath;
};

describe("approved file roots", () => {
  it("resolves each trusted Electron user-folder root and rejects unknown or network roots", async () => {
    const paths = {
      documents: "C:\\Users\\Ares\\Documents",
      downloads: "C:\\Users\\Ares\\Downloads",
      desktop: "C:\\Users\\Ares\\Desktop"
    };
    const resolver = createApprovedFileRootResolver({
      getPath: (name) => paths[name],
      realpath: vi.fn(async (targetPath) => targetPath),
      logError: vi.fn()
    });

    await expect(resolver.resolve("DOCUMENTS")).resolves.toMatchObject({
      ok: true,
      data: { canonicalPath: paths.documents }
    });
    await expect(resolver.resolve("DOWNLOADS")).resolves.toMatchObject({
      ok: true,
      data: { canonicalPath: paths.downloads }
    });
    await expect(resolver.resolve("DESKTOP")).resolves.toMatchObject({
      ok: true,
      data: { canonicalPath: paths.desktop }
    });
    await expect(resolver.resolve("SYSTEM")).resolves.toMatchObject({
      ok: false,
      error: { code: "FILE_ROOT_INVALID" }
    });

    const networkResolver = createApprovedFileRootResolver({
      getPath: () => "C:\\Users\\Ares\\Documents",
      realpath: vi.fn(async () => "\\\\server\\share\\Documents"),
      logError: vi.fn()
    });
    await expect(networkResolver.resolve("DOCUMENTS")).resolves.toMatchObject({
      ok: false,
      error: { code: "FILE_ROOT_UNAVAILABLE" }
    });
  });

  it("uses case-insensitive containment and rejects canonical scope escapes or reparse points", async () => {
    expect(isCanonicalPathWithinRoot(rootPath, "c:\\users\\ares\\documents\\Work\\Plan.txt")).toBe(true);
    expect(isCanonicalPathWithinRoot(rootPath, "C:\\Users\\Ares\\DocumentsElsewhere\\Plan.txt")).toBe(false);

    const root: ResolvedApprovedFileRoot = { rootId: "DOCUMENTS", canonicalPath: rootPath };
    const lstat = vi.fn(async () => ({
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => true
    }));
    await expect(
      resolveSearchScope(root, "Linked", { lstat, realpath: vi.fn(async () => rootPath) })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_SEARCH_SCOPE_UNAVAILABLE" } });

    await expect(
      resolveSearchScope(root, "Folder", {
        lstat: vi.fn(async () => ({
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        })),
        realpath: vi.fn(async () => "C:\\Windows")
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "FILE_SEARCH_SCOPE_UNAVAILABLE" } });
  });
});

describe("file metadata search", () => {
  it("searches names only, filters extensions, maps safe results, and skips links and inaccessible entries", async () => {
    const harness = createSearchHarness();
    addEntry(harness, rootPath, "Annual Report.PDF", { kind: "FILE", size: 42 });
    const projects = addEntry(harness, rootPath, "Projects", { kind: "DIRECTORY" });
    addEntry(harness, projects, "Report Notes.txt", { kind: "FILE", size: 12 });
    addEntry(harness, rootPath, "Linked", { kind: "SYMLINK" });
    const blocked = addEntry(harness, rootPath, "Blocked", { kind: "DIRECTORY" });
    harness.entries.set(blocked, []);
    const inaccessible = new Set([blocked]);
    const service = createFileSearchService({
      rootResolver: { resolve: vi.fn(async () => ({ ok: true as const, data: { rootId: "DOCUMENTS" as ApprovedFileRoot, canonicalPath: rootPath } })) },
      readdir: vi.fn(async (targetPath) => {
        if (inaccessible.has(targetPath)) throw new Error(`Denied ${targetPath}`);
        return harness.entries.get(targetPath) ?? [];
      }),
      lstat: harness.lstat,
      realpath: harness.realpath,
      logError: harness.logError
    });

    const result = await service.search({
      rootId: "DOCUMENTS",
      query: "report",
      extensions: [".pdf"]
    });

    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            rootId: "DOCUMENTS",
            relativePath: "Annual Report.PDF",
            name: "Annual Report.PDF",
            entryType: "FILE",
            extension: "pdf",
            size: 42,
            lastModified: "2026-01-02T03:04:05.000Z"
          }
        ],
        total: 1,
        truncated: false,
        skippedEntryCount: 2
      }
    });
    expect(harness.lstat).not.toHaveBeenCalledWith(path.win32.join(rootPath, "Linked"));
    expect(JSON.stringify(result)).not.toContain(rootPath);
    expect(JSON.stringify(result)).not.toContain("Denied");
  });

  it("returns bounded results and stops recursive traversal at the depth limit", async () => {
    const resultLimitHarness = createSearchHarness();
    addEntry(resultLimitHarness, rootPath, "Alpha.txt", { kind: "FILE" });
    addEntry(resultLimitHarness, rootPath, "Almanac.txt", { kind: "FILE" });
    const limited = await resultLimitHarness.service.search({
      rootId: "DOCUMENTS",
      query: "al",
      limit: 1
    });
    expect(limited).toMatchObject({ ok: true, data: { total: 1, truncated: true } });

    const depthHarness = createSearchHarness();
    let directory = rootPath;
    for (let index = 0; index <= 12; index += 1) {
      directory = addEntry(depthHarness, directory, `Level${index}`, { kind: "DIRECTORY" });
    }
    addEntry(depthHarness, directory, "Hidden.txt", { kind: "FILE" });
    const depthLimited = await depthHarness.service.search({ rootId: "DOCUMENTS", query: "hidden" });
    expect(depthLimited).toMatchObject({ ok: true, data: { items: [], truncated: true } });
  });

  it("maps regular directories without exposing their canonical path", async () => {
    const harness = createSearchHarness();
    addEntry(harness, rootPath, "Projects", { kind: "DIRECTORY" });

    const result = await harness.service.search({ rootId: "DOCUMENTS", query: "projects" });

    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            rootId: "DOCUMENTS",
            relativePath: "Projects",
            name: "Projects",
            entryType: "DIRECTORY",
            extension: null,
            size: null,
            lastModified: "2026-01-02T03:04:05.000Z"
          }
        ],
        total: 1,
        truncated: false,
        skippedEntryCount: 0
      }
    });
    expect(JSON.stringify(result)).not.toContain(rootPath);
  });

  it("contains no content reading, writing, watcher, shell, or subprocess capability", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "src/main/files/file-search-service.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/readFile|writeFile|appendFile|createReadStream|createWriteStream|watch\s*\(/);
    expect(source).not.toMatch(/child_process|shell|spawn|exec|PowerShell|cmd\.exe/);
  });
});
