import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: {}, dialog: {} }));

import { ContactFormDialog } from "../src/renderer/features/messaging/contact-form-dialog";
import { createMessagingIpcRegistration, type MessagingIpcHandler } from "../src/main/ipc/register-messaging-ipc";
import {
  createMessagingContactRepository,
  MessagingRepositoryError
} from "../src/main/messaging/messaging-contact-repository";
import { messagingContactAliases, messagingContacts } from "../src/main/database/schema";
import { IPC_CHANNELS } from "../src/shared/contracts";
import { createFakeMessagingFlow } from "./helpers/fake-messaging";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("messaging IPC registration", () => {
  const register = (broker = createFakeMessagingFlow().broker) => {
    const handlers = new Map<string, MessagingIpcHandler>();
    const logError = vi.fn();
    createMessagingIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getBroker: () => broker,
      logError
    })();
    return { handlers, logError, broker };
  };

  it("registers exactly the two named renderer-to-Main channels and nothing generic", () => {
    const { handlers } = register();
    expect([...handlers.keys()].sort()).toEqual([
      IPC_CHANNELS.messaging.cancelContactForm,
      IPC_CHANNELS.messaging.submitContactForm
    ].sort());
    expect(IPC_CHANNELS.messaging.contactFormRequested).toBe("messaging:contact-form-requested");
    expect(handlers.has(IPC_CHANNELS.messaging.contactFormRequested)).toBe(false);
  });

  it("registers only once", () => {
    const registerHandler = vi.fn();
    const registration = createMessagingIpcRegistration({ registerHandler, getBroker: () => createFakeMessagingFlow().broker, logError: vi.fn() });
    registration();
    registration();
    expect(registerHandler).toHaveBeenCalledTimes(2);
  });

  it("validates submissions strictly and answers with fixed messages", async () => {
    const { handlers } = register();
    const submit = handlers.get(IPC_CHANNELS.messaging.submitContactForm) as MessagingIpcHandler;
    const cancel = handlers.get(IPC_CHANNELS.messaging.cancelContactForm) as MessagingIpcHandler;

    for (const input of [undefined, "x", { requestId: "x" }, { requestId: "x", displayName: "Mamá", phone: "3001234567", extra: 1 }]) {
      await expect(submit(input)).resolves.toMatchObject({ ok: false });
    }
    await expect(submit({ requestId: "unknown", displayName: "Mamá", phone: "3001234567" })).resolves.toMatchObject({
      ok: false, error: { code: "MESSAGING_PENDING_EXPIRED" }
    });
    await expect(cancel({ requestId: "unknown" })).resolves.toMatchObject({ ok: false });
    await expect(cancel({})).resolves.toMatchObject({ ok: false });
  });

  it("completes a real form request through the registered channels without returning the number", async () => {
    const flow = createFakeMessagingFlow();
    const { handlers } = register(flow.broker);
    const preparing = flow.startSave({ contactName: "Mamá" });
    await vi.waitFor(() => expect(flow.requests.length).toBe(1));

    const response = await (handlers.get(IPC_CHANNELS.messaging.submitContactForm) as MessagingIpcHandler)({
      requestId: flow.lastRequest().requestId,
      displayName: "Mamá",
      phone: "+57 300 123 4567"
    });

    expect(response).toEqual({ ok: true, data: { status: "ACCEPTED" } });
    const prepared = await preparing;
    expect(JSON.stringify([response, prepared])).not.toMatch(/573001234567|3001234567|300 123/u);
  });

  it("contains an unexpected failure with a constant log message", async () => {
    const broken = { submit: vi.fn(async () => { throw new Error("phone 573001234567"); }), cancel: vi.fn(), request: vi.fn(), shutdown: vi.fn() };
    const { handlers, logError } = register(broken as never);
    const result = await (handlers.get(IPC_CHANNELS.messaging.submitContactForm) as MessagingIpcHandler)({});
    expect(result).toMatchObject({ ok: false, error: { code: "MESSAGING_OPERATION_FAILED" } });
    expect(logError.mock.calls).toEqual([["Messaging IPC handler failed."]]);
    expect(JSON.stringify([result, logError.mock.calls])).not.toContain("573001234567");
  });
});

describe("contact form dialog", () => {
  const render = () => renderToStaticMarkup(createElement(ContactFormDialog, {
    request: { requestId: "form-1", displayName: "Mamá" },
    onSubmit: vi.fn(async () => undefined),
    onCancel: vi.fn()
  }));

  it("shows the spoken name prefilled and an empty phone field that is not stored or autofilled", () => {
    const markup = render();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('value="Mamá"');
    expect(markup).toMatch(/<input[^>]*type="tel"[^>]*name="contact-phone"[^>]*value=""/u);
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain("Número de teléfono");
    expect(markup).toContain("Continuar");
    expect(markup).toContain("Cancelar");
    expect(markup).not.toMatch(/\d{7,}/u);
  });

  it("holds the number only in its own state: no storage, no IPC and no logging in the component", () => {
    const component = source("src/renderer/features/messaging/contact-form-dialog.tsx");
    for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "window.ares", "ipcRenderer", "console.", "document.cookie"]) {
      expect(component).not.toContain(forbidden);
    }
  });

  it("sends the form only through the three named preload methods", () => {
    const app = source("src/renderer/app/App.tsx");
    expect(app).toContain("window.ares.messaging.onContactFormRequested");
    expect(app).toContain("window.ares.messaging.submitContactForm({ requestId: contactForm.requestId, ...values })");
    expect(app).toContain("window.ares.messaging.cancelContactForm({ requestId: form.requestId })");
    expect(app).not.toMatch(/localStorage|sessionStorage/u);
  });
});

describe("main process wiring", () => {
  const main = source("src/main/main.ts");

  it("registers the form channels, delivers the request to the one trusted window, and clears state on quit", () => {
    expect(main).toContain("registerMessagingIpcHandlers()");
    expect(main).toContain("configureContactFormSender(");
    expect(main).toContain("mainWindow.webContents.send(IPC_CHANNELS.messaging.contactFormRequested, request)");
    expect(main.match(/webContents\.send\(/gu)?.length).toBe(1);
    const quit = main.slice(main.indexOf('app.once("before-quit"'));
    expect(quit.slice(0, 200)).toContain("shutdownMessaging()");
    expect(main).not.toMatch(/openExternal|wa\.me|whatsapp:/u);
  });

  it("gives the interpreter only Main-side resolvers, never contact data", () => {
    const composition = source("src/main/assistant/assistant-composition.ts");
    expect(composition).toContain("resolveMessagingContact: (reference) => getMessagingService().resolveContactReference(reference)");
    expect(composition).toContain("hasActiveMessageDraft: () => getMessagingService().hasActiveDraft()");
    expect(source("src/shared/assistant-contracts.ts")).not.toMatch(/contact|phone|messaging/iu);
  });
});

describe("no sending, opening, link or generic surface in the MESSAGING code", () => {
  const files = [
    "src/main/messaging/contact-form-broker.ts",
    "src/main/messaging/expiring-store.ts",
    "src/main/messaging/messaging-composition.ts",
    "src/main/messaging/messaging-contact-repository.ts",
    "src/main/messaging/messaging-failures.ts",
    "src/main/messaging/messaging-service.ts",
    "src/main/messaging/messaging-validation.ts",
    "src/main/actions/messaging-action-executor.ts",
    "src/main/assistant/messaging-phrases.ts",
    "src/main/ipc/register-messaging-ipc.ts",
    "src/shared/messaging-contracts.ts",
    "src/renderer/features/messaging/contact-form-dialog.tsx"
  ];

  it.each(files)("%s has no process, shell, filesystem, network or link capability", (file) => {
    const code = source(file);
    expect(code).not.toMatch(/\bshell\b|openExternal|openPath|child_process|\bspawn\(|(?<![.\w])exec\(|execFile|node:fs|node:path|node:http|node:net|fetch\(|XMLHttpRequest|WebSocket|wa\.me|whatsapp:\/\/|https?:\/\//u);
    expect(code).not.toMatch(/console\.(?:log|info|debug)/u);
  });

  it("logs only constant messages in the MESSAGING Main code", () => {
    for (const file of files.filter((entry) => entry.startsWith("src/main"))) {
      for (const call of source(file).match(/logError\([^)]*\)/gu) ?? []) {
        // Constant text, or the one template whose only parts are a closed stage name and a closed category.
        expect(call).toMatch(/logError\(("[^"$]*"|message|`Messaging storage unavailable \[stage=\$\{stage\}, category=\$\{category\}\]\.`)\)/u);
      }
    }
  });

  it("keeps the phone number out of every provider-, history- and assistant-facing contract", () => {
    for (const file of [
      "src/shared/action-contracts.ts",
      "src/shared/assistant-contracts.ts",
      "src/main/assistant/openai-structured-provider.ts",
      "src/main/actions/action-history-service.ts",
      "src/main/actions/action-history-repository.ts",
      "src/main/voice/final-response-composer.ts"
    ]) {
      expect(source(file)).not.toMatch(/phoneDigits|phoneNumber|phone_digits|\bphone:/u);
    }
  });

  it("exposes no way to read a stored number from the repository", () => {
    const repository = source("src/main/messaging/messaging-contact-repository.ts");
    expect(repository).toContain("findPhoneTail");
    expect(repository).not.toMatch(/findPhone(?!Tail|Digits)|getPhone|readPhone/u);
    // The full number is read only for the one confirmed launch: repository, service and nothing else.
    for (const file of readdirSync(path.resolve(process.cwd(), "src"), { recursive: true, encoding: "utf8" }).filter((entry) => /\.tsx?$/u.test(entry))) {
      if (source(path.join("src", file)).includes("findPhoneDigits")) {
        expect(["main\\messaging\\messaging-contact-repository.ts", "main\\messaging\\messaging-service.ts", "main/messaging/messaging-contact-repository.ts", "main/messaging/messaging-service.ts"]).toContain(file);
      }
    }
  });
});

describe("contact repository", () => {
  const createDatabase = (behavior: { transaction?: () => Promise<unknown>; phoneRows?: Array<{ phoneDigits: string }> }) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => behavior.phoneRows ?? []
    };
    return {
      select: () => chain,
      transaction: behavior.transaction ?? (async () => "id"),
      delete: () => ({ where: () => ({ returning: async () => [{ id: "x" }] }) })
    } as never;
  };

  it("returns only the last four digits for the masked label", async () => {
    const repository = createMessagingContactRepository(createDatabase({ phoneRows: [{ phoneDigits: "573001234567" }] }));
    await expect(repository.findPhoneTail("contact")).resolves.toBe("4567");
    await expect(createMessagingContactRepository(createDatabase({})).findPhoneTail("contact")).resolves.toBeUndefined();
  });

  it("maps a unique violation to a conflict and anything else to unavailable, without the original error", async () => {
    const insert = {
      displayName: "Mamá", lookupKey: "mama", phoneDigits: "573001234567", aliases: []
    };
    const conflict = createMessagingContactRepository(createDatabase({
      transaction: async () => { throw Object.assign(new Error("duplicate key value violates unique constraint 573001234567"), { code: "23505" }); }
    }));
    const failure = createMessagingContactRepository(createDatabase({
      transaction: async () => { throw new Error("connection refused 573001234567"); }
    }));

    const conflictError = await conflict.insert(insert).catch((error: unknown) => error);
    const failureError = await failure.insert(insert).catch((error: unknown) => error);

    expect(conflictError).toBeInstanceOf(MessagingRepositoryError);
    expect(conflictError).toMatchObject({ kind: "CONFLICT", message: "Messaging persistence operation failed." });
    expect(failureError).toMatchObject({ kind: "UNAVAILABLE", message: "Messaging persistence operation failed." });
  });
});

describe("database schema and migration", () => {
  it("defines contacts with digits-only phone storage, unique normalized keys and cascading aliases", () => {
    const contacts = getTableConfig(messagingContacts);
    const aliases = getTableConfig(messagingContactAliases);

    expect(contacts.name).toBe("messaging_contacts");
    expect(contacts.columns.map((column) => column.name)).toEqual(["id", "display_name", "lookup_key", "phone_digits", "created_at", "updated_at"]);
    expect(contacts.columns.find((column) => column.name === "phone_digits")).toMatchObject({ notNull: true, dataType: "string" });
    expect(contacts.indexes.find((index) => index.config.name === "messaging_contacts_lookup_key_unique")?.config.unique).toBe(true);
    expect(contacts.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "messaging_contacts_display_name_non_blank_check",
      "messaging_contacts_phone_digits_format_check"
    ]));

    expect(aliases.name).toBe("messaging_contact_aliases");
    expect(aliases.columns.map((column) => column.name)).toEqual(["id", "contact_id", "alias", "lookup_key", "created_at"]);
    expect(aliases.indexes.find((index) => index.config.name === "messaging_contact_aliases_lookup_key_unique")?.config.unique).toBe(true);
    expect(aliases.foreignKeys[0].onDelete).toBe("cascade");
  });

  it("ships a hand-written migration, its journal entry and a chained snapshot", () => {
    const migration = source("drizzle/0008_messaging_contacts.sql");
    expect(migration).toContain('CREATE TABLE "messaging_contacts"');
    expect(migration).toContain('CREATE TABLE "messaging_contact_aliases"');
    expect(migration).toContain("ON DELETE cascade");
    expect(migration).toContain('CREATE UNIQUE INDEX "messaging_contacts_lookup_key_unique"');
    expect(migration).toContain('CREATE UNIQUE INDEX "messaging_contact_aliases_lookup_key_unique"');
    expect(migration).toContain("'^[1-9][0-9]{7,14}$'");
    expect(migration.split("--> statement-breakpoint").length).toBeGreaterThan(4);

    const journal = JSON.parse(source("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({ idx: 8, tag: "0008_messaging_contacts" });
    expect(journal.entries.map((entry) => entry.idx)).toEqual([...journal.entries.keys()]);

    const previous = JSON.parse(source("drizzle/meta/0007_snapshot.json")) as { id: string };
    const snapshot = JSON.parse(source("drizzle/meta/0008_snapshot.json")) as { id: string; prevId: string; tables: Record<string, unknown> };
    expect(snapshot.prevId).toBe(previous.id);
    expect(snapshot.id).not.toBe(previous.id);
    expect(Object.keys(snapshot.tables)).toEqual(expect.arrayContaining(["public.messaging_contacts", "public.messaging_contact_aliases", "public.applications"]));
  });

  it("does not add any phone column to action history", () => {
    expect(source("src/main/database/schema/action-history.ts")).not.toMatch(/phone|contact|message/iu);
  });
});
