import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: {}, dialog: {} }));
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { attachSpokenAssistantResponse } from "../src/main/ipc/register-assistant-ipc";

const now = "2026-09-20T15:00:00.000Z";

const conversational = JSON.stringify({
  state: "CONVERSATIONAL",
  summary: "Conversación",
  responseText: "Hola, ¿en qué te ayudo?",
  drafts: [],
  clarifications: []
});

const createInterpreter = () => {
  const interpret = vi.fn(async () => conversational);
  return {
    interpret,
    interpreter: createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret }),
      now: () => new Date(now),
      timeZone: () => "America/Bogota"
    })
  };
};

describe("alias-only utterances", () => {
  it.each([
    ["WhatsApp", "¿Quieres que abra o que registre WhatsApp?"],
    ["Discord", "¿Quieres que abra o que registre Discord?"],
    ["Claude", "¿Quieres que abra o que registre Claude?"],
    ["Spotify", "¿Quieres que abra o que registre Spotify?"],
    ["  ¿Whats App?  ", "¿Quieres que abra o que registre WhatsApp?"],
    ["spotify.", "¿Quieres que abra o que registre Spotify?"]
  ])("asks whether to open or register %s instead of treating it as small talk", async (utterance, question) => {
    const { interpret, interpreter } = createInterpreter();

    const result = await interpreter.interpret({ instruction: utterance });

    expect(result).toMatchObject({
      ok: true,
      data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: question, clarifications: [{ question }] }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("produces no draft, so no action and no confirmation dialog can follow", async () => {
    const { interpreter } = createInterpreter();
    const result = await interpreter.interpret({ instruction: "WhatsApp" });
    expect(result.ok && result.data.drafts).toEqual([]);
    expect(result.ok && result.data.state).not.toBe("READY");
  });

  it("asks only to open a registered alias that is not in the catalog", async () => {
    const { interpret, interpreter } = createInterpreter();
    const result = await interpreter.interpret({ instruction: "Notepad" }, { knownApplicationAliases: ["notepad"] });
    expect(result).toMatchObject({
      ok: true,
      data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: "¿Quieres que abra esa aplicación registrada?" }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("does not echo the transcript in the clarification", async () => {
    const { interpreter } = createInterpreter();
    const result = await interpreter.interpret({ instruction: "Notepad" }, { knownApplicationAliases: ["notepad"] });
    expect(JSON.stringify(result)).not.toMatch(/notepad/i);
  });

  it("speaks the clarification through the existing final-state path", async () => {
    const { interpreter } = createInterpreter();
    const result = await interpreter.interpret({ instruction: "WhatsApp" });
    const remember = vi.fn(() => ({ responseId: "r", text: "t" }) as never);
    attachSpokenAssistantResponse(1, result, { clear: vi.fn(), remember });
    expect(remember).toHaveBeenCalledWith(1, "¿Quieres que abra o que registre WhatsApp?");
  });

  it("still sends a sentence with a verb to the provider", async () => {
    const { interpret, interpreter } = createInterpreter();
    await interpreter.interpret({ instruction: "Hola, ¿cómo estás con WhatsApp?" });
    await interpreter.interpret({ instruction: "Abre WhatsApp" });
    expect(interpret).toHaveBeenCalledTimes(2);
  });

  it("does not collide a different word with a catalog alias", async () => {
    const { interpret, interpreter } = createInterpreter();
    await interpreter.interpret({ instruction: "Claudia" });
    expect(interpret).toHaveBeenCalledOnce();
  });
});
