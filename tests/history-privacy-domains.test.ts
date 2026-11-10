import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import { createApprovedWebActionExecutor } from "../src/main/actions/approved-web-action-executor";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import type { ApplicationLauncher } from "../src/main/applications/application-launcher";
import type { PlannerService } from "../src/main/planner/planner-service";

/**
 * History and log privacy for the domains without their own test: planner (memory), applications and web.
 * Already covered elsewhere and not repeated here:
 *  - messaging: tests/messaging-actions.test.ts, messaging-storage.test.ts, whatsapp-chat-launch.test.ts
 *  - files: tests/supervised-file-actions.test.ts, supervised-file-mutation-actions.test.ts, found-file-open-voice.test.ts
 *  - music: tests/spotify-playback.test.ts, spotify-search.test.ts
 *  - custom application registration: tests/custom-application-voice-registration.test.ts
 */

const LEAK = /Cumpleaños de Sofía|3001234567|573001234567|contraseña secreta|mi secreto|C:\\|\.exe|https?:\/\/|google\.com|youtube\.com/iu;

const unused = { execute: vi.fn() } as never;

const flow = (options: { plannerService?: PlannerService; launcher?: ApplicationLauncher; openExternal?: (url: string) => Promise<void> }) => {
  const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
  const logs = vi.fn();
  let counter = 0;
  const executor = createActionExecutor({
    plannerExecutor: createPlannerActionExecutor({
      plannerService: options.plannerService,
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      timeZone: () => "America/Bogota",
      logError: logs
    }),
    applicationExecutor: options.launcher ? createApplicationActionExecutor({ launcher: options.launcher, logError: logs }) : unused,
    approvedWebExecutor: options.openExternal ? createApprovedWebActionExecutor({ openExternal: options.openExternal, logError: logs }) : unused,
    filesExecutor: unused,
    messagingExecutor: unused,
    spotifyExecutor: unused
  });
  const orchestrator = createActionOrchestrator({
    executor,
    historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
    generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: logs
  });
  const recorded = (): string => JSON.stringify([recordTerminal.mock.calls, logs.mock.calls]);
  return { orchestrator, recordTerminal, logs, recorded };
};

const success = { ok: true as const, data: { record: {} } };
const plannerService = (overrides: Record<string, unknown> = {}): PlannerService =>
  ({
    createTask: vi.fn(async () => success),
    createReminder: vi.fn(async () => success),
    getTodaySchedule: vi.fn(async () => ({
      ok: true,
      data: {
        localDate: "2026-09-17",
        tasks: [{ title: "Cumpleaños de Sofía 3001234567", priority: "MEDIUM", status: "PENDING", dueTime: null }],
        events: [],
        reminders: []
      }
    })),
    ...overrides
  }) as unknown as PlannerService;

describe("planner (memory) history privacy", () => {
  it("records no title or number for a created task or reminder, and logs nothing", async () => {
    const run = flow({ plannerService: plannerService() });
    await run.orchestrator.propose({ action: "CREATE_TASK", input: { title: "Cumpleaños de Sofía 3001234567" } });
    await run.orchestrator.propose({ action: "CREATE_REMINDER", input: { title: "Cumpleaños de Sofía", remindAt: "2026-09-17T10:00:00Z" } });
    expect(run.recordTerminal).toHaveBeenCalledTimes(2);
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.logs).not.toHaveBeenCalled();
  });

  it("records only fixed text when the planner service fails, with a constant log line", async () => {
    const failing = plannerService({ createTask: vi.fn(async () => { throw new Error("boom: Cumpleaños de Sofía 3001234567 SELECT"); }) });
    const run = flow({ plannerService: failing });
    await run.orchestrator.propose({ action: "CREATE_TASK", input: { title: "Cumpleaños de Sofía 3001234567" } });
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recorded()).not.toMatch(/SELECT|boom/u);
    expect(run.logs.mock.calls).toEqual([["Planner action execution failed."]]);
  });

  it("keeps titles out of history metadata for a schedule query", async () => {
    const run = flow({ plannerService: plannerService() });
    await run.orchestrator.propose({ action: "GET_TODAY_SCHEDULE", input: {} });
    const metadata = JSON.stringify(run.recordTerminal.mock.calls.map((call) => (call[0] as { metadata?: unknown }).metadata));
    expect(metadata).not.toMatch(LEAK);
  });

  /**
   * KNOWN DEFECT (reported, not fixed in this task): the history summary of GET_TODAY_SCHEDULE is the spoken
   * agenda text, which embeds task and event titles, because the orchestrator only replaces the summary for
   * files, messaging and music actions. This test records the current behavior; when the summary is made
   * category-only, this test must be flipped to expect no title in history.
   */
  it("KNOWN DEFECT: stores the agenda text, with task titles, as the history summary of GET_TODAY_SCHEDULE", async () => {
    const run = flow({ plannerService: plannerService() });
    await run.orchestrator.propose({ action: "GET_TODAY_SCHEDULE", input: {} });
    const summaries = run.recordTerminal.mock.calls.map((call) => (call[0] as { userSummary: string }).userSummary);
    expect(summaries.some((summary) => summary.includes("Cumpleaños de Sofía"))).toBe(true);
  });
});

describe("applications history privacy", () => {
  const launcher = (result: unknown): ApplicationLauncher =>
    ({ launchByAlias: vi.fn(async () => result), launchResolvedTarget: vi.fn() }) as unknown as ApplicationLauncher;

  it("records the public application name only, never the typed alias, a path or an executable", async () => {
    const run = flow({ launcher: launcher({ ok: true, data: { applicationName: "Microsoft Word" } }) });
    await run.orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "Mi Secreto" } });
    expect(run.recordTerminal).toHaveBeenCalledOnce();
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recorded()).toContain("Microsoft Word");
  });

  it("records only the fixed failure text, with no alias, path or raw error", async () => {
    const run = flow({
      launcher: launcher({ ok: false, error: { code: "APPLICATION_LAUNCH_FAILED", userMessage: "No se pudo abrir la aplicación." } })
    });
    await run.orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "Mi Secreto" } });
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recordTerminal.mock.calls[0]?.[0]).toMatchObject({ status: "EXECUTION_FAILED", errorCode: "APPLICATION_LAUNCH_FAILED" });
  });

  it("contains a launcher that throws a message with a path, logging only a constant", async () => {
    const throwing = { launchByAlias: vi.fn(async () => { throw new Error("spawn C:\\Users\\Ana\\secreto.exe ENOENT"); }), launchResolvedTarget: vi.fn() } as unknown as ApplicationLauncher;
    const run = flow({ launcher: throwing });
    await run.orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "Mi Secreto" } });
    expect(run.recorded()).not.toMatch(/C:\\|\.exe|ENOENT|mi secreto/iu);
    for (const call of run.logs.mock.calls) expect(typeof call[0]).toBe("string");
  });
});

describe("web history privacy", () => {
  it("records no query and no URL for an approved-site search, and opens the URL only through the wrapper", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const run = flow({ openExternal });
    await run.orchestrator.propose({ action: "SEARCH_APPROVED_SITE", input: { site: "GOOGLE", query: "mi contraseña secreta 3001234567" } });
    expect(openExternal).toHaveBeenCalledOnce();
    expect(String(openExternal.mock.calls[0]?.[0])).toContain("https://www.google.com/search");
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recorded()).toContain("Google");
  });

  it("records no URL for opening an approved page", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const run = flow({ openExternal });
    await run.orchestrator.propose({ action: "OPEN_APPROVED_PAGE", input: { site: "YOUTUBE" } });
    expect(run.recorded()).not.toMatch(LEAK);
  });

  it("records only fixed text when opening fails, never the query or the URL", async () => {
    const openExternal = vi.fn(async () => { throw new Error("failed https://www.google.com/search?q=mi+contraseña+secreta"); });
    const run = flow({ openExternal });
    await run.orchestrator.propose({ action: "SEARCH_APPROVED_SITE", input: { site: "GOOGLE", query: "mi contraseña secreta" } });
    expect(run.recorded()).not.toMatch(LEAK);
  });
});
