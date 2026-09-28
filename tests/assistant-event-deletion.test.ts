import { describe, expect, it, vi } from "vitest";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { createEventDeletionResolver } from "../src/main/assistant/assistant-event-reference";
import { OPENAI_INTERPRETATION_OUTPUT_SCHEMA } from "../src/main/assistant/openai-structured-provider";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import type { EventRecord } from "../src/shared/planner-contracts";

const eventId = "550e8400-e29b-41d4-a716-446655440000";
const record = (id = eventId, startAt = "2026-09-28T15:00:00Z"): EventRecord => ({
  id, title: "Reunión", startAt, endAt: null, description: null, categoryId: null, location: null,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z"
});
const fixture = (events: EventRecord[], input: unknown = { eventTitle: "Reunión" }) => {
  const listEvents = vi.fn(async () => ({ ok: true as const, data: { items: events, total: events.length } }));
  const provider = vi.fn(async () => JSON.stringify({
    state: "READY", summary: "provider text", responseText: "", drafts: [{ action: "DELETE_EVENT", input: JSON.stringify(input) }], clarifications: []
  }));
  const interpreter = createAssistantInterpreter({
    getConfiguration: () => ({ apiKey: "", model: "" }),
    createProvider: () => ({ interpret: provider }),
    now: () => new Date("2026-09-25T15:00:00Z"), timeZone: () => "America/Bogota",
    resolveEventDeletion: createEventDeletionResolver(() => ({ listEvents }))
  });
  return { interpreter, listEvents, provider };
};

describe("assistant event deletion routing", () => {
  it("allows only structured DELETE_EVENT and resolves one real event before reinforced proposal", async () => {
    expect(OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.drafts.items.properties.action.enum).toContain("DELETE_EVENT");
    const { interpreter, provider } = fixture([record()]);
    const result = await interpreter.interpret({ instruction: "Elimina el evento Reunión" });
    expect(result).toMatchObject({ ok: true, data: {
      state: "READY", drafts: [{ action: "DELETE_EVENT", input: { eventId } }]
    } });
    if (!result.ok) throw new Error("Expected interpretation.");
    expect(result.data.summary).toContain("requiere confirmación explícita");
    expect(JSON.stringify(provider.mock.calls)).not.toContain(eventId);
    const execute = vi.fn();
    const orchestrator = createActionOrchestrator({
      executor: { execute },
      historyService: { recordTerminal: vi.fn(), list: vi.fn() } as ActionHistoryService,
      generateIdentifier: vi.fn()
        .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
        .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
    });
    expect(await orchestrator.propose(result.data.drafts[0])).toMatchObject({ ok: true, data: {
      action: "DELETE_EVENT", riskLevel: 3, lifecycleState: "AWAITING_CONFIRMATION"
    } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("clarifies missing and ambiguous matches rather than guessing an event", async () => {
    const missing = await fixture([]).interpreter.interpret({ instruction: "Elimina el evento Reunión" });
    const ambiguous = await fixture([record(), record("550e8400-e29b-41d4-a716-446655440001")]).interpreter.interpret({ instruction: "Elimina el evento Reunión" });
    expect(missing).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(ambiguous).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(JSON.stringify(missing)).toContain("título exacto");
    expect(JSON.stringify(ambiguous)).toContain("fecha y hora exactas");
  });

  it("uses an exact explicit instant to distinguish duplicate event titles", async () => {
    const { interpreter, listEvents } = fixture([
      record(), record("550e8400-e29b-41d4-a716-446655440001", "2026-09-29T15:00:00Z")
    ], { eventTitle: "Reunión", startAt: "2026-09-28T10:00:00-05:00" });
    expect(await interpreter.interpret({ instruction: "Elimina Reunión del 2026-09-28T10:00:00-05:00" })).toMatchObject({
      ok: true, data: { state: "READY", drafts: [{ action: "DELETE_EVENT", input: { eventId } }] }
    });
    expect(listEvents).toHaveBeenCalledWith({ startAt: "2026-09-28T10:00:00-05:00" });
  });

  it("accepts only Main validated event context, never a model-authored UUID", async () => {
    const direct = fixture([record()], { eventId });
    expect(await direct.interpreter.interpret({ instruction: "Elimina Reunión" })).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(direct.listEvents).not.toHaveBeenCalled();
    const selected = fixture([], { eventId: "$CURRENT_CONTEXT" });
    expect(await selected.interpreter.interpret({ instruction: "Elimina este evento" }, undefined, {
      selection: { section: "PLANNER", kind: "EVENT", id: eventId },
      providerContext: { token: "$CURRENT_CONTEXT", kind: "EVENT", label: "Reunión" }
    })).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "DELETE_EVENT", input: { eventId } }] } });
  });

  it("rejects invented titles and redacts failed Main lookups", async () => {
    const invented = fixture([record()]);
    expect(await invented.interpreter.interpret({ instruction: "Elimina otro evento" })).toMatchObject({ ok: true, data: { state: "REJECTED", drafts: [] } });
    expect(invented.listEvents).not.toHaveBeenCalled();
    const failed = fixture([record()]);
    failed.listEvents.mockRejectedValueOnce(new Error("private database detail"));
    const result = await failed.interpreter.interpret({ instruction: "Elimina Reunión" });
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });

  it("does not let a guessed timestamp select one of several events", async () => {
    const { interpreter, listEvents } = fixture([record()], { eventTitle: "Reunión", startAt: "2026-09-28T15:00:00Z" });
    expect(await interpreter.interpret({ instruction: "Elimina Reunión" })).toMatchObject({
      ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] }
    });
    expect(listEvents).not.toHaveBeenCalled();
  });
});
