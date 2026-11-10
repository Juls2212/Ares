import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import { ENABLED_ASSISTANT_CAPABILITIES, type CapabilityExecutorCategory } from "../src/main/actions/capability-registry";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import type { PlannerService } from "../src/main/planner/planner-service";

/**
 * Registry → executor completeness. Every enabled action must reach an executor that returns a well-formed
 * outcome (a status and a user summary). The real planner executor is used (with a mocked planner service),
 * because it is the one with a hand-written switch; every other category is a routing stub that records which
 * executor category received the proposal.
 */

/**
 * KNOWN GAPS: registered, parsed and confirmed, but the production planner executor has no case for them, so
 * `execute` resolves to `undefined`. They are scheduled for removal in Refactor Phase 3. The guard tests below fail
 * if an entry here stops being a gap (stale list) and if any new gap appears.
 */
const KNOWN_GAPS: readonly string[] = ["GET_HABIT_PROGRESS", "CREATE_HABIT", "UPDATE_HABIT", "COMPLETE_HABIT"];

const success = { ok: true as const, data: { record: {} } };
const plannerService = {
  createTask: vi.fn(async () => success),
  updateTask: vi.fn(async () => success),
  completeTask: vi.fn(async () => success),
  createEvent: vi.fn(async () => success),
  updateEvent: vi.fn(async () => success),
  deleteEvent: vi.fn(async () => ({ ok: true, data: { deleted: true } })),
  deleteTask: vi.fn(async () => ({ ok: true, data: { deleted: true } })),
  createReminder: vi.fn(async () => success),
  createWeeklyRoutine: vi.fn(async () => success),
  updateWeeklyRoutine: vi.fn(async () => success),
  createWeeklySchedule: vi.fn(async () => success),
  updateWeeklySchedule: vi.fn(async () => success),
  listCategories: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })),
  listWeeklySchedules: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })),
  listWeeklyRoutines: vi.fn(async () => ({ ok: true, data: { items: [], total: 0 } })),
  getTodaySchedule: vi.fn(async () => ({ ok: true, data: { localDate: "2026-09-17", tasks: [], events: [], reminders: [] } })),
  getWeekSchedule: vi.fn(async () => ({ ok: true, data: { weekStart: "2026-09-14", weekEnd: "2026-09-20", tasks: [], events: [], reminders: [] } }))
} as unknown as PlannerService;

const ID = "550e8400-e29b-41d4-a716-446655440000";
const minimalInput: Record<string, unknown> = {
  CREATE_TASK: { title: "Informe" },
  UPDATE_TASK: { taskId: ID, title: "Informe" },
  COMPLETE_TASK: { taskId: ID },
  DELETE_TASK: { taskId: ID },
  CREATE_EVENT: { title: "Reunión", startAt: "2026-09-17T10:00:00Z" },
  UPDATE_EVENT: { eventId: ID, title: "Reunión" },
  DELETE_EVENT: { eventId: ID },
  CREATE_REMINDER: { title: "Llamar", remindAt: "2026-09-17T10:00:00Z" }
};

const stubFor = (category: CapabilityExecutorCategory) => ({
  execute: vi.fn(async (proposal: { actionId: string; action: string }) => ({
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: 1,
    status: "SUCCEEDED",
    userSummary: `routed:${category}`
  })),
  prepare: vi.fn(),
  release: vi.fn()
});

const executor = createActionExecutor({
  plannerExecutor: createPlannerActionExecutor({
    plannerService,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    timeZone: () => "America/Bogota",
    logError: vi.fn()
  }),
  applicationExecutor: stubFor("APPLICATION") as never,
  approvedWebExecutor: stubFor("WEB") as never,
  filesExecutor: stubFor("FILES") as never,
  messagingExecutor: stubFor("MESSAGING") as never,
  spotifyExecutor: stubFor("MUSIC") as never
});

const isWellFormed = (value: unknown): boolean =>
  typeof value === "object" && value !== null &&
  typeof (value as { status?: unknown }).status === "string" &&
  typeof (value as { userSummary?: unknown }).userSummary === "string" &&
  (value as { userSummary: string }).userSummary.length > 0;

const run = async (action: string, category: CapabilityExecutorCategory): Promise<{ wellFormed: boolean; routed: boolean }> => {
  try {
    const outcome = await executor.execute(
      { actionId: ID, action, input: minimalInput[action] ?? {} } as never,
      getActionPolicy(action as never)
    );
    const wellFormed = isWellFormed(outcome);
    // Non-planner categories must also arrive at their own executor.
    const routed = category === "PLANNER" ? true : wellFormed && (outcome as { userSummary: string }).userSummary === `routed:${category}`;
    return { wellFormed, routed };
  } catch {
    return { wellFormed: false, routed: false };
  }
};

const findGaps = async (): Promise<string[]> => {
  const gaps: string[] = [];
  for (const capability of ENABLED_ASSISTANT_CAPABILITIES) {
    const result = await run(capability.action, capability.executor);
    if (!result.wellFormed || !result.routed) gaps.push(capability.action);
  }
  return gaps.sort();
};

describe("registry to executor completeness", () => {
  it("covers all 53 enabled actions", () => {
    expect(ENABLED_ASSISTANT_CAPABILITIES).toHaveLength(53);
  });

  it("has no new gap: every enabled action outside KNOWN_GAPS returns a well-formed outcome from its own executor", async () => {
    const newGaps = (await findGaps()).filter((action) => !KNOWN_GAPS.includes(action));
    expect(newGaps).toEqual([]);
  });

  it("keeps KNOWN_GAPS honest: every listed action is still a gap, and the list is exactly the current gap set", async () => {
    const gaps = await findGaps();
    expect(gaps).toEqual([...KNOWN_GAPS].sort());
    for (const action of KNOWN_GAPS) {
      const capability = ENABLED_ASSISTANT_CAPABILITIES.find((entry) => entry.action === action);
      expect(capability, `${action} must still be registered`).toBeDefined();
    }
  });

  it("shows the habit gap concretely: the planner executor resolves to nothing for each habit action", async () => {
    for (const action of KNOWN_GAPS) {
      const outcome = await executor.execute({ actionId: ID, action, input: {} } as never, getActionPolicy(action as never));
      expect(outcome, action).toBeUndefined();
    }
  });

  it("covers the weekly-schedule actions: they have a dispatch path and are not gaps", async () => {
    for (const action of ["GET_WEEKLY_SCHEDULE_DETAILS", "ANALYZE_WEEKLY_SCHEDULE", "GET_TODAY_AVAILABILITY", "CREATE_WEEKLY_SCHEDULE", "UPDATE_WEEKLY_SCHEDULE", "CREATE_WEEKLY_ROUTINE", "UPDATE_WEEKLY_ROUTINE"]) {
      expect((await run(action, "PLANNER")).wellFormed, action).toBe(true);
    }
  });

  it("routes every non-planner action to the executor of its registered category", async () => {
    for (const capability of ENABLED_ASSISTANT_CAPABILITIES.filter((entry) => entry.executor !== "PLANNER")) {
      expect((await run(capability.action, capability.executor)).routed, capability.action).toBe(true);
    }
  });
});
