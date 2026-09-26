import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createVoiceTranscriptSubmission } from "../src/renderer/features/voice/voice-transcript-submission";
import type { AssistantInterpretation } from "../src/shared/assistant-contracts";
import type { ActionSubmission } from "../src/shared/action-contracts";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";

const task: ActionSubmission = { action: "CREATE_TASK", input: { title: "Test task" } };
const ready = (drafts: ActionSubmission[] = [task]): AssistantInterpretation => ({ state: "READY", summary: "Instrucción preparada.", drafts, clarifications: [] });
const fixture = (result = ready()) => ({
  generation: 1, text: "Crea una tarea", isCurrent: () => true,
  showTranscript: vi.fn(), interpret: vi.fn(async () => result), propose: vi.fn(async () => {})
});

describe("explicit voice instruction submission", () => {
  it("executes direct voice proposals in Main but leaves file changes and deletions pending", async () => {
    const execute = vi.fn(async (proposal: any) => ({ actionId: proposal.actionId, action: proposal.action, riskLevel: 1 as const, status: "SUCCEEDED" as const, userSummary: "Se creó la tarea." }));
    const orchestrator = createActionOrchestrator({ executor: { execute }, historyService: { recordTerminal: vi.fn(async () => ({ ok: false as const, error: { code: "TEST_HISTORY", userMessage: "Historial no disponible." } })), list: vi.fn() }, logError: vi.fn() });
    const drafts: ActionSubmission[] = [task, { action: "RENAME_FILE", input: { source: { rootId: "DOCUMENTS", relativePath: "report.txt" }, newName: "summary.txt" } }, { action: "DELETE_TASK", input: { taskId: "550e8400-e29b-41d4-a716-446655440000" } }, { action: "DELETE_EVENT", input: { eventId: "550e8400-e29b-41d4-a716-446655440001" } }];
    const outcomes: unknown[] = [];
    const f = { ...fixture(ready(drafts)), propose: async (_index: number, draft: ActionSubmission) => { outcomes.push(await orchestrator.propose(draft)); } };
    await createVoiceTranscriptSubmission().submit(f);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0].action).toBe("CREATE_TASK");
    expect(outcomes[1]).toMatchObject({ ok: true, data: { lifecycleState: "AWAITING_CONFIRMATION", riskLevel: 2 } });
    for (const result of outcomes.slice(2)) expect(result).toMatchObject({ ok: true, data: { lifecycleState: "AWAITING_CONFIRMATION", riskLevel: 3 } });
  });
  it("interprets and proposes successful voice text once without an Interpretar click", async () => {
    const flow = createVoiceTranscriptSubmission(); const f = fixture();
    await flow.submit(f); await flow.submit(f);
    expect(f.showTranscript).toHaveBeenCalledWith(f.text);
    expect(f.interpret).toHaveBeenCalledOnce(); expect(f.propose).toHaveBeenCalledExactlyOnceWith(0, task);
  });
  it("does not submit cancelled, empty, clarification, rejected or failed interpretations", async () => {
    for (const state of ["NEEDS_CLARIFICATION", "REJECTED", "UNAVAILABLE"] as const) {
      const f = fixture({ ...ready(), state }); await createVoiceTranscriptSubmission().submit(f);
      expect(f.propose).not.toHaveBeenCalled();
    }
    for (const change of [{ text: " " }, { isCurrent: () => false }]) {
      const f = { ...fixture(), ...change }; await createVoiceTranscriptSubmission().submit(f);
      expect(f.showTranscript).not.toHaveBeenCalled(); expect(f.interpret).not.toHaveBeenCalled();
    }
  });
  it("ignores concurrent/replayed delivery and cancellation while interpretation is pending", async () => {
    let complete!: (result: AssistantInterpretation) => void; let current = true;
    const f = { ...fixture(), isCurrent: () => current, interpret: vi.fn(() => new Promise<AssistantInterpretation>(resolve => { complete = resolve; })) };
    const flow = createVoiceTranscriptSubmission(); const first = flow.submit(f);
    await flow.submit(f); current = false; complete(ready()); await first;
    expect(f.interpret).toHaveBeenCalledOnce(); expect(f.propose).not.toHaveBeenCalled();
  });
  it("preserves ordered drafts and delegates all risk decisions without confirming anything", async () => {
    const drafts: ActionSubmission[] = [task, { action: "DELETE_TASK", input: { taskId: "550e8400-e29b-41d4-a716-446655440000" } }, { action: "DELETE_EVENT", input: { eventId: "550e8400-e29b-41d4-a716-446655440001" } }];
    const f = fixture(ready(drafts)); await createVoiceTranscriptSubmission().submit(f);
    expect(f.propose.mock.calls).toEqual(drafts.map((draft, index) => [index, draft]));
    const source = readFileSync("src/renderer/features/voice/voice-transcript-submission.ts", "utf8");
    expect(source).not.toMatch(/\.confirm\(|\.execute\(|riskLevel|riskClassification/);
  });
  it("keeps typed submission button-driven and failed audio separate from input replacement", () => {
    const source = readFileSync("src/renderer/app/App.tsx", "utf8");
    expect(source).toContain("await submitInstruction(instruction);");
    expect(source).toContain("submitInstruction(text, true");
    expect(source.indexOf("if (!result.ok) return setVoiceMessage")).toBeLessThan(source.indexOf("voiceSubmission.current.submit"));
    expect(source).toContain("generation <= voiceUploadGeneration.current");
  });
});
