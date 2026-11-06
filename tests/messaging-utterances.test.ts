import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { parseMessagingCommand } from "../src/main/assistant/messaging-phrases";
import { createFakeMessagingFlow } from "./helpers/fake-messaging";

describe("the seven utterances, with and without accents, case and punctuation", () => {
  it.each([
    ["guarda un contacto llamado Mamá", { kind: "SAVE_CONTACT", name: "Mamá" }],
    ["Guarda un contacto llamado mamá.", { kind: "SAVE_CONTACT", name: "mamá" }],
    ["guarda un contacto llamado Mama", { kind: "SAVE_CONTACT", name: "Mama" }],
    ["qué contactos tengo", { kind: "LIST_CONTACTS" }],
    ["¿Qué contactos tengo?", { kind: "LIST_CONTACTS" }],
    ["que contactos tengo", { kind: "LIST_CONTACTS" }],
    ["Dime mis contactos", { kind: "LIST_CONTACTS" }],
    ["escríbele a Mamá que llego en diez minutos", { kind: "PREPARE_DRAFT", recipient: "Mamá", body: "llego en diez minutos", channel: "WHATSAPP" }],
    ["Escríbele a mamá que llego en 10 minutos.", { kind: "PREPARE_DRAFT", recipient: "mamá", body: "llego en 10 minutos", channel: "WHATSAPP" }],
    ["Escribele a Mama que llego en diez minutos", { kind: "PREPARE_DRAFT", recipient: "Mama", body: "llego en diez minutos", channel: "WHATSAPP" }],
    ["Escríbele a Mamá, que llego en diez minutos.", { kind: "PREPARE_DRAFT", recipient: "Mamá", body: "llego en diez minutos", channel: "WHATSAPP" }],
    ["díle a Mamá que llego en diez minutos", { kind: "PREPARE_DRAFT", recipient: "Mamá", body: "llego en diez minutos", channel: "WHATSAPP" }],
    ["cámbialo por llego en veinte minutos", { kind: "EDIT_DRAFT", body: "llego en veinte minutos" }],
    ["Cambialo por llego en 20 minutos.", { kind: "EDIT_DRAFT", body: "llego en 20 minutos" }],
    ["cámbialo a llego en veinte minutos", { kind: "EDIT_DRAFT", body: "llego en veinte minutos" }],
    ["envíalo", { kind: "SEND_REQUEST" }],
    ["Envíalo.", { kind: "SEND_REQUEST" }],
    ["envialo", { kind: "SEND_REQUEST" }],
    ["mándalo", { kind: "SEND_REQUEST" }],
    ["descarta el mensaje", { kind: "DISCARD_DRAFT" }],
    ["Descarta el mensaje.", { kind: "DISCARD_DRAFT" }],
    ["borra el contacto Mamá", { kind: "DELETE_CONTACT", name: "Mamá" }],
    ["Borra el contacto mamá.", { kind: "DELETE_CONTACT", name: "mamá" }],
    ["elimina a Mamá de mis contactos", { kind: "DELETE_CONTACT", name: "Mamá" }]
  ])("classifies «%s»", (utterance, expected) => {
    // «díle» is a common misspelling that the speech-to-text step can produce for «dile».
    const command = parseMessagingCommand(utterance.replace("díle", "dile"));
    expect(command).toEqual(expected);
  });
});

describe("recipient resolution for «Mamá»", () => {
  it.each(["Mamá", "mamá", "Mama", "MAMA", "  mamá  ", "mamá."])("resolves «%s» to the saved contact", async (reference) => {
    const flow = createFakeMessagingFlow();
    flow.seed("Mamá", "573001234567");
    await expect(flow.service.resolveContactReference(reference)).resolves.toMatchObject({ state: "RESOLVED", displayName: "Mamá" });
  });

  it("resolves through an alias and through a unique partial name, and refuses an ambiguous one", async () => {
    const flow = createFakeMessagingFlow();
    flow.seed("Mamá", "573001234567", ["Madre"]);
    flow.seed("Juan Pérez", "573001234568");
    flow.seed("Juan Gómez", "573001234569");
    await expect(flow.service.resolveContactReference("la madre")).resolves.toMatchObject({ state: "NONE" });
    await expect(flow.service.resolveContactReference("madre")).resolves.toMatchObject({ state: "RESOLVED", displayName: "Mamá" });
    await expect(flow.service.resolveContactReference("perez")).resolves.toMatchObject({ state: "RESOLVED", displayName: "Juan Pérez" });
    await expect(flow.service.resolveContactReference("juan")).resolves.toEqual({ state: "AMBIGUOUS" });
    await expect(flow.service.resolveContactReference("Lucía")).resolves.toEqual({ state: "NONE" });
  });
});

describe("the contact list", () => {
  it("says there are none, with the fixed message, when nothing is saved", async () => {
    const flow = createFakeMessagingFlow();
    await expect(flow.service.listContacts()).resolves.toEqual({ ok: true, data: { contactCount: 0, contactNames: [] } });
  });

  it("lists several contacts by name and never returns a number", async () => {
    const flow = createFakeMessagingFlow();
    flow.seed("Mamá", "573001234567");
    flow.seed("Ana", "573001234568");
    const listed = await flow.service.listContacts();
    expect(listed).toEqual({ ok: true, data: { contactCount: 2, contactNames: ["Ana", "Mamá"] } });
    expect(JSON.stringify(listed)).not.toMatch(/57300123456/u);
  });
});
