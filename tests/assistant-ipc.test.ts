import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createAssistantIpcRegistration,
  type AssistantIpcHandler,
  type AssistantIpcHandlerRegistrar
} from "../src/main/ipc/register-assistant-ipc";
import type { AssistantInterpretationService } from "../src/main/assistant/assistant-composition";
import { IPC_CHANNELS } from "../src/shared/contracts";

describe("assistant IPC registration", () => {
  it("registers only the interpretation channel once and delegates to the lazy service", async () => {
    const handlers = new Map<string, AssistantIpcHandler>();
    const interpret = vi.fn(async () => ({ ok: true as const, data: { state: "READY", drafts: [], clarifications: [], summary: "Listo." } }));
    const register = createAssistantIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ interpret } as unknown as AssistantInterpretationService),
      logError: vi.fn()
    });

    register();
    register();
    expect(IPC_CHANNELS.assistant).toEqual({ interpret: "assistant:interpret" });
    expect([...handlers.keys()]).toEqual(["assistant:interpret"]);
    await expect(handlers.get(IPC_CHANNELS.assistant.interpret)?.({ text: "Crear una tarea" })).resolves.toMatchObject({ ok: true });
    expect(interpret).toHaveBeenCalledWith({ text: "Crear una tarea" });
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

    const result = await handlers.get(IPC_CHANNELS.assistant.interpret)?.({ text: "x" });
    expect(result).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Assistant IPC handler failed.");
  });
});
