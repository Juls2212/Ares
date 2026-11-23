import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  attachSpokenAssistantResponse,
  createAssistantIpcRegistration,
  type AssistantIpcHandler,
  type AssistantIpcHandlerRegistrar
} from "../src/main/ipc/register-assistant-ipc";
import type { AssistantInterpretationService } from "../src/main/assistant/assistant-composition";
import type { AssistantContextService } from "../src/main/assistant/assistant-context-service";
import { IPC_CHANNELS } from "../src/shared/contracts";

describe("assistant IPC registration", () => {
  it("issues a Main-bound speech reference for a conversational result", () => {
    const result = attachSpokenAssistantResponse(701, {
      ok: true,
      data: {
        state: "CONVERSATIONAL",
        summary: "Hola, Juli. Estoy listo para ayudarte.",
        drafts: [],
        clarifications: []
      }
    });

    expect(result).toMatchObject({
      ok: true,
      data: { state: "CONVERSATIONAL", spokenResponse: { responseId: expect.any(String) } }
    });
    if (result.ok) expect(result.data.spokenResponse?.text).toBe(result.data.summary);
  });

  it("issues Main-bound speech references only for final assistant outcomes", () => {
    const clear = vi.fn();
    const remember = vi.fn((_windowId: number, text: string) => ({ responseId: `response-${text.length}`, text }));
    const responses = { clear, remember };

    for (const state of ["CONVERSATIONAL", "NEEDS_CLARIFICATION", "REJECTED", "UNAVAILABLE"] as const) {
      const result = attachSpokenAssistantResponse(702, {
        ok: true,
        data: { state, summary: "Respuesta final.", drafts: [], clarifications: [] }
      }, responses);
      expect(result.ok && result.data.spokenResponse).toMatchObject({ responseId: expect.any(String), text: "Respuesta final." });
    }

    const draft = attachSpokenAssistantResponse(702, {
      ok: true,
      data: {
        state: "READY",
        summary: "Listo, esto es lo que preparé.",
        drafts: [{ action: "CREATE_TASK", input: { title: "Informe" } }],
        clarifications: []
      }
    }, responses);
    const providerFailure = attachSpokenAssistantResponse(702, {
      ok: false,
      error: { code: "ASSISTANT_PROVIDER_UNAVAILABLE", userMessage: "La interpretación no está disponible." }
    }, responses);

    expect(draft.ok && draft.data.spokenResponse).toBeUndefined();
    expect(providerFailure.ok ? undefined : providerFailure.error.spokenResponse).toMatchObject({ responseId: expect.any(String) });
    expect(clear).toHaveBeenCalled();
  });

  it("registers only the explicit interpretation channel once", async () => {
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
});
