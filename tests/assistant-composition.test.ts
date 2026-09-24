import { describe, expect, it, vi } from "vitest";

import {
  createAssistantInterpretationService,
  type AssistantInterpreter
} from "../src/main/assistant/assistant-composition";

const readyResult = {
  ok: true as const,
  data: {
    state: "READY" as const,
    summary: "Interpretación lista.",
    drafts: [],
    clarifications: []
  }
};

describe("assistant interpretation composition", () => {
  it("maps the public text request to the internal instruction contract", async () => {
    const interpret = vi.fn(async () => readyResult);
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter)
    });

    await expect(service.interpret({ text: "Crear una tarea" })).resolves.toEqual(readyResult);
    expect(interpret).toHaveBeenCalledWith({ instruction: "Crear una tarea" });
  });

  it("rejects malformed public input before reaching the interpreter", async () => {
    const interpret = vi.fn(async () => readyResult);
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter)
    });

    const result = await service.interpret({ text: "x", context: "forbidden" });
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("permits one in-flight interpretation and rejects concurrent requests without a second provider call", async () => {
    let resolveFirst: ((value: typeof readyResult) => void) | undefined;
    const interpret = vi.fn(
      () => new Promise<typeof readyResult>((resolve) => { resolveFirst = resolve; })
    );
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter)
    });

    const first = service.interpret({ text: "Primera" });
    const second = await service.interpret({ text: "Segunda" });
    expect(second).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_BUSY" } });
    expect(interpret).toHaveBeenCalledTimes(1);

    resolveFirst?.(readyResult);
    await expect(first).resolves.toEqual(readyResult);
  });

  it("maps an unexpected interpreter failure without leaking technical details", async () => {
    const secret = "provider-key-or-database-detail";
    const service = createAssistantInterpretationService({
      getInterpreter: () => ({ interpret: vi.fn(async () => { throw new Error(secret); }) } as unknown as AssistantInterpreter)
    });

    const result = await service.interpret({ text: "Solicitud" });
    expect(result).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
