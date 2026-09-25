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
  it("uses only explicit system, dashboard, planner, action, application catalog, and assistant channels", () => {
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
    expect(IPC_CHANNELS.actions).toEqual({
      propose: "actions:propose",
      confirm: "actions:confirm",
      cancel: "actions:cancel",
      history: { list: "actions:history:list" }
    });
    expect(IPC_CHANNELS.applications).toEqual({
      registerCatalogApplication: "applications:register-catalog-application",
      registerCustomApplication: "applications:register-custom-application",
      list: "applications:list",
      update: "applications:update"
    });
    expect(IPC_CHANNELS.dashboard).toEqual({
      getTodaySummary: "dashboard:get-today-summary"
    });
    expect(IPC_CHANNELS.assistant).toEqual({
      interpret: "assistant:interpret"
    });
  });

  it("exposes only the approved dashboard summary method", () => {
    expect(preloadSource).toContain("dashboard: {");
    expect(preloadSource).toContain("getTodaySummary:");
    expect(preloadSource).not.toContain("dashboard: {\n    list:");
    expect(preloadSource).not.toContain("dashboard: {\n    getDatabase:");
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

  it("exposes exactly the approved action methods", () => {
    expect(preloadSource).toContain("actions: {");
    expect(preloadSource).toContain("propose:");
    expect(preloadSource).toContain("confirm:");
    expect(preloadSource).toContain("cancel:");
    expect(preloadSource).toContain("history: {");
    expect(preloadSource).toContain("list:");
    expect(preloadSource).not.toContain("execute:");
    expect(preloadSource).not.toContain("getResult:");
    expect(preloadSource).not.toContain("files:");
    expect(preloadSource).not.toContain("openWebPage:");
    expect(preloadSource).not.toContain("openUrl:");
    expect(preloadSource).not.toContain("browser:");
  });

  it("exposes exactly the approved application catalog methods", () => {
    expect(preloadSource).toContain("applications: {");
    expect(preloadSource).toContain("registerCatalogApplication:");
    expect(preloadSource).toContain("registerCustomApplication:");
    expect(preloadSource).toContain("list:");
    expect(preloadSource).toContain("update:");
    expect(preloadSource).not.toContain("open:");
    expect(preloadSource).not.toContain("launch:");
    expect(preloadSource).not.toContain("resolveAlias:");
    expect(preloadSource).not.toContain("executablePath:");
    expect(preloadSource).not.toContain("showOpenDialog:");
    expect(preloadSource).not.toContain("registerChrome:");
    expect(preloadSource).not.toContain("applications:register,");
    expect(preloadSource).not.toContain("showMessageBox:");
    expect(preloadSource).not.toContain("executablePath:");
    expect(preloadSource).not.toContain("showOpenDialog:");
  });

  it("exposes exactly one assistant interpretation method", () => {
    expect(preloadSource).toContain("assistant: {");
    expect(preloadSource).toContain("interpret:");
    expect(preloadSource).not.toContain("assistant: {\n    execute:");
    expect(preloadSource).not.toContain("assistant: {\n    propose:");
    expect(preloadSource).not.toContain("assistant: {\n    confirm:");
    expect(preloadSource).not.toContain("OPENAI_API_KEY");
    expect(preloadSource).not.toContain("openai");
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
