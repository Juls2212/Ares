import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { evaluateActionProposal, getActionPolicy } from "../src/main/actions/action-policy";
import { createMessagingActionExecutor } from "../src/main/actions/messaging-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { sanitizeActionHistoryMetadata } from "../src/main/actions/action-history-service";
import { attachSpokenActionResponse } from "../src/main/ipc/register-action-ipc";
import { MESSAGING_FAILURES } from "../src/main/messaging/messaging-failures";
import { composeFinalResponse } from "../src/main/voice/final-response-composer";
import { createFakeMessagingFlow, type FakeMessagingFlow } from "./helpers/fake-messaging";

const PHONE = "3001234567";
const FULL_NUMBER = "573001234567";

const createFlow = (flow: FakeMessagingFlow = createFakeMessagingFlow(), service = flow.service) => {
  const unused = { execute: vi.fn() } as never;
  const logError = vi.fn();
  const executor = createActionExecutor({
    plannerExecutor: unused,
    applicationExecutor: unused,
    approvedWebExecutor: unused,
    filesExecutor: unused,
    messagingExecutor: createMessagingActionExecutor({ service, logError })
  });
  const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
  let counter = 0;
  const orchestratorLog = vi.fn();
  const orchestrator = createActionOrchestrator({
    executor,
    historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
    generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: orchestratorLog
  });
  return { ...flow, orchestrator, recordTerminal, executor, executorLog: logError, orchestratorLog };
};

type Flow = ReturnType<typeof createFlow>;

const confirmationOf = (result: Awaited<ReturnType<Flow["orchestrator"]["propose"]>>) => {
  if (!result.ok || !("confirmationId" in result.data)) throw new Error("Expected a confirmation.");
  return result.data;
};

/** Proposes SAVE_CONTACT, answers the Main-initiated form with the given number, and returns the result. */
const proposeSave = async (flow: Flow, contactName: string, phone: string) => {
  const proposing = flow.orchestrator.propose({ action: "SAVE_CONTACT", input: { contactName } });
  await vi.waitFor(() => expect(flow.requests.length).toBeGreaterThan(0));
  const request = flow.lastRequest();
  await flow.broker.submit({ requestId: request.requestId, displayName: request.displayName, phone });
  return proposing;
};

const everythingRecorded = (flow: Flow): string =>
  JSON.stringify([flow.recordTerminal.mock.calls, flow.logError.mock.calls, flow.executorLog.mock.calls, flow.orchestratorLog.mock.calls]);

describe("policy and routing for the MESSAGING domain", () => {
  it.each([
    ["SAVE_CONTACT", "CONFIRMATION_REQUIRED", 2],
    ["LIST_CONTACTS", "DIRECT", 1],
    ["DELETE_CONTACT", "REINFORCED_CONFIRMATION_REQUIRED", 3],
    ["PREPARE_MESSAGE_DRAFT", "DIRECT", 1],
    ["EDIT_MESSAGE_DRAFT", "DIRECT", 1],
    ["DISCARD_MESSAGE_DRAFT", "DIRECT", 1],
    ["OPEN_WHATSAPP_CHAT_WITH_DRAFT", "CONFIRMATION_REQUIRED", 2]
  ] as const)("classifies %s as %s", (action, approval, riskLevel) => {
    expect(getActionPolicy(action)).toMatchObject({ approval, riskLevel, availability: "IMPLEMENTED" });
    expect(evaluateActionProposal({ action })).toMatchObject({ ok: true, data: { approval } });
  });

  it.each(["SEND_MESSAGE", "OPEN_CHAT", "OPEN_URL", "READ_CONTACTS", "IMPORT_CONTACTS", "SEND_WHATSAPP"])(
    "rejects the unregistered action %s at the policy and at the orchestrator",
    async (action) => {
      expect(evaluateActionProposal({ action })).toMatchObject({ ok: false });
      const flow = createFlow();
      await expect(flow.orchestrator.propose({ action, input: {} })).resolves.toMatchObject({ ok: false });
      expect(flow.requests).toHaveLength(0);
    }
  );

  it("routes a messaging action only to the MESSAGING executor and refuses any other shape", async () => {
    const flow = createFlow();
    const policy = getActionPolicy("LIST_CONTACTS");
    await expect(flow.executor.execute({ actionId: "a", action: "SEND_MESSAGE", input: {} } as never, policy)).resolves.toMatchObject({
      status: "VALIDATION_FAILED", errorCode: "ACTION_UNSUPPORTED"
    });
  });

  it("accepts no phone number, identifier, link or extra field in any submission", async () => {
    const flow = createFlow();
    flow.seed("Mamá", FULL_NUMBER);
    for (const submission of [
      { action: "SAVE_CONTACT", input: { contactName: "Mamá", phone: PHONE } },
      { action: "SAVE_CONTACT", input: { contactName: "Mamá", phoneNumber: PHONE } },
      { action: "SAVE_CONTACT", input: { contactName: "Mamá", pendingId: "00000000-0000-4000-8000-000000000001" } },
      { action: "SAVE_CONTACT", input: { contactName: "Mamá", aliases: ["a", "b", "c", "d"] } },
      { action: "SAVE_CONTACT", input: {} },
      { action: "DELETE_CONTACT", input: { contactName: "Mamá", contactId: "contact-1" } },
      { action: "DELETE_CONTACT", input: { contactName: "Mamá", preparedId: "00000000-0000-4000-8000-000000000001" } },
      { action: "LIST_CONTACTS", input: { includeNumbers: true } },
      { action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "hola", channel: "DISCORD" } },
      { action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "hola", channel: "WHATSAPP", phone: PHONE } },
      { action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "hola" } },
      { action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "hola", channel: "WHATSAPP", url: "https://wa.me/1" } },
      { action: "EDIT_MESSAGE_DRAFT", input: { body: "hola", contactId: "contact-1" } },
      { action: "DISCARD_MESSAGE_DRAFT", input: { all: true } },
      { action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: { phone: PHONE } },
      { action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: { url: "https://wa.me/573001234567" } },
      { action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: { preparedId: "00000000-0000-4000-8000-000000000001" } },
      { action: "SAVE_CONTACT", input: "Mamá" },
      { action: "SAVE_CONTACT" }
    ]) {
      await expect(flow.orchestrator.propose(submission)).resolves.toMatchObject({
        ok: false, error: { code: "ACTION_PROPOSAL_INVALID" }
      });
    }
    expect(flow.requests).toHaveLength(0);
    expect(flow.repository.insert).not.toHaveBeenCalled();
  });
});

describe("save contact flow", () => {
  it("opens the form, shows a masked review, writes nothing before confirmation and once after", async () => {
    const flow = createFlow();
    const proposed = await proposeSave(flow, "Mamá", "300 123 4567");
    const awaiting = confirmationOf(proposed);

    expect(flow.requests).toEqual([{ requestId: expect.any(String), displayName: "Mamá" }]);
    expect(awaiting).toMatchObject({
      action: "SAVE_CONTACT",
      riskLevel: 2,
      confirmation: { required: true, summary: "Se guardará el contacto «Mamá» con el número •••• 4567.", scopeSummary: "Contacto nuevo" }
    });
    expect(JSON.stringify(proposed)).not.toMatch(/573001234567|3001234567|300 123|pendingId|pending/u);
    expect(flow.repository.insert).not.toHaveBeenCalled();

    const confirmed = await flow.orchestrator.confirm(awaiting.confirmationId);
    expect(confirmed).toMatchObject({
      ok: true,
      data: { status: "SUCCEEDED", userSummary: "Listo, guardé el contacto «Mamá».", data: { kind: "CONTACT_SAVED", contactName: "Mamá" } }
    });
    expect(JSON.stringify(confirmed)).not.toMatch(/573001234567|3001234567/u);
    expect(flow.repository.insert).toHaveBeenCalledTimes(1);
    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
    expect(flow.repository.insert).toHaveBeenCalledTimes(1);
  });

  it("records a cancelled form as cancelled and opens no review dialog", async () => {
    const flow = createFlow();
    const proposing = flow.orchestrator.propose({ action: "SAVE_CONTACT", input: { contactName: "Mamá" } });
    await vi.waitFor(() => expect(flow.requests.length).toBe(1));
    await flow.broker.cancel({ requestId: flow.lastRequest().requestId });

    const result = await proposing;

    expect(result).toMatchObject({
      ok: true,
      data: { status: "CANCELLED", errorCode: "MESSAGING_FORM_CANCELLED", userSummary: MESSAGING_FAILURES.MESSAGING_FORM_CANCELLED }
    });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(flow.repository.insert).not.toHaveBeenCalled();
    expect(flow.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({ action: "SAVE_CONTACT", status: "CANCELLED" }));
  });

  it("stores nothing and releases the pending contact when the review is cancelled", async () => {
    const flow = createFlow();
    const awaiting = confirmationOf(await proposeSave(flow, "Mamá", PHONE));

    await expect(flow.orchestrator.cancel(awaiting.confirmationId)).resolves.toMatchObject({ ok: true, data: { status: "CANCELLED" } });

    expect(flow.repository.insert).not.toHaveBeenCalled();
    expect(flow.contacts.size).toBe(0);
    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
  });

  it("answers an existing name before the form opens and an invalid name without a dialog", async () => {
    const flow = createFlow();
    flow.seed("Mamá", FULL_NUMBER);
    const duplicate = await flow.orchestrator.propose({ action: "SAVE_CONTACT", input: { contactName: "mama" } });
    expect(duplicate).toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_EXISTS", userSummary: MESSAGING_FAILURES.MESSAGING_CONTACT_EXISTS }
    });
    const invalid = await flow.orchestrator.propose({ action: "SAVE_CONTACT", input: { contactName: "3001234567" } });
    expect(invalid).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_INVALID_NAME" } });
    expect(flow.requests).toHaveLength(0);
  });

  it("re-validates at confirmation and reports the collision without writing", async () => {
    const flow = createFlow();
    const awaiting = confirmationOf(await proposeSave(flow, "Mamá", PHONE));
    flow.seed("Mamá", "573009999999");

    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_EXISTS" }
    });
    expect(flow.repository.insert).not.toHaveBeenCalled();
  });

  it("keeps the number out of history, logs, errors and the executor when persistence fails", async () => {
    const flow = createFlow();
    const awaiting = confirmationOf(await proposeSave(flow, "Mamá", PHONE));
    flow.failures.insert = true;

    const failed = await flow.orchestrator.confirm(awaiting.confirmationId);

    expect(failed).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", errorCode: "MESSAGING_STORAGE_UNAVAILABLE" } });
    expect(JSON.stringify(failed)).not.toMatch(/573001234567|3001234567|Mamá/u);
    expect(everythingRecorded(flow)).not.toMatch(/573001234567|3001234567|4567/u);
  });

  it("contains an executor that throws with a constant log message and no payload", async () => {
    const flow = createFlow();
    const throwing = {
      ...flow.service,
      prepareSaveContact: vi.fn(async () => { throw new Error(`failure for ${FULL_NUMBER} Mamá`); })
    };
    const guarded = createFlow(flow, throwing);

    const result = await guarded.orchestrator.propose({ action: "SAVE_CONTACT", input: { contactName: "Mamá" } });

    expect(result).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", errorCode: "MESSAGING_OPERATION_FAILED" } });
    expect(guarded.executorLog.mock.calls).toEqual([["Messaging proposal preparation failed."]]);
    expect(JSON.stringify([result, guarded.executorLog.mock.calls])).not.toMatch(/573001234567|Mamá/u);
  });
});

describe("list and delete contact flows", () => {
  it("lists names directly without any dialog and records only a count", async () => {
    const flow = createFlow();
    for (const name of ["Ana", "Beto", "Carla", "Diego", "Elena"]) flow.seed(name, FULL_NUMBER);

    const result = await flow.orchestrator.propose({ action: "LIST_CONTACTS", input: {} });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "SUCCEEDED",
        riskLevel: 1,
        userSummary: "Tienes 5 contactos: Ana, Beto, Carla, Diego, Elena.",
        data: { kind: "CONTACT_LIST", contactCount: 5, contactNames: ["Ana", "Beto", "Carla", "Diego", "Elena"] }
      }
    });
    expect(JSON.stringify(result)).not.toContain("57300");
    expect(flow.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      action: "LIST_CONTACTS",
      userSummary: "La acción de mensajería se completó.",
      metadata: { scopeKind: "MESSAGING", resultKind: "SUCCEEDED", itemCount: 5 }
    }));
    expect(everythingRecorded(flow)).not.toMatch(/Ana|Beto|Carla|Diego|Elena/u);
  });

  it("states a distinct message for zero contacts", async () => {
    const flow = createFlow();
    await expect(flow.orchestrator.propose({ action: "LIST_CONTACTS", input: {} })).resolves.toMatchObject({
      ok: true,
      data: { status: "SUCCEEDED", userSummary: MESSAGING_FAILURES.MESSAGING_NO_CONTACTS, errorCode: "MESSAGING_NO_CONTACTS" }
    });
  });

  it("holds a deletion for reinforced confirmation showing the name and a masked number", async () => {
    const flow = createFlow();
    const id = flow.seed("Mamá", FULL_NUMBER);
    flow.seed("Juan", "573009998888");

    const proposed = await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "mama" } });
    const awaiting = confirmationOf(proposed);

    expect(awaiting).toMatchObject({
      action: "DELETE_CONTACT",
      riskLevel: 3,
      confirmation: {
        required: true,
        summary: "Se eliminará el contacto «Mamá» (número •••• 4567). Esta acción no se puede deshacer.",
        scopeSummary: "Contacto guardado"
      }
    });
    expect(JSON.stringify(proposed)).not.toMatch(/573001234567|preparedId|contact-1/u);
    expect(flow.contacts.has(id)).toBe(true);

    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
      ok: true, data: { status: "SUCCEEDED", userSummary: "Listo, eliminé el contacto «Mamá».", data: { kind: "CONTACT_DELETED" } }
    });
    expect(flow.contacts.has(id)).toBe(false);
    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
  });

  it("cancelling the deletion removes nothing", async () => {
    const flow = createFlow();
    const id = flow.seed("Mamá", FULL_NUMBER);
    const awaiting = confirmationOf(await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "Mamá" } }));
    await flow.orchestrator.cancel(awaiting.confirmationId);
    expect(flow.contacts.has(id)).toBe(true);
    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({ ok: false });
  });

  it("clarifies an ambiguous or unknown contact without an action or a dialog", async () => {
    const flow = createFlow();
    flow.seed("Juan Pérez", FULL_NUMBER);
    flow.seed("Juan Gómez", "573009998888");

    const ambiguous = await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "Juan" } });
    const unknown = await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "Pedro" } });

    expect(ambiguous).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_AMBIGUOUS", userSummary: MESSAGING_FAILURES.MESSAGING_CONTACT_AMBIGUOUS } });
    expect(unknown).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_NOT_FOUND", userSummary: MESSAGING_FAILURES.MESSAGING_CONTACT_NOT_FOUND } });
    for (const result of [ambiguous, unknown]) expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(flow.contacts.size).toBe(2);
  });

  it("re-validates at confirmation that the contact still exists", async () => {
    const flow = createFlow();
    const id = flow.seed("Mamá", FULL_NUMBER);
    const awaiting = confirmationOf(await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "Mamá" } }));
    flow.contacts.delete(id);

    await expect(flow.orchestrator.confirm(awaiting.confirmationId)).resolves.toMatchObject({
      ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_NOT_FOUND" }
    });
  });

  it("keeps names, numbers and aliases out of history for every outcome", async () => {
    const flow = createFlow();
    flow.seed("Mamá", FULL_NUMBER, ["Madre"]);
    const awaiting = confirmationOf(await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "Madre" } }));
    await flow.orchestrator.confirm(awaiting.confirmationId);
    await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "Mamá" } });

    expect(everythingRecorded(flow)).not.toMatch(/Mamá|Madre|4567|573001234567/u);
    for (const [input] of flow.recordTerminal.mock.calls) {
      expect(input).toMatchObject({ metadata: { scopeKind: "MESSAGING" } });
      expect(sanitizeActionHistoryMetadata((input as { metadata: unknown }).metadata)).toBeDefined();
    }
  });
});

describe("message draft flows", () => {
  const createDraftFlow = () => {
    const flow = createFlow();
    flow.seed("Mamá", FULL_NUMBER);
    flow.seed("Juan", "573009998888");
    return flow;
  };

  it("prepares, edits and discards the draft directly, never asking for confirmation", async () => {
    const flow = createDraftFlow();

    const prepared = await flow.orchestrator.propose({
      action: "PREPARE_MESSAGE_DRAFT",
      input: { recipient: "Mamá", body: "llego en diez minutos", channel: "WHATSAPP" }
    });
    expect(prepared).toMatchObject({
      ok: true,
      data: {
        status: "SUCCEEDED",
        riskLevel: 1,
        userSummary: "Borrador para Mamá: «llego en diez minutos». Aún no lo envié.",
        data: { kind: "DRAFT_READY", recipientName: "Mamá", channel: "WHATSAPP", body: "llego en diez minutos" }
      }
    });
    expect(prepared.ok && "lifecycleState" in prepared.data).toBe(false);

    await expect(flow.orchestrator.propose({ action: "EDIT_MESSAGE_DRAFT", input: { body: "llego en cinco" } })).resolves.toMatchObject({
      ok: true,
      data: { status: "SUCCEEDED", userSummary: "Borrador actualizado para Mamá: «llego en cinco». Aún no lo envié." }
    });
    expect(flow.service.getActiveDraft()).toMatchObject({ body: "llego en cinco" });

    await expect(flow.orchestrator.propose({ action: "DISCARD_MESSAGE_DRAFT", input: {} })).resolves.toMatchObject({
      ok: true, data: { status: "SUCCEEDED", userSummary: "Listo, descarté el borrador del mensaje." }
    });
    expect(flow.service.hasActiveDraft()).toBe(false);
  });

  it("asks for a draft when editing or discarding with none, and never opens a dialog", async () => {
    const flow = createDraftFlow();
    for (const submission of [
      { action: "EDIT_MESSAGE_DRAFT", input: { body: "hola" } },
      { action: "DISCARD_MESSAGE_DRAFT", input: {} }
    ]) {
      const result = await flow.orchestrator.propose(submission);
      expect(result).toMatchObject({
        ok: true,
        data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_NO_DRAFT", userSummary: MESSAGING_FAILURES.MESSAGING_NO_DRAFT }
      });
      expect(result.ok && "lifecycleState" in result.data).toBe(false);
    }
  });

  it("clarifies an unknown or ambiguous recipient and keeps the previous draft untouched", async () => {
    const flow = createDraftFlow();
    flow.seed("Juana", "573007777777");
    await flow.orchestrator.propose({ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "uno", channel: "WHATSAPP" } });

    const unknown = await flow.orchestrator.propose({ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Luis", body: "dos", channel: "WHATSAPP" } });
    const ambiguous = await flow.orchestrator.propose({ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Jua", body: "tres", channel: "WHATSAPP" } });

    expect(unknown).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_NOT_FOUND" } });
    expect(ambiguous).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_CONTACT_AMBIGUOUS" } });
    expect(flow.service.getActiveDraft()).toMatchObject({ body: "uno" });
  });

  it("rejects a body that is empty or too long with its own failure", async () => {
    const flow = createDraftFlow();
    for (const body of ["​\u0000  ", "a".repeat(1001)]) {
      await expect(flow.orchestrator.propose({ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body, channel: "WHATSAPP" } })).resolves.toMatchObject({
        ok: true, data: { status: "VALIDATION_FAILED", errorCode: "MESSAGING_INVALID_BODY", userSummary: MESSAGING_FAILURES.MESSAGING_INVALID_BODY }
      });
    }
  });

  it("keeps recipient names, texts and numbers out of history and logs", async () => {
    const flow = createDraftFlow();
    await flow.orchestrator.propose({ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "mi clave es secreta 12345", channel: "WHATSAPP" } });
    await flow.orchestrator.propose({ action: "EDIT_MESSAGE_DRAFT", input: { body: "nuevo texto privado" } });

    expect(everythingRecorded(flow)).not.toMatch(/Mamá|secreta|privado|4567|57300/u);
    expect(flow.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      action: "PREPARE_MESSAGE_DRAFT",
      userSummary: "La acción de mensajería se completó.",
      metadata: { scopeKind: "MESSAGING", resultKind: "SUCCEEDED" }
    }));
  });
});

describe("spoken responses and speech-provider exposure", () => {
  const speak = async (flow: Flow, submission: unknown, windowId = 1) => {
    const remembered: string[] = [];
    const responses = {
      clear: vi.fn(),
      remember: vi.fn((_id: number, text: string) => {
        remembered.push(text);
        return { responseId: "response", expiresAt: "later" } as never;
      })
    };
    const result = await flow.orchestrator.propose(submission);
    const attached = attachSpokenActionResponse(windowId, result, responses);
    return { remembered, attached, result };
  };

  it("says the recipient and that nothing was sent, but not the text or the number", async () => {
    const flow = createFlow();
    flow.seed("Mamá", FULL_NUMBER);
    const { remembered, attached } = await speak(flow, {
      action: "PREPARE_MESSAGE_DRAFT",
      input: { recipient: "Mamá", body: "llego en diez minutos 3009998888", channel: "WHATSAPP" }
    });

    expect(remembered).toEqual(["Preparé un mensaje para Mamá. Aún no lo envié."]);
    expect(remembered.join(" ")).not.toMatch(/llego|diez|57300|3009998888/u);
    // The on-screen result still carries the exact text so the person can read it.
    expect(attached.ok && "userSummary" in attached.data && attached.data.userSummary).toBe(
      "Borrador para Mamá: «llego en diez minutos 3009998888». Aún no lo envié."
    );
  });

  it("speaks the edited draft the same minimal way", async () => {
    const flow = createFlow();
    flow.seed("Mamá", FULL_NUMBER);
    await flow.orchestrator.propose({ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "uno", channel: "WHATSAPP" } });
    const { remembered } = await speak(flow, { action: "EDIT_MESSAGE_DRAFT", input: { body: "dos secreto" } });
    expect(remembered).toEqual(["Cambié el mensaje para Mamá. Aún no lo envié."]);
  });

  it("speaks a contact list as a count plus at most three names, with the full list on screen", async () => {
    const flow = createFlow();
    for (const name of ["Ana", "Beto", "Carla", "Diego", "Elena"]) flow.seed(name, FULL_NUMBER);
    const { remembered, attached } = await speak(flow, { action: "LIST_CONTACTS", input: {} });

    expect(remembered).toEqual(["Tienes 5 contactos: Ana, Beto y Carla, entre otros."]);
    expect(remembered[0]).not.toMatch(/Diego|Elena|57300/u);
    expect(attached.ok && "userSummary" in attached.data && attached.data.userSummary).toContain("Diego, Elena");
  });

  it("speaks a distinct message for zero contacts and short confirmations for save and delete", async () => {
    const flow = createFlow();
    expect((await speak(flow, { action: "LIST_CONTACTS", input: {} })).remembered).toEqual(["Aún no tienes contactos guardados."]);

    const awaiting = confirmationOf(await proposeSave(flow, "Mamá", PHONE));
    const confirmed = await flow.orchestrator.confirm(awaiting.confirmationId);
    const responses = { clear: vi.fn(), remember: vi.fn((_id: number, _text: string) => ({}) as never) };
    attachSpokenActionResponse(1, confirmed, responses);
    expect(responses.remember).toHaveBeenCalledWith(1, "Listo, guardé el contacto Mamá.");

    const deletion = confirmationOf(await flow.orchestrator.propose({ action: "DELETE_CONTACT", input: { contactName: "Mamá" } }));
    const deleted = await flow.orchestrator.confirm(deletion.confirmationId);
    const deletedResponses = { clear: vi.fn(), remember: vi.fn((_id: number, _text: string) => ({}) as never) };
    attachSpokenActionResponse(1, deleted, deletedResponses);
    expect(deletedResponses.remember).toHaveBeenCalledWith(1, "Listo, eliminé el contacto Mamá.");
  });

  it("stays silent for a review and for a cancelled form, and speaks only fixed texts for failures", async () => {
    const flow = createFlow();
    const awaitingResult = await proposeSave(flow, "Mamá", PHONE);
    const silent = { clear: vi.fn(), remember: vi.fn() };
    attachSpokenActionResponse(1, awaitingResult, silent as never);
    expect(silent.remember).not.toHaveBeenCalled();

    const failure = await speak(flow, { action: "DELETE_CONTACT", input: { contactName: "Pedro" } });
    expect(failure.remembered).toEqual([MESSAGING_FAILURES.MESSAGING_CONTACT_NOT_FOUND]);
  });

  it("composes nothing for malformed outcome data and never reads a number", () => {
    const base = { actionId: "a", riskLevel: 1 as const, status: "SUCCEEDED" as const, userSummary: "x" };
    expect(composeFinalResponse({ ...base, action: "PREPARE_MESSAGE_DRAFT", data: { kind: "DRAFT_READY", recipientName: "Ma\u0000má", channel: "WHATSAPP", body: "x" } })).toBeUndefined();
    expect(composeFinalResponse({ ...base, action: "PREPARE_MESSAGE_DRAFT", data: { kind: "DRAFT_READY", recipientName: "x".repeat(41), channel: "WHATSAPP", body: "x" } })).toBeUndefined();
    expect(composeFinalResponse({ ...base, action: "SAVE_CONTACT" })).toBeUndefined();
    expect(composeFinalResponse({ ...base, action: "DISCARD_MESSAGE_DRAFT", data: { kind: "DRAFT_DISCARDED" } })).toBe("Listo, descarté el mensaje.");
  });
});
