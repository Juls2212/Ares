import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createMessagingActionExecutor } from "../src/main/actions/messaging-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { createFakeMessagingFlow } from "./helpers/fake-messaging";
import type { ActionSubmission } from "../src/shared/action-contracts";

/** Every stage of the seven utterances: interpreter → orchestrator → executor → service → (fake) repository. */
const createTrace = () => {
  const flow = createFakeMessagingFlow();
  const unused = { execute: vi.fn() } as never;
  const executor = createActionExecutor({
    plannerExecutor: unused,
    applicationExecutor: unused,
    approvedWebExecutor: unused,
    filesExecutor: unused,
    messagingExecutor: createMessagingActionExecutor({ service: flow.service, logError: vi.fn() })
  });
  let counter = 0;
  const orchestrator = createActionOrchestrator({
    executor,
    historyService: { recordTerminal: vi.fn(async () => ({ ok: true as const, data: {} as never })), list: vi.fn() } as unknown as ActionHistoryService,
    generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: vi.fn()
  });
  const provider = vi.fn(async () => JSON.stringify({ state: "CONVERSATIONAL", summary: "x", responseText: "x", drafts: [], clarifications: [] }));
  const interpreter = createAssistantInterpreter({
    getConfiguration: () => ({ apiKey: "", model: "" }),
    createProvider: () => ({ interpret: provider }),
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    timeZone: () => "America/Bogota",
    resolveMessagingContact: (reference) => flow.service.resolveContactReference(reference),
    hasActiveMessageDraft: () => flow.service.hasActiveDraft()
  });
  const say = async (instruction: string) => {
    const interpreted = await interpreter.interpret({ instruction });
    if (!interpreted.ok) return { interpreted, drafts: [] as ActionSubmission[] };
    return { interpreted, drafts: interpreted.data.drafts as ActionSubmission[] };
  };
  return { flow, orchestrator, say, provider };
};

describe("the seven messaging utterances, stage by stage", () => {
  it("runs save → list → draft → edit → open → discard → delete through every real stage", async () => {
    const trace = createTrace();

    // 1) «guarda un contacto llamado Mamá» → SAVE_CONTACT → form → review → confirm
    const save = await trace.say("guarda un contacto llamado Mamá");
    expect(save.drafts).toEqual([{ action: "SAVE_CONTACT", input: { contactName: "Mamá" } }]);
    const proposing = trace.orchestrator.propose(save.drafts[0]!);
    await vi.waitFor(() => expect(trace.flow.requests.length).toBeGreaterThan(0));
    const request = trace.flow.lastRequest();
    await trace.flow.broker.submit({ requestId: request.requestId, displayName: request.displayName, phone: "300 123 4567" });
    const review = await proposing;
    if (!review.ok || !("confirmationId" in review.data)) throw new Error("Expected a confirmation.");
    const saved = await trace.orchestrator.confirm(review.data.confirmationId);
    expect(saved).toMatchObject({ ok: true, data: { status: "SUCCEEDED", userSummary: "Listo, guardé el contacto «Mamá»." } });
    expect(trace.flow.contacts.size).toBe(1);

    // 2) «qué contactos tengo» → LIST_CONTACTS
    const list = await trace.say("qué contactos tengo");
    expect(list.drafts).toEqual([{ action: "LIST_CONTACTS", input: {} }]);
    await expect(trace.orchestrator.propose(list.drafts[0]!)).resolves.toMatchObject({
      ok: true,
      data: { status: "SUCCEEDED", userSummary: "Tienes 1 contacto: Mamá." }
    });

    // 3) «escríbele a Mamá que llego en diez minutos» → PREPARE_MESSAGE_DRAFT
    const draft = await trace.say("escríbele a Mamá que llego en diez minutos");
    expect(draft.drafts).toEqual([{ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "llego en diez minutos", channel: "WHATSAPP" } }]);
    await expect(trace.orchestrator.propose(draft.drafts[0]!)).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(trace.flow.service.hasActiveDraft()).toBe(true);

    // 4) «cámbialo por llego en veinte minutos» → EDIT_MESSAGE_DRAFT
    const edit = await trace.say("cámbialo por llego en veinte minutos");
    expect(edit.drafts).toEqual([{ action: "EDIT_MESSAGE_DRAFT", input: { body: "llego en veinte minutos" } }]);
    await expect(trace.orchestrator.propose(edit.drafts[0]!)).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(trace.flow.service.getActiveDraft()?.body).toBe("llego en veinte minutos");

    // 5) «envíalo» → OPEN_WHATSAPP_CHAT_WITH_DRAFT → review → confirm → launcher
    const send = await trace.say("envíalo");
    expect(send.drafts).toEqual([{ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }]);
    const openReview = await trace.orchestrator.propose(send.drafts[0]!);
    if (!openReview.ok || !("confirmationId" in openReview.data)) throw new Error("Expected a confirmation.");
    await expect(trace.orchestrator.confirm(openReview.data.confirmationId)).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(trace.flow.open).toHaveBeenCalledWith({ digits: "573001234567", body: "llego en veinte minutos" });

    // 6) «descarta el mensaje» after a new draft
    await trace.orchestrator.propose((await trace.say("escríbele a mamá que ya salí")).drafts[0]!);
    const discard = await trace.say("descarta el mensaje");
    expect(discard.drafts).toEqual([{ action: "DISCARD_MESSAGE_DRAFT", input: {} }]);
    await expect(trace.orchestrator.propose(discard.drafts[0]!)).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });

    // 7) «borra el contacto Mamá» → reinforced confirmation → delete
    const remove = await trace.say("borra el contacto Mamá");
    expect(remove.drafts).toEqual([{ action: "DELETE_CONTACT", input: { contactName: "Mamá" } }]);
    const removeReview = await trace.orchestrator.propose(remove.drafts[0]!);
    if (!removeReview.ok || !("confirmationId" in removeReview.data)) throw new Error("Expected a confirmation.");
    expect(removeReview.data).toMatchObject({ riskLevel: 3 });
    await expect(trace.orchestrator.confirm(removeReview.data.confirmationId)).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(trace.flow.contacts.size).toBe(0);
    expect(trace.provider).not.toHaveBeenCalled();
  });
});
