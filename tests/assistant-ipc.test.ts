import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createAssistantIpcRegistration,
  type AssistantIpcHandler,
  type AssistantIpcHandlerRegistrar
} from "../src/main/ipc/register-assistant-ipc";
import type { AssistantInterpretationService } from "../src/main/assistant/assistant-composition";
import type { AssistantContextService } from "../src/main/assistant/assistant-context-service";
import { IPC_CHANNELS } from "../src/shared/contracts";

describe("assistant IPC registration", () => {
  it("registers the explicit interpretation and context channels once", async () => {
    const handlers = new Map<string, AssistantIpcHandler>();
    const interpret = vi.fn(async () => ({ ok: true as const, data: { state: "READY", drafts: [], clarifications: [], summary: "Listo." } }));
    const register = createAssistantIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ interpret } as unknown as AssistantInterpretationService),
      getContextService: () => ({ set: vi.fn(async () => ({ ok: true, data: { status: "SET", kind: "TASK" } })), clear: vi.fn(() => ({ ok: true, data: { status: "CLEARED" } })) } as unknown as AssistantContextService),
      logError: vi.fn()
    });

    register();
    register();
    expect(IPC_CHANNELS.assistant).toEqual({ interpret: "assistant:interpret", context: { set: "assistant:context:set", clear: "assistant:context:clear" } });
    expect([...handlers.keys()]).toEqual(["assistant:interpret", "assistant:context:set", "assistant:context:clear"]);
    await expect(handlers.get(IPC_CHANNELS.assistant.interpret)?.({ text: "Crear una tarea" }, 9)).resolves.toMatchObject({ ok: true });
    expect(interpret).toHaveBeenCalledWith({ text: "Crear una tarea" }, 9);
  });

  it("maps unexpected handler failures to a controlled redacted unavailable result", async () => {
    const handlers = new Map<string, AssistantIpcHandler>();
    const secret = "raw-provider-response-or-key";
    const logError = vi.fn();
    createAssistantIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ interpret: vi.fn(async () => { throw new Error(secret); }) } as unknown as AssistantInterpretationService),
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.assistant.interpret)?.({ text: "x" }, 1);
    expect(result).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Assistant IPC handler failed.");
  });

  it("delegates set and clear only to the per-window context service", async () => {
    const handlers = new Map<string, AssistantIpcHandler>();
    const set = vi.fn(async () => ({ ok: true as const, data: { status: "SET" as const, kind: "FOLDER" as const } }));
    const clear = vi.fn(() => ({ ok: true as const, data: { status: "CLEARED" as const } }));
    createAssistantIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ interpret: vi.fn() } as unknown as AssistantInterpretationService),
      getContextService: () => ({ set, clear } as unknown as AssistantContextService),
      logError: vi.fn()
    })();
    const input = { selection: { section: "FILES", kind: "FOLDER", reference: { rootId: "DOCUMENTS", relativePath: "inbox" } } };
    await expect(handlers.get(IPC_CHANNELS.assistant.context.set)?.(input, 12)).resolves.toMatchObject({ ok: true, data: { status: "SET" } });
    await expect(handlers.get(IPC_CHANNELS.assistant.context.clear)?.(undefined, 12)).resolves.toMatchObject({ ok: true, data: { status: "CLEARED" } });
    expect(set).toHaveBeenCalledWith(12, input);
    expect(clear).toHaveBeenCalledWith(12);
  });
});
