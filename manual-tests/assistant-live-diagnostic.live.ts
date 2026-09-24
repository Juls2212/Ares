import { describe, expect, it } from "vitest";

import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";

const explicitlyEnabled = process.env.ARES_LIVE_ASSISTANT_CHECK === "1";
const liveCheck = explicitlyEnabled ? it : it.skip;

/**
 * This manual suite has a non-default filename and is excluded by the normal
 * test command. It makes one paid request only after the dedicated script and
 * flag are both selected.
 */
describe("manual local OpenAI assistant diagnostic", () => {
  liveCheck("returns a safe draft without proposing or executing an action", async () => {
    const interpreter = createAssistantInterpreter({ logError: () => undefined });
    const result = await interpreter.interpret({
      instruction: "Crea una tarea llamada Comprar café para mañana."
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.state).toBe("READY");
    expect(result.data.drafts.map((draft) => draft.action)).toEqual(["CREATE_TASK"]);
  }, 15_000);
});
