import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: {}, dialog: {} }));

import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { parseMessagingCommand } from "../src/main/assistant/messaging-phrases";
import {
  createOpenAiStructuredProvider,
  OPENAI_INTERPRETATION_OUTPUT_SCHEMA
} from "../src/main/assistant/openai-structured-provider";
import { MESSAGING_FAILURES } from "../src/main/messaging/messaging-failures";
import type { ContactResolution } from "../src/main/messaging/messaging-service";

const now = "2026-09-20T15:00:00.000Z";
const OPEN_NAMED =
  "Solo puedo abrir el chat del mensaje que preparaste. Di «envíalo» para abrirlo en WhatsApp y pulsar enviar tú.";

const conversational = JSON.stringify({
  state: "CONVERSATIONAL",
  summary: "Conversación",
  responseText: "Hola, ¿en qué te ayudo?",
  drafts: [],
  clarifications: []
});

const contacts = ["Mamá", "Juan Pérez", "Juan Gómez", "Ana"];

const resolveFromList = async (reference: string): Promise<ContactResolution> => {
  const key = reference.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const names = contacts.map((name) => ({ name, key: name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() }));
  const exact = names.filter((entry) => entry.key === key);
  if (exact.length === 1) return { state: "RESOLVED", contactId: exact[0].name, displayName: exact[0].name };
  const partial = names.filter((entry) => entry.key.includes(key));
  if (partial.length === 1) return { state: "RESOLVED", contactId: partial[0].name, displayName: partial[0].name };
  return { state: partial.length > 1 ? "AMBIGUOUS" : "NONE" };
};

const createInterpreter = (options: { output?: string; hasDraft?: boolean } = {}) => {
  const interpret = vi.fn(async () => options.output ?? conversational);
  return {
    interpret,
    interpreter: createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret }),
      now: () => new Date(now),
      timeZone: () => "America/Bogota",
      resolveMessagingContact: resolveFromList,
      hasActiveMessageDraft: () => options.hasDraft ?? false
    })
  };
};

const interpretText = async (instruction: string, options: { hasDraft?: boolean; output?: string } = {}) => {
  const { interpret, interpreter } = createInterpreter(options);
  const result = await interpreter.interpret({ instruction });
  return { result, interpret };
};

const draftsOf = (result: Awaited<ReturnType<typeof interpretText>>["result"]) => (result.ok ? result.data.drafts : []);

describe("contact and draft utterances", () => {
  it.each([
    ["guarda un contacto llamado Mamá", "Mamá"],
    ["Guarda el contacto Pedro Pablo.", "Pedro Pablo"],
    ["agrega a Juan como contacto", "Juan"],
    ["Guarda a María José como contacto.", "María José"],
    ["crea un contacto llamado Ana María", "Ana María"],
    ["nuevo contacto: Luisa", "Luisa"]
  ])("maps «%s» to SAVE_CONTACT with the name only", async (utterance, contactName) => {
    const { result, interpret } = await interpretText(utterance);
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "SAVE_CONTACT", input: { contactName } }] } });
    expect(Object.keys((draftsOf(result)[0] as { input: object }).input)).toEqual(["contactName"]);
    expect(interpret).not.toHaveBeenCalled();
  });

  it.each(["qué contactos tengo", "¿Qué contactos tengo?", "cuáles son mis contactos", "mis contactos", "muéstrame mis contactos", "lista mis contactos"])(
    "maps «%s» to LIST_CONTACTS",
    async (utterance) => {
      const { result, interpret } = await interpretText(utterance);
      expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "LIST_CONTACTS", input: {} }] } });
      expect(interpret).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["borra el contacto Mamá", "Mamá"],
    ["elimina el contacto mama", "Mamá"],
    ["elimina a Ana de mis contactos", "Ana"]
  ])("maps «%s» to DELETE_CONTACT using the saved name", async (utterance, contactName) => {
    const { result, interpret } = await interpretText(utterance);
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "DELETE_CONTACT", input: { contactName } }] } });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("clarifies an ambiguous or unknown contact to delete with no draft", async () => {
    const ambiguous = await interpretText("borra el contacto Juan");
    const unknown = await interpretText("borra el contacto Pedro");
    expect(ambiguous.result).toMatchObject({
      ok: true,
      data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: MESSAGING_FAILURES.MESSAGING_CONTACT_AMBIGUOUS }
    });
    expect(unknown.result).toMatchObject({
      ok: true,
      data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: MESSAGING_FAILURES.MESSAGING_CONTACT_NOT_FOUND }
    });
  });

  it.each([
    ["escríbele a Mamá que llego en diez minutos", "Mamá", "llego en diez minutos"],
    ["mándale un mensaje a Juan Pérez diciendo que ya salí", "Juan Pérez", "ya salí"],
    ["envíale a Ana un mensaje diciendo que ya salí", "Ana", "ya salí"],
    ["escríbele a Mamá por WhatsApp que llego tarde", "Mamá", "llego tarde"],
    ["mándale un mensaje de WhatsApp a Mamá diciendo hola", "Mamá", "hola"],
    ["dile a Mamá que la quiero mucho.", "Mamá", "la quiero mucho"],
    ["Escribele a mama: nos vemos mañana", "Mamá", "nos vemos mañana"],
    ["escríbele a Ana que dónde estás?", "Ana", "dónde estás?"]
  ])("maps «%s» to a draft for the saved contact", async (utterance, recipient, body) => {
    const { result, interpret } = await interpretText(utterance);
    expect(result).toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "PREPARE_MESSAGE_DRAFT", input: { recipient, body, channel: "WHATSAPP" } }] }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("clarifies an unknown or ambiguous recipient and an incomplete request without any draft", async () => {
    const cases: Array<[string, string]> = [
      ["escríbele a Pedro que llego tarde", MESSAGING_FAILURES.MESSAGING_CONTACT_NOT_FOUND],
      ["escríbele a Juan que llego tarde", MESSAGING_FAILURES.MESSAGING_CONTACT_AMBIGUOUS],
      ["escríbele a Mamá", "¿Qué quieres decirle? Solo prepararé un borrador; no lo enviaré."],
      ["mándale un mensaje", "¿A quién quieres escribirle?"]
    ];
    for (const [utterance, question] of cases) {
      const { result, interpret } = await interpretText(utterance);
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: question } });
      expect(interpret).not.toHaveBeenCalled();
    }
  });

  it("edits the active draft and asks for a draft when there is none", async () => {
    const withDraft = await interpretText("cámbialo por llego en cinco minutos", { hasDraft: true });
    expect(withDraft.result).toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "EDIT_MESSAGE_DRAFT", input: { body: "llego en cinco minutos" } }] }
    });
    const quoted = await interpretText("cambia el mensaje a: «nos vemos mañana»", { hasDraft: true });
    expect(quoted.result).toMatchObject({ ok: true, data: { drafts: [{ action: "EDIT_MESSAGE_DRAFT", input: { body: "nos vemos mañana" } }] } });

    const without = await interpretText("cámbialo por llego en cinco minutos", { hasDraft: false });
    expect(without.result).toMatchObject({
      ok: true,
      data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: MESSAGING_FAILURES.MESSAGING_NO_DRAFT }
    });
    const incomplete = await interpretText("cámbialo por", { hasDraft: true });
    expect(incomplete.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
  });

  it("discards the active draft and asks for a draft when there is none", async () => {
    for (const utterance of ["descarta el mensaje", "Descarta el borrador.", "cancela el mensaje"]) {
      const { result } = await interpretText(utterance, { hasDraft: true });
      expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "DISCARD_MESSAGE_DRAFT", input: {} }] } });
    }
    const { result } = await interpretText("descarta el mensaje", { hasDraft: false });
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: MESSAGING_FAILURES.MESSAGING_NO_DRAFT } });
  });
});

describe("requests to send, to open a chat or to use another channel", () => {
  it.each([
    "envíalo", "mándalo", "envíalo ya", "sí, envíalo", "mándale el mensaje", "envía el mensaje",
    "abre el chat con el mensaje", "abre el chat", "abre WhatsApp con el mensaje"
  ])("maps «%s» to the confirmed chat action with no input", async (utterance) => {
    const { result, interpret } = await interpretText(utterance, { hasDraft: true });
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "OPEN_WHATSAPP_CHAT_WITH_DRAFT", input: {} }] } });
    expect(interpret).not.toHaveBeenCalled();
  });

  it.each(["abre el chat con Mamá", "abre WhatsApp con Mamá"])(
    "does not open a named chat for «%s» and points to the prepared message",
    async (utterance) => {
      const { result, interpret } = await interpretText(utterance, { hasDraft: true });
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: OPEN_NAMED } });
      expect(interpret).not.toHaveBeenCalled();
    }
  );

  it("keeps the application alias priority for «abre WhatsApp»", async () => {
    const { interpret } = await interpretText("abre WhatsApp", { hasDraft: true });
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it.each(["envíalo por Discord", "mándalo por correo", "envía el mensaje por SMS"])(
    "keeps the WhatsApp-only clarification for «%s»",
    async (utterance) => {
      const { result } = await interpretText(utterance, { hasDraft: true });
      expect(result).toMatchObject({ ok: true, data: { drafts: [], summary: MESSAGING_FAILURES.MESSAGING_UNSUPPORTED_CHANNEL } });
    }
  );

  it("asks to prepare a draft first when a send is requested without one", async () => {
    const { result } = await interpretText("envía el mensaje", { hasDraft: false });
    expect(result).toMatchObject({ ok: true, data: { drafts: [], summary: MESSAGING_FAILURES.MESSAGING_NO_DRAFT } });
  });

  it.each([
    "escríbele a Mamá por Discord que llego tarde",
    "mándale un correo a Juan diciendo que ya salí",
    "envíale un SMS a Mamá diciendo hola",
    "mándale un mensaje de Discord a Ana diciendo hola",
    "mándale un mensaje a Ana por correo diciendo hola",
    "envía un correo a Ana"
  ])("answers «%s» that only WhatsApp drafts are available, without action", async (utterance) => {
    const { result, interpret } = await interpretText(utterance);
    expect(result).toMatchObject({
      ok: true,
      data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: MESSAGING_FAILURES.MESSAGING_UNSUPPORTED_CHANNEL }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("never produces a draft that carries a link, a protocol or a launch target", async () => {
    for (const utterance of ["escríbele a Mamá que llego tarde", "envíalo", "abre el chat con Mamá", "guarda un contacto llamado Mamá"]) {
      const { result } = await interpretText(utterance, { hasDraft: true });
      expect(JSON.stringify(result)).not.toMatch(/wa\.me|whatsapp:|https?:|openExternal|executablePath/iu);
    }
  });
});

describe("phone numbers never reach the provider", () => {
  it.each([
    "guarda un contacto llamado Mamá con el número 3001234567",
    "agrega a Juan como contacto con teléfono 300 123 4567",
    "guarda el celular 300 123 4567 como contacto",
    "anota el teléfono 3001234567 de Mamá",
    "crea un contacto Mamá +57 300 123 4567"
  ])("answers «%s» with a request to use the form and does not call the provider", async (utterance) => {
    const { result, interpret } = await interpretText(utterance);
    expect(result).toMatchObject({
      ok: true,
      data: {
        state: "NEEDS_CLARIFICATION",
        drafts: [],
        summary: "No me dictes el número por voz. Dime solo el nombre del contacto y escribirás el número en un formulario."
      }
    });
    expect(interpret).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("3001234567");
  });

  it("does not intercept unrelated requests that mention digits", async () => {
    const { result, interpret } = await interpretText("recuérdame llamar al 3001234567 mañana");
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, data: { state: "CONVERSATIONAL" } });
  });

  it("rejects a contact name that is itself an application alias or a number", async () => {
    for (const utterance of ["guarda un contacto llamado WhatsApp", "guarda un contacto llamado 3001234567"]) {
      const { result } = await interpretText(utterance);
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    }
  });
});

describe("interaction with application aliases and unrelated requests", () => {
  it("keeps the exact alias «whatsapp» as the application clarification", async () => {
    const { result, interpret } = await interpretText("WhatsApp");
    expect(result).toMatchObject({
      ok: true,
      data: { state: "NEEDS_CLARIFICATION", summary: "¿Quieres que abra o que registre WhatsApp?", drafts: [] }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("does not treat a bare contact name as an application or messaging action", async () => {
    const { result, interpret } = await interpretText("Mamá");
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, data: { state: "CONVERSATIONAL", drafts: [] } });
  });

  it.each([
    "abre WhatsApp",
    "guarda el archivo en contactos",
    "cambia a modo oscuro",
    "borra la tarea comprar pan",
    "escribe una nota para mañana",
    "descarta la tarea",
    "elimina el evento reunión"
  ])("leaves «%s» to the normal interpretation path", async (utterance) => {
    expect(parseMessagingCommand(utterance)).toBeUndefined();
    const { interpret } = await interpretText(utterance);
    expect(interpret).toHaveBeenCalledTimes(1);
  });
});

describe("provider drafts for the MESSAGING actions", () => {
  type Fields = Partial<{ contactName: string | null; aliases: string[] | null; recipient: string | null; body: string | null; channel: string | null }>;

  const messagingDraft = (action: string, fields: Fields | null, extra: Record<string, unknown> = {}) => ({
    action,
    input: null,
    weeklyRoutine: null,
    habitAction: null,
    approvedWeb: null,
    catalogApplication: null,
    filesAction: null,
    messagingAction: fields === null ? null : { contactName: null, aliases: null, recipient: null, body: null, channel: null, ...fields, ...extra }
  });
  const ready = (drafts: unknown[]) => JSON.stringify({ state: "READY", summary: "ok", responseText: "", drafts, clarifications: [] });

  it("maps a name and optional aliases to SAVE_CONTACT only when the person said them", async () => {
    const saved = await interpretText("quiero tener a Mamá en la agenda", {
      output: ready([messagingDraft("SAVE_CONTACT", { contactName: "Mamá" })])
    });
    expect(saved.result).toMatchObject({ ok: true, data: { drafts: [{ action: "SAVE_CONTACT", input: { contactName: "Mamá" } }] } });

    const aliased = await interpretText("quiero tener a Mamá, que también es Madre, en la agenda", {
      output: ready([messagingDraft("SAVE_CONTACT", { contactName: "Mamá", aliases: ["Madre"] })])
    });
    expect(aliased.result).toMatchObject({ ok: true, data: { drafts: [{ action: "SAVE_CONTACT", input: { contactName: "Mamá", aliases: ["Madre"] } }] } });

    const invented = await interpretText("quiero tener a Mamá en la agenda", {
      output: ready([messagingDraft("SAVE_CONTACT", { contactName: "Mamá", aliases: ["Jefa"] })])
    });
    expect(invented.result).toMatchObject({ ok: true, data: { state: "REJECTED", drafts: [] } });

    const unspoken = await interpretText("quiero tener a alguien en la agenda", {
      output: ready([messagingDraft("SAVE_CONTACT", { contactName: "Pedro" })])
    });
    expect(unspoken.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
  });

  it("rejects any extra field, including a phone number, in a provider draft", async () => {
    for (const extra of [{ phone: "3001234567" }, { phoneNumber: "573001234567" }, { url: "https://wa.me/573001234567" }, { contactId: "x" }]) {
      const { result } = await interpretText("quiero tener a Mamá en la agenda", {
        output: ready([messagingDraft("SAVE_CONTACT", { contactName: "Mamá" }, extra)])
      });
      expect(result).toMatchObject({ ok: true, data: { state: "REJECTED", drafts: [] } });
      expect(JSON.stringify(result)).not.toContain("3001234567");
    }
  });

  it("resolves the recipient in Main and keeps the text only when the person said it", async () => {
    const instruction = "avisa a mi mamá que ya llegué a casa";
    const ok = await interpretText(instruction, {
      output: ready([messagingDraft("PREPARE_MESSAGE_DRAFT", { recipient: "mama", body: "ya llegué a casa", channel: "WHATSAPP" })])
    });
    expect(ok.result).toMatchObject({
      ok: true,
      data: { drafts: [{ action: "PREPARE_MESSAGE_DRAFT", input: { recipient: "Mamá", body: "ya llegué a casa", channel: "WHATSAPP" } }] }
    });

    const invented = await interpretText(instruction, {
      output: ready([messagingDraft("PREPARE_MESSAGE_DRAFT", { recipient: "mama", body: "te debo dinero", channel: "WHATSAPP" })])
    });
    expect(invented.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });

    const other = await interpretText(instruction, {
      output: ready([messagingDraft("PREPARE_MESSAGE_DRAFT", { recipient: "mama", body: "ya llegué a casa", channel: "DISCORD" })])
    });
    expect(other.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [], clarifications: [{ question: expect.stringContaining(MESSAGING_FAILURES.MESSAGING_UNSUPPORTED_CHANNEL) }] } });

    const unknown = await interpretText(instruction, {
      output: ready([messagingDraft("PREPARE_MESSAGE_DRAFT", { recipient: "Pedro", body: "ya llegué a casa", channel: "WHATSAPP" })])
    });
    expect(unknown.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
  });

  it("maps list, delete, edit and discard drafts with the same closed rules", async () => {
    const list = await interpretText("dime a quién tengo guardado", { output: ready([messagingDraft("LIST_CONTACTS", null)]) });
    expect(list.result).toMatchObject({ ok: true, data: { drafts: [{ action: "LIST_CONTACTS", input: {} }] } });

    const remove = await interpretText("ya no quiero a mama guardada", { output: ready([messagingDraft("DELETE_CONTACT", { contactName: "mama" })]) });
    expect(remove.result).toMatchObject({ ok: true, data: { drafts: [{ action: "DELETE_CONTACT", input: { contactName: "Mamá" } }] } });

    const edit = await interpretText("mejor di nos vemos mañana", {
      hasDraft: true,
      output: ready([messagingDraft("EDIT_MESSAGE_DRAFT", { body: "nos vemos mañana" })])
    });
    expect(edit.result).toMatchObject({ ok: true, data: { drafts: [{ action: "EDIT_MESSAGE_DRAFT", input: { body: "nos vemos mañana" } }] } });
    const editWithout = await interpretText("mejor di nos vemos mañana", {
      hasDraft: false,
      output: ready([messagingDraft("EDIT_MESSAGE_DRAFT", { body: "nos vemos mañana" })])
    });
    expect(editWithout.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });

    const discard = await interpretText("olvida ese texto", { output: ready([messagingDraft("DISCARD_MESSAGE_DRAFT", null)]) });
    expect(discard.result).toMatchObject({ ok: true, data: { drafts: [{ action: "DISCARD_MESSAGE_DRAFT", input: {} }] } });
    const discardWithFields = await interpretText("olvida ese texto", { output: ready([messagingDraft("DISCARD_MESSAGE_DRAFT", { body: "x" })]) });
    expect(discardWithFields.result).toMatchObject({ ok: true, data: { state: "REJECTED" } });
  });

  it("rejects a messaging field attached to any other action", async () => {
    const draft = { ...messagingDraft("GET_WEATHER", { contactName: "Mamá" }), input: "{}" };
    const { result } = await interpretText("qué clima hace", { output: ready([draft]) });
    expect(result).toMatchObject({ ok: true, data: { state: "REJECTED", drafts: [] } });
  });
});

describe("strict structured-output schema for MESSAGING", () => {
  type SchemaNode = {
    type?: string;
    properties?: Record<string, SchemaNode>;
    required?: string[];
    additionalProperties?: boolean;
    anyOf?: SchemaNode[];
    items?: SchemaNode;
  };

  const collectObjects = (node: SchemaNode, found: SchemaNode[] = []): SchemaNode[] => {
    if (node.type === "object") found.push(node);
    for (const property of Object.values(node.properties ?? {})) collectObjects(property, found);
    for (const variant of node.anyOf ?? []) collectObjects(variant, found);
    if (node.items) collectObjects(node.items, found);
    return found;
  };

  const schema = OPENAI_INTERPRETATION_OUTPUT_SCHEMA as unknown as SchemaNode;
  const draftItems = (schema.properties?.drafts as SchemaNode).items as SchemaNode;
  const messagingSchema = (): SchemaNode[] =>
    (draftItems.anyOf ?? []).map((variant) => variant.properties?.messagingAction as SchemaNode);

  it("keeps every nested object closed with every property required", () => {
    for (const object of collectObjects(schema)) {
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required ?? [])].sort()).toEqual(Object.keys(object.properties ?? {}).sort());
    }
  });

  it("requires messagingAction on every draft variant and offers no number, identifier or link field", () => {
    for (const variant of draftItems.anyOf ?? []) expect(variant.required).toContain("messagingAction");
    const [general, catalog] = messagingSchema();
    expect(catalog).toEqual({ type: "null" });
    const object = (general.anyOf ?? []).find((variant) => variant.type === "object");
    expect(Object.keys(object?.properties ?? {}).sort()).toEqual(["aliases", "body", "channel", "contactName", "recipient"]);
    expect(JSON.stringify(general)).not.toMatch(/phone|number|tel[eé]fono|url|link|contactId|path/iu);
    expect(object?.properties?.channel).toEqual({ anyOf: [{ type: "string", enum: ["WHATSAPP", "DISCORD", "EMAIL", "SMS", "OTHER"] }, { type: "null" }] });
  });

  it("tells the provider never to request, write or repeat a phone number and to stay with drafts", async () => {
    const create = vi.fn(async () => ({ output_text: "{}" }));
    const provider = createOpenAiStructuredProvider({ apiKey: "test-only", model: "test-only" }, { responses: { create } } as never);
    await provider.interpret({
      instruction: "escríbele a Mamá",
      reference: { now, timeZone: "America/Bogota" },
      signal: new AbortController().signal
    });
    const [request] = create.mock.calls[0] as unknown as [{ instructions: string; input: string }];
    expect(request.instructions).toContain("Nunca pidas, escribas ni repitas un número de teléfono");
    expect(request.instructions).toContain("Ares nunca envía mensajes por sí mismo");
    expect(request.instructions).toContain("OPEN_WHATSAPP_CHAT_WITH_DRAFT");
    expect(request.instructions).toContain("SAVE_CONTACT, LIST_CONTACTS, DELETE_CONTACT, PREPARE_MESSAGE_DRAFT, EDIT_MESSAGE_DRAFT, DISCARD_MESSAGE_DRAFT");
    expect(request.input).toBe("escríbele a Mamá");
    expect(request.instructions).not.toMatch(/\d{7,}/u);
  });
});
