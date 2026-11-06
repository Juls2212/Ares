import { describe, expect, it } from "vitest";
import { createExpiringStore } from "../src/main/messaging/expiring-store";
import {
  MAXIMUM_PENDING_CONTACTS,
  MESSAGE_DRAFT_LIFETIME_MS,
  PENDING_CONTACT_LIFETIME_MS
} from "../src/main/messaging/messaging-service";
import { createFakeMessagingFlow, type FakeMessagingFlow } from "./helpers/fake-messaging";

const submitForm = async (flow: FakeMessagingFlow, phone: string, displayName?: string) => {
  const request = flow.lastRequest();
  return flow.broker.submit({ requestId: request.requestId, displayName: displayName ?? request.displayName, phone });
};

const prepareContact = async (flow: FakeMessagingFlow, contactName: string, phone: string, aliases?: string[]) => {
  const preparing = flow.startSave({ contactName, ...(aliases ? { aliases } : {}) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const submitted = await submitForm(flow, phone);
  expect(submitted).toMatchObject({ ok: true });
  return preparing;
};

describe("expiring store of Main-held snapshots", () => {
  const createStore = (maximumEntries = 3) => {
    let clock = 0;
    let counter = 0;
    const store = createExpiringStore<string>({
      lifetimeMs: 1_000,
      maximumEntries,
      now: () => clock,
      generateIdentifier: () => `ref-${++counter}`
    });
    return { store, advance: (milliseconds: number) => { clock += milliseconds; } };
  };

  it("hands each entry out once", () => {
    const { store } = createStore();
    const reference = store.put("a");
    expect(store.take(reference)).toBe("a");
    expect(store.take(reference)).toBeUndefined();
  });

  it("expires entries at their lifetime", () => {
    const { store, advance } = createStore();
    const reference = store.put("a");
    advance(999);
    expect(store.size()).toBe(1);
    advance(1);
    expect(store.take(reference)).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("evicts the oldest entry when the bound is reached", () => {
    const { store } = createStore(2);
    const first = store.put("a");
    const second = store.put("b");
    const third = store.put("c");
    expect(store.size()).toBe(2);
    expect(store.take(first)).toBeUndefined();
    expect(store.take(second)).toBe("b");
    expect(store.take(third)).toBe("c");
  });

  it("ignores references that are not strings and clears on demand", () => {
    const { store } = createStore();
    store.put("a");
    expect(store.take(undefined)).toBeUndefined();
    expect(store.take({})).toBeUndefined();
    store.clear();
    expect(store.size()).toBe(0);
  });

  it("uses the five-minute, eight-entry limits for pending contacts and a ten-minute draft", () => {
    expect(PENDING_CONTACT_LIFETIME_MS).toBe(5 * 60 * 1000);
    expect(MAXIMUM_PENDING_CONTACTS).toBe(8);
    expect(MESSAGE_DRAFT_LIFETIME_MS).toBe(10 * 60 * 1000);
  });
});

describe("saving a contact", () => {
  it("opens the form with the spoken name, then holds a pending contact with a masked label only", async () => {
    const flow = createFakeMessagingFlow();
    const prepared = await prepareContact(flow, "Mamá", "300 123 4567");

    expect(flow.requests).toEqual([{ requestId: expect.any(String), displayName: "Mamá" }]);
    expect(prepared).toMatchObject({ ok: true, data: { displayName: "Mamá", maskedNumber: "•••• 4567" } });
    expect(JSON.stringify(prepared)).not.toMatch(/573001234567|300123/u);
    expect(flow.contacts.size).toBe(0);
  });

  it("writes nothing until the confirmation commits, then stores the normalized digits once", async () => {
    const flow = createFakeMessagingFlow();
    const prepared = await prepareContact(flow, "Mamá", "3001234567", ["Madre"]);
    if (!prepared.ok) throw new Error("Expected a pending contact.");

    const committed = await flow.service.commitSaveContact(prepared.data.pendingId);

    expect(committed).toEqual({ ok: true, data: { displayName: "Mamá" } });
    expect(flow.repository.insert).toHaveBeenCalledWith({
      displayName: "Mamá",
      lookupKey: "mama",
      phoneDigits: "573001234567",
      aliases: [{ alias: "Madre", lookupKey: "madre" }]
    });
    await expect(flow.service.commitSaveContact(prepared.data.pendingId)).resolves.toMatchObject({
      ok: false,
      error: { code: "MESSAGING_PENDING_EXPIRED" }
    });
    expect(flow.contacts.size).toBe(1);
  });

  it("lets the person correct the name in the form and re-checks it", async () => {
    const flow = createFakeMessagingFlow();
    const preparing = flow.startSave({ contactName: "Mama" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await submitForm(flow, "3001234567", "Mamá");
    await expect(preparing).resolves.toMatchObject({ ok: true, data: { displayName: "Mamá" } });
  });

  it("records a cancelled form and stores nothing", async () => {
    const flow = createFakeMessagingFlow();
    const preparing = flow.startSave({ contactName: "Mamá" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flow.broker.cancel({ requestId: flow.lastRequest().requestId });

    await expect(preparing).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_FORM_CANCELLED" } });
    expect(flow.repository.insert).not.toHaveBeenCalled();
  });

  it("reports an expired or unavailable form with its own failure", async () => {
    const expired = createFakeMessagingFlow();
    const preparing = expired.startSave({ contactName: "Mamá" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expired.expireForm();
    await expect(preparing).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_PENDING_EXPIRED" } });

    const unavailable = createFakeMessagingFlow({ deliverForm: false });
    await expect(unavailable.startSave({ contactName: "Mamá" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MESSAGING_OPERATION_FAILED" }
    });
  });

  it("keeps the form open on an invalid number and never echoes it", async () => {
    const flow = createFakeMessagingFlow();
    const preparing = flow.startSave({ contactName: "Mamá" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rejected = await submitForm(flow, "12345");
    expect(rejected).toMatchObject({ ok: false, error: { code: "MESSAGING_INVALID_PHONE" } });
    expect(JSON.stringify(rejected)).not.toContain("12345");

    await submitForm(flow, "+57 300 123 4567");
    await expect(preparing).resolves.toMatchObject({ ok: true });
  });

  it("rejects a duplicate name or alias with distinct failures, before and after the form", async () => {
    const flow = createFakeMessagingFlow();
    flow.seed("Mamá", "573001234567", ["Madre"]);

    await expect(flow.service.prepareSaveContact({ contactName: "MAMA" })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_EXISTS" }
    });
    await expect(flow.service.prepareSaveContact({ contactName: "Papá", aliases: ["madre"] })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_ALIAS_EXISTS" }
    });
    expect(flow.requests).toHaveLength(0);

    // A name typed into the form that collides is refused and the form stays open.
    const second = createFakeMessagingFlow();
    second.seed("Mamá", "573001234567");
    const preparing = second.startSave({ contactName: "Papá" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(submitForm(second, "3001234567", "mama")).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_EXISTS" }
    });
    second.broker.shutdown();
    await preparing;
  });

  it("rejects invalid names and aliases before opening the form", async () => {
    const flow = createFakeMessagingFlow();
    for (const contactName of ["", "x".repeat(41), "3001234567", "WhatsApp"]) {
      await expect(flow.service.prepareSaveContact({ contactName })).resolves.toMatchObject({
        ok: false, error: { code: "MESSAGING_INVALID_NAME" }
      });
    }
    await expect(flow.service.prepareSaveContact({ contactName: "Mamá", aliases: ["a", "b", "c", "d"] })).resolves.toMatchObject({ ok: false });
    expect(flow.requests).toHaveLength(0);
  });

  it("re-validates at confirmation when the name was taken in the meantime", async () => {
    const flow = createFakeMessagingFlow();
    const prepared = await prepareContact(flow, "Mamá", "3001234567");
    if (!prepared.ok) throw new Error("Expected a pending contact.");
    flow.seed("mamá", "573009999999");

    await expect(flow.service.commitSaveContact(prepared.data.pendingId)).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_EXISTS" }
    });
    expect(flow.repository.insert).not.toHaveBeenCalled();
  });

  it("maps a repository conflict or failure to fixed failures and logs a constant message", async () => {
    const flow = createFakeMessagingFlow();
    const prepared = await prepareContact(flow, "Mamá", "3001234567");
    if (!prepared.ok) throw new Error("Expected a pending contact.");
    flow.failures.insert = true;

    const result = await flow.service.commitSaveContact(prepared.data.pendingId);

    expect(result).toMatchObject({ ok: false, error: { code: "MESSAGING_STORAGE_UNAVAILABLE" } });
    expect(flow.logError.mock.calls).toEqual([["Messaging storage unavailable [stage=save, category=OTHER]."]]);
    expect(JSON.stringify([result, flow.logError.mock.calls])).not.toMatch(/573001234567|3001234567|messaging_contacts/u);
  });

  it("expires a pending contact after five minutes and bounds the pending set at eight", async () => {
    const flow = createFakeMessagingFlow();
    const prepared = await prepareContact(flow, "Mamá", "3001234567");
    if (!prepared.ok) throw new Error("Expected a pending contact.");
    flow.advance(PENDING_CONTACT_LIFETIME_MS);
    await expect(flow.service.commitSaveContact(prepared.data.pendingId)).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_PENDING_EXPIRED" }
    });

    const references: string[] = [];
    for (let index = 0; index < MAXIMUM_PENDING_CONTACTS + 1; index += 1) {
      const next = await prepareContact(flow, `Contacto ${String.fromCharCode(65 + index)}`, "3001234567");
      if (next.ok) references.push(next.data.pendingId);
    }
    await expect(flow.service.commitSaveContact(references[0])).resolves.toMatchObject({ ok: false });
    await expect(flow.service.commitSaveContact(references[MAXIMUM_PENDING_CONTACTS])).resolves.toMatchObject({ ok: true });
  });

  it("forgets a pending contact when it is released", async () => {
    const flow = createFakeMessagingFlow();
    const prepared = await prepareContact(flow, "Mamá", "3001234567");
    if (!prepared.ok) throw new Error("Expected a pending contact.");
    flow.service.releasePrepared(prepared.data.pendingId);
    await expect(flow.service.commitSaveContact(prepared.data.pendingId)).resolves.toMatchObject({ ok: false });
  });
});

describe("listing and deleting contacts", () => {
  it("lists names only, at most twenty, with the total count", async () => {
    const flow = createFakeMessagingFlow();
    for (let index = 0; index < 23; index += 1) flow.seed(`Persona ${String(index).padStart(2, "0")}`, "573001234567");

    const listed = await flow.service.listContacts();

    expect(listed).toMatchObject({ ok: true, data: { contactCount: 23 } });
    expect(listed.ok && listed.data.contactNames).toHaveLength(20);
    expect(JSON.stringify(listed)).not.toMatch(/57300|3001234567/u);
  });

  it("reports an empty list as zero contacts", async () => {
    await expect(createFakeMessagingFlow().service.listContacts()).resolves.toEqual({
      ok: true, data: { contactCount: 0, contactNames: [] }
    });
  });

  it("resolves a spoken name, shows only the last four digits, and deletes after the prepared reference", async () => {
    const flow = createFakeMessagingFlow();
    const id = flow.seed("Mamá", "573001234567");
    flow.seed("Juan", "573009998888");

    const prepared = await flow.service.prepareDeleteContact({ contactName: "mama" });
    expect(prepared).toMatchObject({ ok: true, data: { displayName: "Mamá", maskedNumber: "•••• 4567" } });
    expect(JSON.stringify(prepared)).not.toContain("573001234567");
    expect(flow.contacts.has(id)).toBe(true);
    if (!prepared.ok) throw new Error("Expected a prepared deletion.");

    await expect(flow.service.commitDeleteContact(prepared.data.preparedId)).resolves.toEqual({ ok: true, data: { displayName: "Mamá" } });
    expect(flow.contacts.has(id)).toBe(false);
    await expect(flow.service.commitDeleteContact(prepared.data.preparedId)).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_PENDING_EXPIRED" }
    });
  });

  it("asks for clarification when the contact is missing or the match is ambiguous", async () => {
    const flow = createFakeMessagingFlow();
    flow.seed("Juan Pérez", "573001111111");
    flow.seed("Juan Gómez", "573002222222");

    await expect(flow.service.prepareDeleteContact({ contactName: "Juan" })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_AMBIGUOUS" }
    });
    await expect(flow.service.prepareDeleteContact({ contactName: "Pedro" })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_NOT_FOUND" }
    });
    await expect(flow.service.prepareDeleteContact({ contactName: "Juan Gómez" })).resolves.toMatchObject({ ok: true });
  });

  it("re-validates at confirmation that the contact still exists", async () => {
    const flow = createFakeMessagingFlow();
    const id = flow.seed("Mamá", "573001234567");
    const prepared = await flow.service.prepareDeleteContact({ contactName: "Mamá" });
    if (!prepared.ok) throw new Error("Expected a prepared deletion.");
    flow.contacts.delete(id);

    await expect(flow.service.commitDeleteContact(prepared.data.preparedId)).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_NOT_FOUND" }
    });
  });

  it("drops the draft when its contact is deleted", async () => {
    const flow = createFakeMessagingFlow();
    flow.seed("Mamá", "573001234567");
    await flow.service.prepareDraft({ recipient: "Mamá", body: "hola", channel: "WHATSAPP" });
    const prepared = await flow.service.prepareDeleteContact({ contactName: "Mamá" });
    if (!prepared.ok) throw new Error("Expected a prepared deletion.");
    await flow.service.commitDeleteContact(prepared.data.preparedId);
    expect(flow.service.hasActiveDraft()).toBe(false);
  });
});

describe("contact reference resolution", () => {
  const createContacts = () => {
    const flow = createFakeMessagingFlow();
    flow.seed("Mamá", "573001111111", ["Madre"]);
    flow.seed("Juan Pérez", "573002222222");
    flow.seed("Juan Gómez", "573003333333");
    flow.seed("Ana María", "573004444444");
    return flow;
  };

  it.each([
    ["Mamá", "Mamá"],
    ["MAMA", "Mamá"],
    ["madre", "Mamá"],
    ["Juan Pérez", "Juan Pérez"],
    ["perez", "Juan Pérez"],
    ["gomez", "Juan Gómez"],
    ["ana", "Ana María"]
  ])("resolves %s to %s", async (reference, displayName) => {
    await expect(createContacts().service.resolveContactReference(reference)).resolves.toMatchObject({ state: "RESOLVED", displayName });
  });

  it("reports several matches as ambiguous and no match as none", async () => {
    const flow = createContacts();
    await expect(flow.service.resolveContactReference("Juan")).resolves.toEqual({ state: "AMBIGUOUS" });
    await expect(flow.service.resolveContactReference("Pedro")).resolves.toEqual({ state: "NONE" });
    await expect(flow.service.resolveContactReference("")).resolves.toEqual({ state: "NONE" });
    await expect(flow.service.resolveContactReference("a")).resolves.toEqual({ state: "NONE" });
    await expect(flow.service.resolveContactReference(12)).resolves.toEqual({ state: "NONE" });
  });

  it("reports an unavailable store without leaking the error", async () => {
    const flow = createContacts();
    flow.failures.listIdentities = true;
    await expect(flow.service.resolveContactReference("Mamá")).resolves.toEqual({ state: "UNAVAILABLE" });
    expect(JSON.stringify(flow.logError.mock.calls)).not.toMatch(/SELECT|boom/u);
  });
});

describe("message draft lifecycle", () => {
  const createDraftFlow = () => {
    const flow = createFakeMessagingFlow();
    flow.seed("Mamá", "573001234567");
    flow.seed("Juan", "573009998888");
    return flow;
  };

  it("prepares one draft for a resolved contact and exposes recipient name and exact text", async () => {
    const flow = createDraftFlow();
    const prepared = await flow.service.prepareDraft({ recipient: "mama", body: "llego en diez minutos", channel: "WHATSAPP" });

    expect(prepared).toEqual({ ok: true, data: { recipientName: "Mamá", channel: "WHATSAPP", body: "llego en diez minutos" } });
    expect(JSON.stringify(prepared)).not.toContain("57300");
    expect(flow.service.getActiveDraft()).toMatchObject({ channel: "WHATSAPP", body: "llego en diez minutos", createdAt: expect.any(Date) });
  });

  it("keeps the contact reference, never a number, so a later phase needs no storage change", async () => {
    const flow = createDraftFlow();
    await flow.service.prepareDraft({ recipient: "Juan", body: "hola", channel: "WHATSAPP" });
    const draft = flow.service.getActiveDraft();
    expect(Object.keys(draft ?? {}).sort()).toEqual(["body", "channel", "contactId", "createdAt"]);
    expect(JSON.stringify(draft)).not.toContain("573009998888");
    expect(draft?.contactId).toMatch(/^contact-/u);
  });

  it("replaces the previous draft with each new one", async () => {
    const flow = createDraftFlow();
    await flow.service.prepareDraft({ recipient: "Mamá", body: "uno", channel: "WHATSAPP" });
    await flow.service.prepareDraft({ recipient: "Juan", body: "dos", channel: "WHATSAPP" });
    expect(flow.service.getActiveDraft()).toMatchObject({ body: "dos" });
  });

  it("edits only the body of the active draft and asks for a draft when there is none", async () => {
    const flow = createDraftFlow();
    await expect(flow.service.editDraft({ body: "nuevo" })).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_NO_DRAFT" } });

    await flow.service.prepareDraft({ recipient: "Mamá", body: "uno", channel: "WHATSAPP" });
    const original = flow.service.getActiveDraft();
    const edited = await flow.service.editDraft({ body: "  llego tarde  " });

    expect(edited).toEqual({ ok: true, data: { recipientName: "Mamá", channel: "WHATSAPP", body: "llego tarde" } });
    expect(flow.service.getActiveDraft()).toMatchObject({ contactId: original?.contactId, body: "llego tarde" });
    expect(flow.service.getActiveDraft()?.createdAt).toEqual(original?.createdAt);
  });

  it("discards the draft and reports when there is nothing to discard", async () => {
    const flow = createDraftFlow();
    expect(flow.service.discardDraft()).toMatchObject({ ok: false, error: { code: "MESSAGING_NO_DRAFT" } });
    await flow.service.prepareDraft({ recipient: "Mamá", body: "uno", channel: "WHATSAPP" });
    expect(flow.service.discardDraft()).toEqual({ ok: true, data: { discarded: true } });
    expect(flow.service.hasActiveDraft()).toBe(false);
  });

  it("expires the draft after ten minutes", async () => {
    const flow = createDraftFlow();
    await flow.service.prepareDraft({ recipient: "Mamá", body: "uno", channel: "WHATSAPP" });
    flow.advance(MESSAGE_DRAFT_LIFETIME_MS - 1);
    expect(flow.service.hasActiveDraft()).toBe(true);
    flow.advance(1);
    expect(flow.service.hasActiveDraft()).toBe(false);
    await expect(flow.service.editDraft({ body: "tarde" })).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_NO_DRAFT" } });
  });

  it("clears the draft, pending contacts and the form when the application quits", async () => {
    const flow = createDraftFlow();
    await flow.service.prepareDraft({ recipient: "Mamá", body: "uno", channel: "WHATSAPP" });
    const prepared = await prepareContact(flow, "Pedro", "3001234567");
    if (!prepared.ok) throw new Error("Expected a pending contact.");
    const waiting = flow.startSave({ contactName: "Luisa" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    flow.service.shutdown();

    expect(flow.service.hasActiveDraft()).toBe(false);
    await expect(flow.service.commitSaveContact(prepared.data.pendingId)).resolves.toMatchObject({ ok: false });
    await expect(waiting).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_FORM_CANCELLED" } });
  });

  it("rejects an unknown or ambiguous recipient, other channels and bodies out of bounds", async () => {
    const flow = createDraftFlow();
    flow.seed("Juana", "573007777777");

    await expect(flow.service.prepareDraft({ recipient: "Luis", body: "hola", channel: "WHATSAPP" })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_NOT_FOUND" }
    });
    await expect(flow.service.prepareDraft({ recipient: "Jua", body: "hola", channel: "WHATSAPP" })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_CONTACT_AMBIGUOUS" }
    });
    await expect(flow.service.prepareDraft({ recipient: "Mamá", body: "hola", channel: "DISCORD" })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_UNSUPPORTED_CHANNEL" }
    });
    for (const body of ["", "   ", "a".repeat(1001), undefined]) {
      await expect(flow.service.prepareDraft({ recipient: "Mamá", body, channel: "WHATSAPP" })).resolves.toMatchObject({
        ok: false, error: { code: "MESSAGING_INVALID_BODY" }
      });
    }
    expect(flow.service.hasActiveDraft()).toBe(false);
    await expect(flow.service.prepareDraft({ recipient: "Mamá", body: "a".repeat(1000), channel: "WHATSAPP" })).resolves.toMatchObject({ ok: true });
  });

  it("drops the draft when its contact disappears before an edit", async () => {
    const flow = createDraftFlow();
    const id = flow.seed("Luisa", "573007777777");
    await flow.service.prepareDraft({ recipient: "Luisa", body: "hola", channel: "WHATSAPP" });
    flow.contacts.delete(id);
    await expect(flow.service.editDraft({ body: "adiós" })).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_NO_DRAFT" } });
    expect(flow.service.hasActiveDraft()).toBe(false);
  });
});
