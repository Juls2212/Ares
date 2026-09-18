import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createActionIpcRegistration,
  type ActionIpcHandler,
  type ActionIpcHandlerRegistrar
} from "../src/main/ipc/register-action-ipc";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import type { ActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { IPC_CHANNELS, type OperationResult } from "../src/shared/contracts";

const confirmationId = "11111111-1111-4111-8111-111111111111";
const successResult: OperationResult<never> = { ok: true, data: undefined as never };

const createOrchestrator = (): {
  orchestrator: ActionOrchestrator;
  methods: Record<"propose" | "confirm" | "cancel", ReturnType<typeof vi.fn>>;
} => {
  const methods = {
    propose: vi.fn(async () => successResult),
    confirm: vi.fn(async () => successResult),
    cancel: vi.fn(async () => successResult)
  };
  return { orchestrator: methods as unknown as ActionOrchestrator, methods };
};

const createHistoryService = (): {
  service: ActionHistoryService;
  list: ReturnType<typeof vi.fn>;
} => {
  const list = vi.fn(async () => successResult);
  return {
    service: { recordTerminal: vi.fn(), list } as unknown as ActionHistoryService,
    list
  };
};

const channelDelegations: ReadonlyArray<{
  channel: string;
  method: "propose" | "confirm" | "cancel" | "list";
  input: unknown;
}> = [
  { channel: IPC_CHANNELS.actions.propose, method: "propose", input: { action: "CREATE_TASK", input: { title: "Informe" } } },
  { channel: IPC_CHANNELS.actions.confirm, method: "confirm", input: confirmationId },
  { channel: IPC_CHANNELS.actions.cancel, method: "cancel", input: confirmationId },
  { channel: IPC_CHANNELS.actions.history.list, method: "list", input: { limit: 10 } }
];

describe("action IPC registration", () => {
  it("registers exactly the four approved action channels once", () => {
    const handlers = new Map<string, ActionIpcHandler>();
    const registerHandler: ActionIpcHandlerRegistrar = (channel, handler) => handlers.set(channel, handler);
    const { orchestrator } = createOrchestrator();
    const { service } = createHistoryService();
    const register = createActionIpcRegistration({
      registerHandler,
      getOrchestrator: () => orchestrator,
      getHistoryService: () => service,
      logError: vi.fn()
    });

    register();
    register();

    expect(IPC_CHANNELS.actions).toEqual({
      propose: "actions:propose",
      confirm: "actions:confirm",
      cancel: "actions:cancel",
      history: { list: "actions:history:list" }
    });
    expect([...handlers.keys()]).toEqual(channelDelegations.map(({ channel }) => channel));
    expect(handlers.size).toBe(4);
  });

  it.each(channelDelegations)("delegates $channel only to $method", async ({ channel, method, input }) => {
    const handlers = new Map<string, ActionIpcHandler>();
    const { orchestrator, methods } = createOrchestrator();
    const { service, list } = createHistoryService();
    createActionIpcRegistration({
      registerHandler: (registeredChannel, handler) => handlers.set(registeredChannel, handler),
      getOrchestrator: () => orchestrator,
      getHistoryService: () => service,
      logError: vi.fn()
    })();

    const result = await handlers.get(channel)?.(input);

    expect(result).toEqual(successResult);
    if (method === "list") {
      expect(list).toHaveBeenCalledWith(input);
    } else {
      expect(methods[method]).toHaveBeenCalledWith(input);
    }
  });

  it("maps unexpected handler failures without leaking raw details", async () => {
    const handlers = new Map<string, ActionIpcHandler>();
    const { orchestrator, methods } = createOrchestrator();
    const { service } = createHistoryService();
    const secret = "do-not-expose-this-database-error";
    methods.propose.mockRejectedValueOnce(new Error(secret));
    const logError = vi.fn();
    createActionIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getOrchestrator: () => orchestrator,
      getHistoryService: () => service,
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.actions.propose)?.({ action: "CREATE_TASK", input: {} });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ACTION_IPC_UNAVAILABLE",
        userMessage: "No se pudo procesar la solicitud de acción."
      }
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Action IPC handler failed.");
  });
});
