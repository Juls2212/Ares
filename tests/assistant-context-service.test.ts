import { describe, expect, it, vi } from "vitest";

import { createAssistantContextService } from "../src/main/assistant/assistant-context-service";
import { createAssistantContextStore } from "../src/main/assistant/assistant-context-store";

const taskId = "550e8400-e29b-41d4-a716-446655440000";
const fileStats = (kind: "file" | "directory" | "link") => ({
  isFile: () => kind === "file",
  isDirectory: () => kind === "directory",
  isSymbolicLink: () => kind === "link"
});

const serviceFor = (overrides: Record<string, unknown> = {}) =>
  createAssistantContextService({
    store: createAssistantContextStore(),
    plannerRepositories: {
      findTaskById: vi.fn(async (id: string) => id === taskId ? { id, title: "Tarea segura" } : undefined),
      findEventById: vi.fn(async () => undefined),
      findReminderById: vi.fn(async () => undefined)
    },
    applicationService: {
      resolveEnabledApplicationByAlias: vi.fn(async (alias: string) => alias === "chrome"
        ? { ok: true as const, data: { name: "Google Chrome", executablePath: "private", id: taskId, platform: "WINDOWS", isEnabled: true } }
        : { ok: false as const, error: { code: "APPLICATION_NOT_FOUND", userMessage: "private" } })
    },
    rootResolver: { resolve: vi.fn(async () => ({ ok: true as const, data: { canonicalPath: "C:\\Users\\Safe\\Documents" } })) },
    lstat: vi.fn(async () => fileStats("directory")),
    realpath: vi.fn(async (target: string) => target),
    logError: vi.fn(),
    ...overrides
  } as never);

describe("Main-only assistant context service", () => {
  it("isolates selections by webContents, replaces a prior section, clears, and removes on destruction", async () => {
    const service = serviceFor();
    await expect(service.set(1, { selection: { section: "PLANNER", kind: "TASK", id: taskId } })).resolves.toMatchObject({ ok: true, data: { status: "SET", kind: "TASK" } });
    expect(await service.getValidated(2)).toBeUndefined();
    await service.set(1, { selection: { section: "APPLICATIONS", kind: "APPLICATION", alias: "chrome" } });
    await expect(service.getValidated(1)).resolves.toMatchObject({ providerContext: { kind: "APPLICATION", label: "Google Chrome" } });
    let destroyed: (() => void) | undefined;
    service.bindWindow(1, (listener) => { destroyed = listener; });
    service.bindWindow(1, () => { throw new Error("must only bind once"); });
    destroyed?.();
    expect(await service.getValidated(1)).toBeUndefined();
    expect(service.clear(1)).toEqual({ ok: true, data: { status: "CLEARED" } });
  });

  it("clears stale, wrong-type, unsafe file, and disabled application context without revealing private data", async () => {
    const lstat = vi.fn(async () => fileStats("link"));
    const service = serviceFor({ lstat });
    const invalidFile = await service.set(3, { selection: { section: "FILES", kind: "FOLDER", reference: { rootId: "DOCUMENTS", relativePath: "..\\secret" } } });
    const linkFile = await service.set(3, { selection: { section: "FILES", kind: "FOLDER", reference: { rootId: "DOCUMENTS", relativePath: "inbox" } } });
    const missing = await service.set(3, { selection: { section: "PLANNER", kind: "EVENT", id: taskId } });
    const disabled = await service.set(3, { selection: { section: "APPLICATIONS", kind: "APPLICATION", alias: "disabled" } });
    for (const result of [invalidFile, linkFile, missing, disabled]) {
      expect(result).toMatchObject({ ok: false, error: { code: "ASSISTANT_CONTEXT_INVALID" } });
      expect(JSON.stringify(result)).not.toContain("private");
      expect(JSON.stringify(result)).not.toContain("C:\\\\");
    }
    expect(await service.getValidated(3)).toBeUndefined();
  });

  it("sends only a bounded kind and label to an interpreter-facing context", async () => {
    const service = serviceFor();
    await service.set(4, { selection: { section: "PLANNER", kind: "TASK", id: taskId } });
    const context = await service.getValidated(4);
    expect(context?.providerContext).toEqual({ token: "$CURRENT_CONTEXT", kind: "TASK", label: "Tarea segura" });
    expect(JSON.stringify(context?.providerContext)).not.toContain(taskId);
  });
});
