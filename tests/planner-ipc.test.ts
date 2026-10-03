import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createPlannerIpcRegistration,
  type PlannerIpcHandler,
  type PlannerIpcHandlerRegistrar
} from "../src/main/ipc/register-planner-ipc";
import { IPC_CHANNELS, type OperationResult } from "../src/shared/contracts";
import type { PlannerService } from "../src/main/planner/planner-service";
import type { EventDeletionService } from "../src/main/planner/event-deletion-service";
import type { TaskDeletionService } from "../src/main/planner/task-deletion-service";

type ServiceMethod = keyof PlannerService;

const successResult: OperationResult<never> = { ok: true, data: undefined as never };

const createService = (): { service: PlannerService; methods: Record<ServiceMethod, ReturnType<typeof vi.fn>> } => {
  const methods = {
    createCategory: vi.fn(async () => successResult),
    listCategories: vi.fn(async () => successResult),
    updateCategory: vi.fn(async () => successResult),
    createTask: vi.fn(async () => successResult),
    listTasks: vi.fn(async () => successResult),
    updateTask: vi.fn(async () => successResult),
    completeTask: vi.fn(async () => successResult),
    createEvent: vi.fn(async () => successResult),
    listEvents: vi.fn(async () => successResult),
    updateEvent: vi.fn(async () => successResult),
    deleteEvent: vi.fn(async () => successResult),
    deleteTask: vi.fn(async () => successResult),
    createWeeklyRoutine: vi.fn(async () => successResult),
    listWeeklyRoutines: vi.fn(async () => successResult),
    updateWeeklyRoutine: vi.fn(async () => successResult),
    deleteWeeklyRoutine: vi.fn(async () => successResult),
    createWeeklySchedule: vi.fn(async () => successResult),
    listWeeklySchedules: vi.fn(async () => successResult),
    updateWeeklySchedule: vi.fn(async () => successResult),
    deleteWeeklySchedule: vi.fn(async () => successResult),
    createReminder: vi.fn(async () => successResult),
    listReminders: vi.fn(async () => successResult),
    getTodaySchedule: vi.fn(async () => successResult),
    getWeekSchedule: vi.fn(async () => successResult)
  };

  return { service: methods as unknown as PlannerService, methods };
};

const channelDelegations: ReadonlyArray<{
  channel: string;
  method: ServiceMethod;
  input: Record<string, never>;
}> = [
  { channel: IPC_CHANNELS.planner.categories.create, method: "createCategory", input: {} },
  { channel: IPC_CHANNELS.planner.categories.list, method: "listCategories", input: {} },
  { channel: IPC_CHANNELS.planner.categories.update, method: "updateCategory", input: {} },
  { channel: IPC_CHANNELS.planner.tasks.create, method: "createTask", input: {} },
  { channel: IPC_CHANNELS.planner.tasks.list, method: "listTasks", input: {} },
  { channel: IPC_CHANNELS.planner.tasks.update, method: "updateTask", input: {} },
  { channel: IPC_CHANNELS.planner.tasks.complete, method: "completeTask", input: {} },
  { channel: IPC_CHANNELS.planner.events.create, method: "createEvent", input: {} },
  { channel: IPC_CHANNELS.planner.events.list, method: "listEvents", input: {} },
  { channel: IPC_CHANNELS.planner.events.update, method: "updateEvent", input: {} },
  { channel: IPC_CHANNELS.planner.reminders.create, method: "createReminder", input: {} },
  { channel: IPC_CHANNELS.planner.reminders.list, method: "listReminders", input: {} },
  { channel: IPC_CHANNELS.planner.weeklyRoutines.create, method: "createWeeklyRoutine", input: {} },
  { channel: IPC_CHANNELS.planner.weeklyRoutines.list, method: "listWeeklyRoutines", input: {} },
  { channel: IPC_CHANNELS.planner.weeklyRoutines.update, method: "updateWeeklyRoutine", input: {} },
  { channel: IPC_CHANNELS.planner.weeklyRoutines.delete, method: "deleteWeeklyRoutine", input: {} },
  { channel: IPC_CHANNELS.planner.weeklySchedules.create, method: "createWeeklySchedule", input: {} },
  { channel: IPC_CHANNELS.planner.weeklySchedules.list, method: "listWeeklySchedules", input: {} },
  { channel: IPC_CHANNELS.planner.weeklySchedules.update, method: "updateWeeklySchedule", input: {} },
  { channel: IPC_CHANNELS.planner.weeklySchedules.delete, method: "deleteWeeklySchedule", input: {} },
  { channel: IPC_CHANNELS.planner.schedule.getToday, method: "getTodaySchedule", input: {} },
  { channel: IPC_CHANNELS.planner.schedule.getWeek, method: "getWeekSchedule", input: {} }
];

describe("planner IPC registration", () => {
  it("delegates task deletion only through explicit reinforced-confirmation operations", async () => {
    const handlers = new Map<string, PlannerIpcHandler>();
    const { service, methods } = createService();
    const deletion = { request: vi.fn(async () => successResult), confirm: vi.fn(async () => successResult), cancel: vi.fn(async () => successResult) };
    createPlannerIpcRegistration({ registerHandler: (channel, handler) => handlers.set(channel, handler), getService: () => service, getTaskDeletionService: () => deletion as TaskDeletionService, logError: vi.fn() })();
    const input = { taskId: "task-id", confirmationId: "opaque-token" };
    for (const [channel, method] of [[IPC_CHANNELS.planner.tasks.requestDeletion, "request"], [IPC_CHANNELS.planner.tasks.confirmDeletion, "confirm"], [IPC_CHANNELS.planner.tasks.cancelDeletion, "cancel"]] as const) {
      expect(await handlers.get(channel)!(input)).toEqual(successResult);
      expect(deletion[method]).toHaveBeenCalledWith(input);
    }
    expect(methods.deleteTask).not.toHaveBeenCalled();
    expect(handlers.has("planner:tasks:delete")).toBe(false);
  });
  it("registers every approved channel exactly once", () => {
    const handlers = new Map<string, PlannerIpcHandler>();
    const registerHandler: PlannerIpcHandlerRegistrar = (channel, handler) => {
      handlers.set(channel, handler);
    };
    const { service } = createService();
    const register = createPlannerIpcRegistration({
      registerHandler,
      getService: () => service,
      logError: vi.fn()
    });

    register();
    register();

    expect([...handlers.keys()]).toEqual([
      ...channelDelegations.slice(0, 8).map(({ channel }) => channel),
      IPC_CHANNELS.planner.tasks.requestDeletion,
      IPC_CHANNELS.planner.tasks.confirmDeletion,
      IPC_CHANNELS.planner.tasks.cancelDeletion,
      ...channelDelegations.slice(8, 10).map(({ channel }) => channel),
      IPC_CHANNELS.planner.events.requestDeletion,
      IPC_CHANNELS.planner.events.confirmDeletion,
      IPC_CHANNELS.planner.events.cancelDeletion,
      ...channelDelegations.slice(10).map(({ channel }) => channel)
    ]);
    expect(handlers.size).toBe(28);
    expect(handlers.has("planner:events:delete")).toBe(false);
  });

  it("delegates only narrow event deletion request, confirmation, and cancellation", async () => {
    const handlers = new Map<string, PlannerIpcHandler>();
    const { service, methods } = createService();
    const deletion = {
      request: vi.fn(async () => successResult),
      confirm: vi.fn(async () => successResult),
      cancel: vi.fn(async () => successResult)
    } as unknown as EventDeletionService;
    createPlannerIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getDeletionService: () => deletion,
      logError: vi.fn()
    })();
    const input = { eventId: "event-id", confirmationId: "opaque-token" };
    for (const [channel, method] of [
      [IPC_CHANNELS.planner.events.requestDeletion, "request"],
      [IPC_CHANNELS.planner.events.confirmDeletion, "confirm"],
      [IPC_CHANNELS.planner.events.cancelDeletion, "cancel"]
    ] as const) {
      expect(await handlers.get(channel)?.(input)).toEqual(successResult);
      expect(deletion[method]).toHaveBeenCalledWith(input);
    }
    expect(methods.deleteEvent).not.toHaveBeenCalled();
  });

  it.each(channelDelegations)("delegates $channel to $method", async ({ channel, method, input }) => {
    const handlers = new Map<string, PlannerIpcHandler>();
    const { service, methods } = createService();
    createPlannerIpcRegistration({
      registerHandler: (registeredChannel, handler) => handlers.set(registeredChannel, handler),
      getService: () => service,
      logError: vi.fn()
    })();

    const result = await handlers.get(channel)?.(input);

    expect(result).toEqual(successResult);
    expect(methods[method]).toHaveBeenCalledWith(input);
  });

  it("returns a controlled result when an unexpected handler failure occurs", async () => {
    const handlers = new Map<string, PlannerIpcHandler>();
    const { service, methods } = createService();
    const secret = "do-not-expose-this-database-error";
    methods.createTask.mockRejectedValueOnce(new Error(secret));
    const logError = vi.fn();
    createPlannerIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.planner.tasks.create)?.({});

    expect(result).toEqual({
      ok: false,
      error: {
        code: "PLANNER_IPC_UNAVAILABLE",
        userMessage: "No se pudo procesar la solicitud del planificador."
      }
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Planner IPC handler failed.");
  });
});
