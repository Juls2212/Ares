import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createPlannerIpcRegistration,
  type PlannerIpcHandler,
  type PlannerIpcHandlerRegistrar
} from "../src/main/ipc/register-planner-ipc";
import { IPC_CHANNELS, type OperationResult } from "../src/shared/contracts";
import type { PlannerService } from "../src/main/planner/planner-service";

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
  { channel: IPC_CHANNELS.planner.schedule.getToday, method: "getTodaySchedule", input: {} },
  { channel: IPC_CHANNELS.planner.schedule.getWeek, method: "getWeekSchedule", input: {} }
];

describe("planner IPC registration", () => {
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

    expect([...handlers.keys()]).toEqual(channelDelegations.map(({ channel }) => channel));
    expect(handlers.size).toBe(14);
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
