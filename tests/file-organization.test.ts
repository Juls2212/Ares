import { describe, expect, it, vi } from "vitest";
import { createFileOrganizationExecutor } from "../src/main/files/file-organization-executor";
import { classifyFileForOrganization } from "../src/main/files/file-organization-classifier";
import { createFileOrganizationPlanGenerator } from "../src/main/files/file-organization-plan-generator";
import type { ApprovedFileRootResolver } from "../src/main/files/approved-file-roots";
import type { FileMutationService } from "../src/main/files/file-mutation-service";
import type { FileOrganizationPlan } from "../src/shared/file-contracts";

const directoryStats = { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
const fileStats = { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });
const rootPath = "C:\\Users\\Ares\\Documents";
const folderPath = `${rootPath}\\Inbox`;

const rootResolver: ApprovedFileRootResolver = {
  resolve: vi.fn(async () => ({ ok: true as const, data: { rootId: "DOCUMENTS" as const, canonicalPath: rootPath } }))
};

const createGenerator = () => createFileOrganizationPlanGenerator({
  rootResolver,
  realpath: vi.fn(async (targetPath) => targetPath),
  lstat: vi.fn(async (targetPath) => {
    if (targetPath === folderPath) return directoryStats;
    if (targetPath === `${folderPath}\\report.pdf` || targetPath === `${folderPath}\\photo.JPG`) return fileStats;
    throw missingError;
  }),
  readdir: vi.fn(async (targetPath) => {
    if (targetPath === folderPath) {
      return [
        { name: "photo.JPG", ...fileStats },
        { name: "report.pdf", ...fileStats },
        { name: "subfolder", ...directoryStats },
        { name: ".hidden", ...fileStats }
      ];
    }
    return [];
  }),
  logError: vi.fn()
});

const plan: FileOrganizationPlan = {
  rootId: "DOCUMENTS",
  folder: { rootId: "DOCUMENTS", relativePath: "Inbox" },
  items: [
    {
      source: { rootId: "DOCUMENTS", relativePath: "Inbox\\report.pdf" },
      destination: { rootId: "DOCUMENTS", relativePath: "Inbox\\Documentos\\report.pdf" },
      category: "DOCUMENTS"
    },
    {
      source: { rootId: "DOCUMENTS", relativePath: "Inbox\\photo.jpg" },
      destination: { rootId: "DOCUMENTS", relativePath: "Inbox\\Imágenes\\photo.jpg" },
      category: "IMAGES"
    }
  ],
  plannedCount: 2,
  skippedCount: 0,
  conflictCount: 0,
  categoryCounts: { DOCUMENTS: 1, IMAGES: 1, AUDIO: 0, VIDEOS: 0, ARCHIVES: 0, OTHER: 0 },
  skipped: [],
  mixedContent: true,
  empty: false
};

describe("file organization", () => {
  it("classifies known extensions conservatively and sends unknown extensions to Otros", () => {
    expect(classifyFileForOrganization("report.PDF")).toBe("DOCUMENTS");
    expect(classifyFileForOrganization("photo.png")).toBe("IMAGES");
    expect(classifyFileForOrganization("sound.flac")).toBe("AUDIO");
    expect(classifyFileForOrganization("movie.mkv")).toBe("VIDEOS");
    expect(classifyFileForOrganization("archive.7z")).toBe("ARCHIVES");
    expect(classifyFileForOrganization("unknown.data")).toBe("OTHER");
  });

  it("creates a read-only direct-file plan with safe references and skip aggregates", async () => {
    const generator = createGenerator();
    const result = await generator.generate({
      folder: { rootId: "DOCUMENTS", relativePath: "Inbox" },
      exclusions: [{ rootId: "DOCUMENTS", relativePath: "Inbox\\photo.JPG" }]
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        plannedCount: 1,
        mixedContent: false,
        empty: false,
        items: [{ source: { relativePath: "Inbox\\report.pdf" }, destination: { relativePath: "Inbox\\Documentos\\report.pdf" } }]
      }
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(rootPath);
    expect(serialized).not.toContain("C:\\");
  });

  it("rejects traversal, external, duplicate, and unknown exclusion input", async () => {
    const generator = createGenerator();
    for (const input of [
      { folder: { rootId: "DOCUMENTS", relativePath: "Inbox" }, exclusions: [{ rootId: "DOCUMENTS", relativePath: "..\\outside" }] },
      { folder: { rootId: "DOCUMENTS", relativePath: "Inbox" }, exclusions: [{ rootId: "DOWNLOADS", relativePath: "Inbox\\x.txt" }] },
      { folder: { rootId: "DOCUMENTS", relativePath: "Inbox" }, exclusions: [{ rootId: "DOCUMENTS", relativePath: "Inbox\\x.txt" }, { rootId: "DOCUMENTS", relativePath: "Inbox\\x.txt" }] },
      { folder: { rootId: "DOCUMENTS", relativePath: "Inbox" }, unknown: true }
    ]) {
      await expect(generator.generate(input)).resolves.toMatchObject({ ok: false });
    }
  });

  it("reports an empty folder and deterministically avoids an existing destination name", async () => {
    const emptyGenerator = createFileOrganizationPlanGenerator({
      rootResolver,
      realpath: vi.fn(async (targetPath) => targetPath),
      lstat: vi.fn(async (targetPath) => targetPath === folderPath ? directoryStats : Promise.reject(missingError)),
      readdir: vi.fn(async () => []),
      logError: vi.fn()
    });
    await expect(emptyGenerator.generate({ folder: { rootId: "DOCUMENTS", relativePath: "Inbox" } })).resolves.toMatchObject({
      ok: true,
      data: { empty: true, plannedCount: 0 }
    });

    const duplicateGenerator = createFileOrganizationPlanGenerator({
      rootResolver,
      realpath: vi.fn(async (targetPath) => targetPath),
      lstat: vi.fn(async (targetPath) => {
        if (targetPath === folderPath || targetPath === `${folderPath}\\Documentos`) return directoryStats;
        if (targetPath === `${folderPath}\\report.pdf`) return fileStats;
        throw missingError;
      }),
      readdir: vi.fn(async (targetPath) =>
        targetPath === folderPath
          ? [{ name: "report.pdf", ...fileStats }]
          : [{ name: "report.pdf", ...fileStats }]
      ),
      logError: vi.fn()
    });
    await expect(duplicateGenerator.generate({ folder: { rootId: "DOCUMENTS", relativePath: "Inbox" } })).resolves.toMatchObject({
      ok: true,
      data: { items: [{ destination: { relativePath: "Inbox\\Documentos\\report (1).pdf" } }] }
    });
  });

  it("executes only planned names, continues after a collision, and returns aggregate-only data", async () => {
    const mutationService: FileMutationService = {
      createFolder: vi.fn(async () => ({ ok: true as const, data: { operation: "CREATE_FOLDER" as const, entryType: "DIRECTORY" as const, reference: { rootId: "DOCUMENTS" as const, relativePath: "Inbox\\Documentos" } } })),
      renameFile: vi.fn(),
      renameFolder: vi.fn(),
      moveFile: vi.fn(),
      moveFileToNamedDestination: vi.fn()
        .mockResolvedValueOnce({ ok: true, data: { operation: "MOVE_FILE", entryType: "FILE", reference: { rootId: "DOCUMENTS", relativePath: "Inbox\\Documentos\\report.pdf" } } })
        .mockResolvedValueOnce({ ok: false, error: { code: "FILE_COLLISION", userMessage: "Ya existe un elemento con ese nombre en el destino." } })
    };
    const executor = createFileOrganizationExecutor({ mutationService, logError: vi.fn() });
    const result = await executor.execute(plan);

    expect(result).toMatchObject({ ok: true, data: { plannedCount: 2, movedCount: 1, skippedCount: 1, conflictCount: 1, partial: true } });
    expect(mutationService.moveFileToNamedDestination).toHaveBeenCalledWith(expect.objectContaining({ destinationName: "report.pdf" }));
    expect(JSON.stringify(result)).not.toContain("Inbox\\report.pdf");
  });
});
