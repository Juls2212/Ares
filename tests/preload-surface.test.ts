import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/shared/contracts";

const preloadSource = readFileSync(
  path.resolve(process.cwd(), "src/preload/preload.ts"),
  "utf8"
);

const rendererGlobalSource = readFileSync(
  path.resolve(process.cwd(), "src/renderer/global.d.ts"),
  "utf8"
);

describe("preload surface", () => {
  it("uses only explicit system and planner channels", () => {
    expect(IPC_CHANNELS.system).toEqual({
      getStatus: "system:get-status",
      getCapabilities: "system:get-capabilities"
    });
    expect(IPC_CHANNELS.planner).toEqual({
      categories: {
        create: "planner:categories:create",
        list: "planner:categories:list",
        update: "planner:categories:update"
      },
      tasks: {
        create: "planner:tasks:create",
        list: "planner:tasks:list",
        update: "planner:tasks:update",
        complete: "planner:tasks:complete"
      },
      events: {
        create: "planner:events:create",
        list: "planner:events:list",
        update: "planner:events:update"
      },
      reminders: {
        create: "planner:reminders:create",
        list: "planner:reminders:list"
      },
      schedule: {
        getToday: "planner:schedule:get-today",
        getWeek: "planner:schedule:get-week"
      }
    });
  });

  it("exposes exactly the approved planner method groups", () => {
    expect(preloadSource).toContain("planner: {");
    expect(preloadSource).toContain("categories: {");
    expect(preloadSource).toContain("tasks: {");
    expect(preloadSource).toContain("events: {");
    expect(preloadSource).toContain("reminders: {");
    expect(preloadSource).toContain("schedule: {");
    expect(preloadSource).not.toContain("delete:");
    expect(preloadSource).not.toContain("database:");
  });

  it("uses the same complete Ares API contract in the renderer declaration", () => {
    expect(rendererGlobalSource).toContain('import type { AresApi } from "../shared/contracts"');
    expect(rendererGlobalSource).toContain("ares: AresApi;");
    expect(preloadSource).toContain("} satisfies AresApi;");
  });

  it("does not expose generic IPC or Node capabilities", () => {
    expect(preloadSource).toContain('contextBridge.exposeInMainWorld("ares", aresApi)');
    expect(preloadSource).not.toMatch(/\b(?:send|invoke)\s*:/);
    expect(preloadSource).not.toMatch(/\b(?:fs|path|shell|child_process|process\.env)\b/);
    expect(preloadSource).not.toContain('exposeInMainWorld("ares", ipcRenderer)');
  });
});
