import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import { ENABLED_ASSISTANT_CAPABILITIES } from "../src/main/actions/capability-registry";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import { createSupervisedFileActionExecutor } from "../src/main/actions/supervised-file-action-executor";
import { filesSuccess } from "../src/main/files/supervised-file-failures";
import type { SupervisedFileService } from "../src/main/files/supervised-file-service";
import type { PlannerService } from "../src/main/planner/planner-service";
import { ACTION_KINDS, ACTION_NAMES } from "../src/shared/action-contracts";
import { listSourceFiles, readSource } from "./helpers/read-source";

/**
 * Refactor 3.1 and 3.2 inventory: the habit and weekly-schedule actions, their code, the legacy file chain, the native addon,
 * the legacy action names (OPEN_WEB_PAGE and the four legacy file names), the duplicate catalog registration service and the
 * unused database lifecycle module are gone, while the supervised FILES actions, tasks, events, reminders, today's schedule and the date/time action still resolve
 * through the real executors (with mocked dependencies).
 */

const REMOVED_ACTIONS = [
  "GET_WEEKLY_SCHEDULE_DETAILS", "ANALYZE_WEEKLY_SCHEDULE", "GET_TODAY_AVAILABILITY", "CREATE_WEEKLY_SCHEDULE",
  "UPDATE_WEEKLY_SCHEDULE", "CREATE_WEEKLY_ROUTINE", "UPDATE_WEEKLY_ROUTINE",
  "GET_HABIT_PROGRESS", "CREATE_HABIT", "UPDATE_HABIT", "COMPLETE_HABIT"
];

/** Names that were registered or typed but never executable after Refactor 3.1; Refactor 3.2 removed them everywhere. */
const DEAD_ACTION_NAMES = ["OPEN_WEB_PAGE", "RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "ORGANIZE_FILES"];

const REMOVED_PATHS = [
  "src/main/applications/web-page-launcher.ts",
  "src/main/applications/trusted-web-destinations.ts",
  "src/main/applications/catalog-application-registration-service.ts",
  "src/main/database/register-database-lifecycle.ts",
  "src/main/habits",
  "src/main/actions/habit-action-executor.ts",
  "src/main/actions/habit-mutation-references.ts",
  "src/shared/habit-contracts.ts",
  "src/main/database/schema/habits.ts",
  "src/main/database/schema/habit-completions.ts",
  "src/main/actions/weekly-schedule-analysis.ts",
  "src/main/actions/weekly-schedule-mutation-references.ts",
  "src/main/database/schema/weekly-routines.ts",
  "src/main/database/schema/weekly-schedules.ts",
  "src/main/actions/file-action-executor.ts",
  "src/main/files/file-composition.ts",
  "src/main/files/file-mutation-service.ts",
  "src/main/files/file-organization-classifier.ts",
  "src/main/files/file-organization-executor.ts",
  "src/main/files/file-organization-plan-generator.ts",
  "src/main/files/file-search-service.ts",
  "src/main/files/windows-atomic-move.ts",
  "native"
];

describe("removed habit, weekly-schedule, legacy file and native-addon code", () => {
  it("has none of the removed files or directories", () => {
    for (const removed of REMOVED_PATHS) expect(existsSync(path.resolve(process.cwd(), removed)), removed).toBe(false);
  });

  it("registers none of the 11 removed action names anywhere in the action catalog", () => {
    for (const name of REMOVED_ACTIONS) {
      expect(ACTION_NAMES as readonly string[], name).not.toContain(name);
      expect(ACTION_KINDS as readonly string[], name).not.toContain(name);
      expect(ENABLED_ASSISTANT_CAPABILITIES.map((entry) => entry.action as string), name).not.toContain(name);
    }
    expect(ACTION_NAMES).toHaveLength(43);
    expect(ENABLED_ASSISTANT_CAPABILITIES).toHaveLength(43);
  });

  it("makes ACTION_NAMES exactly the enabled catalog, with nothing dead in it", () => {
    expect([...ACTION_NAMES].sort()).toEqual(ENABLED_ASSISTANT_CAPABILITIES.map((entry) => entry.action as string).sort());
    for (const name of DEAD_ACTION_NAMES) {
      expect(ACTION_NAMES as readonly string[], name).not.toContain(name);
      expect(ACTION_KINDS as readonly string[], name).not.toContain(name);
    }
    // The only kinds beyond the catalog are the deny-by-default policy records, and none of them can ever run.
    const policyOnly = ACTION_KINDS.filter((kind) => !(ACTION_NAMES as readonly string[]).includes(kind));
    expect([...policyOnly].sort()).toEqual([
      "DELETE_FILE", "DELETE_FOLDER", "MOVE_FOLDER", "OPEN_REGISTERED_APPLICATION", "OPEN_REGISTERED_PAGE",
      "UPDATE_REGISTERED_APPLICATION", "UPDATE_REGISTERED_PAGE"
    ]);
    for (const kind of policyOnly) expect(getActionPolicy(kind).availability, kind).toBe("DEFERRED");
  });

  it("names no removed action, module or table anywhere in src, the package manifest or the Forge config", () => {
    const everything = [
      ...["src/main", "src/shared", "src/preload", "src/renderer"].flatMap(listSourceFiles).map((file) => [file, readSource(file)] as const),
      ...["package.json", "forge.config.ts"].map((file) => [file, readSource(file)] as const)
    ];
    const forbidden = new RegExp(
      [...REMOVED_ACTIONS, ...DEAD_ACTION_NAMES, "web-page-launcher", "trusted-web-destinations", "catalog-application-registration-service",
        "register-database-lifecycle", "WEB_DESTINATIONS", "WEB_BROWSERS", "DeferredAction", "habit-contracts", "habit-service", "habit-repository", "weekly-schedule-analysis", "weekly-schedule-mutation",
        "habit_completions", "weekly_routines", "weekly_schedules", "habitFrequency", "weeklyRoutines", "weeklySchedules",
        "windows-atomic-move", "atomic-no-replace", "ares_atomic_no_replace", "native:build", "test:native", "file-mutation-service",
        "file-organization", "file-search-service", "(?<!supervised-)file-action-executor"].join("|"),
      "u"
    );
    const offenders = everything.filter(([, text]) => forbidden.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("has no legacy file proposal or organization type left in the action contracts", () => {
    expect(readSource("src/shared/action-contracts.ts")).not.toMatch(/LegacyFileAction|FileActionProposal|FileActionSubmission|FileOrganization|OpenWebPage/u);
  });
});

describe("surviving actions still resolve through the real executors", () => {
  const ID = "550e8400-e29b-41d4-a716-446655440000";
  const success = { ok: true as const, data: { record: {} } };
  const plannerService = {
    createTask: vi.fn(async () => success),
    createEvent: vi.fn(async () => success),
    createReminder: vi.fn(async () => success),
    getTodaySchedule: vi.fn(async () => ({ ok: true as const, data: { localDate: "2026-09-17", tasks: [], events: [], reminders: [] } }))
  } as unknown as PlannerService;
  const fileService = {
    search: vi.fn(async () => filesSuccess({ resultCount: 0, partial: false, items: [] })),
    revealFound: vi.fn(async () => filesSuccess({ revealed: true as const }))
  } as unknown as SupervisedFileService;
  const unused = { execute: vi.fn() } as never;
  const executor = createActionExecutor({
    plannerExecutor: createPlannerActionExecutor({ plannerService, now: () => new Date("2026-09-17T10:00:00.000Z"), timeZone: () => "America/Bogota", logError: vi.fn() }),
    applicationExecutor: unused,
    approvedWebExecutor: unused,
    messagingExecutor: unused,
    spotifyExecutor: unused,
    filesExecutor: createSupervisedFileActionExecutor({ service: fileService, logError: vi.fn() })
  });
  const run = (action: string, input: unknown) =>
    executor.execute({ actionId: ID, action, input } as never, getActionPolicy(action as never));

  it("runs tasks, events, reminders, today's schedule and the date/time action through the planner executor", async () => {
    await expect(run("CREATE_TASK", { title: "Informe" })).resolves.toMatchObject({ status: "SUCCEEDED", userSummary: "Se creó la tarea." });
    await expect(run("CREATE_EVENT", { title: "Reunión", startAt: "2026-09-17T10:00:00Z" })).resolves.toMatchObject({ status: "SUCCEEDED", userSummary: "Se creó el evento." });
    await expect(run("CREATE_REMINDER", { title: "Llamar", remindAt: "2026-09-17T10:00:00Z" })).resolves.toMatchObject({ status: "SUCCEEDED", userSummary: "Se creó el recordatorio." });
    await expect(run("GET_TODAY_SCHEDULE", {})).resolves.toMatchObject({ status: "SUCCEEDED", userSummary: "Hoy no tienes tareas ni eventos." });
    await expect(run("GET_CURRENT_DATE_TIME", {})).resolves.toMatchObject({ status: "SUCCEEDED", userSummary: expect.stringContaining("Son las 05:00") });
  });

  it("runs the supervised FILES actions through the supervised executor", async () => {
    await expect(run("SEARCH_FILES", { query: "cv" })).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(run("REVEAL_FOUND_FILE", { ordinal: 1 })).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(vi.mocked(fileService.search as never)).toHaveBeenCalledOnce();
    expect(vi.mocked(fileService.revealFound as never)).toHaveBeenCalledOnce();
  });

  it("keeps the today schedule free of weekly or routine items", async () => {
    const outcome = await run("GET_TODAY_SCHEDULE", {});
    expect(JSON.stringify(outcome)).not.toMatch(/routine|rutina|semanal|horario/iu);
    expect(Object.keys((outcome as { data: Record<string, unknown> }).data).sort()).toEqual(["events", "localDate", "reminders", "tasks"]);
  });
});
