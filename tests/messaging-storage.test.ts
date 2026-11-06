import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createMessagingActionExecutor } from "../src/main/actions/messaging-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { messagingContactAliases, messagingContacts } from "../src/main/database/schema";
import {
  classifyStorageError,
  createMessagingContactRepository,
  MessagingRepositoryError
} from "../src/main/messaging/messaging-contact-repository";
import {
  MESSAGING_EXECUTION_FAILURE_CODES,
  MESSAGING_FAILURES,
  messagingFailure
} from "../src/main/messaging/messaging-failures";
import { createMessagingService } from "../src/main/messaging/messaging-service";
import { composeFinalResponse } from "../src/main/voice/final-response-composer";
import { createFakeMessagingFlow } from "./helpers/fake-messaging";

const STORAGE_MESSAGE = "No pude acceder a tus contactos. Revisa que la base de datos esté actualizada.";
const LEAK = /SELECT|messaging_contacts|messaging_contact_aliases|_check|_unique|573001234567|3001234567|Mamá|llego/u;

/** What node-postgres raises, wrapped the way drizzle-orm 0.45 wraps it: the SQLSTATE lives on `cause`. */
const wrapped = (code: string): Error => {
  const driver = Object.assign(new Error('relation "messaging_contacts" does not exist'), { code });
  return Object.assign(new Error("Failed query: select * from messaging_contacts params: 573001234567"), { cause: driver });
};

const selectThatRejects = (error: unknown) => ({
  select: () => ({ from: () => ({ orderBy: () => Promise.reject(error), where: () => ({ limit: () => Promise.reject(error) }) }) })
});

describe("storage failures are classified without leaking anything", () => {
  it("reads the SQLSTATE from the drizzle wrapper's cause chain", () => {
    expect(classifyStorageError(wrapped("42P01"))).toBe("SCHEMA_MISSING");
    expect(classifyStorageError(wrapped("42703"))).toBe("SCHEMA_MISMATCH");
    expect(classifyStorageError(wrapped("23514"))).toBe("CONSTRAINT");
    expect(classifyStorageError(wrapped("08006"))).toBe("CONNECTION");
    expect(classifyStorageError(wrapped("ECONNREFUSED"))).toBe("CONNECTION");
    expect(classifyStorageError(wrapped("XX000"))).toBe("OTHER");
    for (const unknown of [undefined, null, "text", 42, {}, new Error("boom")]) expect(classifyStorageError(unknown)).toBe("OTHER");
  });

  it("turns every repository read failure into one error type carrying only the safe category", async () => {
    const repository = createMessagingContactRepository(selectThatRejects(wrapped("42P01")) as never);
    const error = await repository.listIdentities().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MessagingRepositoryError);
    expect(error).toMatchObject({ kind: "UNAVAILABLE", category: "SCHEMA_MISSING" });
    expect(JSON.stringify([(error as Error).message, (error as MessagingRepositoryError).category])).not.toMatch(LEAK);
    await expect(repository.findPhoneTail("id")).rejects.toMatchObject({ kind: "UNAVAILABLE", category: "SCHEMA_MISSING" });
    await expect(repository.findPhoneDigits("id")).rejects.toBeInstanceOf(MessagingRepositoryError);
    await expect(repository.findIdentity("id")).rejects.toBeInstanceOf(MessagingRepositoryError);
  });

  it("recognizes a unique violation even when drizzle wraps it (regression: the code was only read from the top level)", async () => {
    const database = { transaction: async () => { throw wrapped("23505"); } };
    const repository = createMessagingContactRepository(database as never);
    await expect(
      repository.insert({ displayName: "Mamá", lookupKey: "mama", phoneDigits: "573001234567", aliases: [] })
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    const failing = createMessagingContactRepository({ transaction: async () => { throw wrapped("42P01"); } } as never);
    await expect(
      failing.insert({ displayName: "Mamá", lookupKey: "mama", phoneDigits: "573001234567", aliases: [] })
    ).rejects.toMatchObject({ kind: "UNAVAILABLE", category: "SCHEMA_MISSING" });
  });
});

describe("the storage category in the service, the executor and the interpreter", () => {
  const unavailableRepository = (category: "SCHEMA_MISSING" | "CONNECTION" | "OTHER" = "SCHEMA_MISSING") => {
    const fail = vi.fn(async () => { throw new MessagingRepositoryError("UNAVAILABLE", category); });
    return { listIdentities: fail, findIdentity: fail, findPhoneTail: fail, findPhoneDigits: fail, insert: fail, remove: fail };
  };
  const serviceWith = (repository: ReturnType<typeof unavailableRepository>) => {
    const logError = vi.fn();
    const flow = createFakeMessagingFlow();
    const service = createMessagingService({ repository, contactForm: flow.broker, chatLauncher: flow.chatLauncher, logError });
    return { service, logError };
  };

  it("has the fixed Spanish message, as an execution failure, next to every previous category", () => {
    expect(MESSAGING_FAILURES.MESSAGING_STORAGE_UNAVAILABLE).toBe(STORAGE_MESSAGE);
    expect(MESSAGING_EXECUTION_FAILURE_CODES).toContain("MESSAGING_STORAGE_UNAVAILABLE");
    expect(messagingFailure("MESSAGING_STORAGE_UNAVAILABLE")).toEqual({
      ok: false,
      error: { code: "MESSAGING_STORAGE_UNAVAILABLE", userMessage: STORAGE_MESSAGE }
    });
    expect(MESSAGING_FAILURES.MESSAGING_OPERATION_FAILED).toBe("No se pudo completar la operación con contactos.");
    expect(MESSAGING_FAILURES.MESSAGING_OPEN_FAILED).toBe("No pude abrir WhatsApp. Revisa que esté instalado.");
    expect(MESSAGING_FAILURES.MESSAGING_CONTACT_NOT_FOUND).toBe("No encontré ese contacto. Indica el nombre de uno de tus contactos guardados.");
  });

  it("reports «qué contactos tengo» as a storage failure, with a log line that names only a stage and a category", async () => {
    const { service, logError } = serviceWith(unavailableRepository("SCHEMA_MISSING"));
    await expect(service.listContacts()).resolves.toEqual({
      ok: false,
      error: { code: "MESSAGING_STORAGE_UNAVAILABLE", userMessage: STORAGE_MESSAGE }
    });
    expect(logError.mock.calls).toEqual([["Messaging storage unavailable [stage=lookup, category=SCHEMA_MISSING]."]]);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(LEAK);
  });

  it("maps a raw non-repository error to the same category with the category OTHER and no detail", async () => {
    const flow = createFakeMessagingFlow();
    flow.failures.listIdentities = true;
    await expect(flow.service.listContacts()).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_STORAGE_UNAVAILABLE" } });
    expect(flow.logError.mock.calls).toEqual([["Messaging storage unavailable [stage=lookup, category=OTHER]."]]);
    expect(JSON.stringify(flow.logError.mock.calls)).not.toMatch(LEAK);
  });

  it("uses the storage category when the recipient cannot be resolved because storage is down", async () => {
    const { service } = serviceWith(unavailableRepository());
    await expect(service.resolveContactReference("Mamá")).resolves.toEqual({ state: "UNAVAILABLE" });
    await expect(service.prepareDraft({ recipient: "Mamá", body: "llego en diez minutos", channel: "WHATSAPP" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MESSAGING_STORAGE_UNAVAILABLE" }
    });
    await expect(service.prepareDeleteContact({ contactName: "Mamá" })).resolves.toMatchObject({ ok: false, error: { code: "MESSAGING_STORAGE_UNAVAILABLE" } });
  });

  it("keeps «contact not found» a different, unchanged failure when storage works", async () => {
    const flow = createFakeMessagingFlow();
    await expect(flow.service.prepareDraft({ recipient: "Mamá", body: "hola", channel: "WHATSAPP" })).resolves.toMatchObject({
      ok: false,
      error: { code: "MESSAGING_CONTACT_NOT_FOUND" }
    });
    expect(flow.logError).not.toHaveBeenCalled();
  });

  it("surfaces the storage failure through the executor as EXECUTION_FAILED with no sensitive text anywhere", async () => {
    const { service } = serviceWith(unavailableRepository());
    const logError = vi.fn();
    const unused = { execute: vi.fn() } as never;
    const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
    const orchestrator = createActionOrchestrator({
      executor: createActionExecutor({
        plannerExecutor: unused,
        applicationExecutor: unused,
        approvedWebExecutor: unused,
        filesExecutor: unused,
        messagingExecutor: createMessagingActionExecutor({ service, logError })
      }),
      historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
      generateIdentifier: () => "00000000-0000-4000-8000-000000000001",
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      logError
    });
    const outcome = await orchestrator.propose({ action: "LIST_CONTACTS", input: {} });
    expect(outcome).toMatchObject({
      ok: true,
      data: { status: "EXECUTION_FAILED", errorCode: "MESSAGING_STORAGE_UNAVAILABLE", userSummary: STORAGE_MESSAGE }
    });
    expect(JSON.stringify([recordTerminal.mock.calls, logError.mock.calls])).not.toMatch(LEAK);
    // Nothing is composed for speech beyond the fixed failure message.
    expect(composeFinalResponse((outcome as unknown as { data: never }).data)).toBeUndefined();
  });

  it("answers a draft request with the storage message instead of the generic one", async () => {
    const interpreter = createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret: vi.fn() }),
      now: () => new Date("2026-09-20T15:00:00.000Z"),
      timeZone: () => "America/Bogota",
      resolveMessagingContact: async () => ({ state: "UNAVAILABLE" }),
      hasActiveMessageDraft: () => false
    });
    const result = await interpreter.interpret({ instruction: "escríbele a Mamá que llego en diez minutos" });
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", clarifications: [{ question: STORAGE_MESSAGE }] } });
  });
});

describe("the migration, snapshot and schema agree without a database", () => {
  const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string; when: number }> };
  const snapshot = (index: number) => JSON.parse(read(`drizzle/meta/000${index}_snapshot.json`)) as {
    id: string;
    prevId: string;
    tables: Record<string, { columns: Record<string, { type: string; notNull: boolean }>; indexes: Record<string, { isUnique: boolean }>; checkConstraints: Record<string, { value: string }>; foreignKeys: Record<string, { onDelete: string }> }>;
  };
  const sql = read("drizzle/0008_messaging_contacts.sql");

  it("lists every migration once, in order, with strictly increasing timestamps and one SQL file each", () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_entry, index) => index));
    expect(journal.entries.at(-1)?.tag).toBe("0008_messaging_contacts");
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
    for (const entry of journal.entries) expect(() => read(`drizzle/${entry.tag}.sql`)).not.toThrow();
  });

  it("chains every snapshot to the previous one with unique ids", () => {
    const snapshots = journal.entries.map((_entry, index) => snapshot(index));
    expect(new Set(snapshots.map((entry) => entry.id)).size).toBe(snapshots.length);
    for (let index = 1; index < snapshots.length; index += 1) expect(snapshots[index]!.prevId).toBe(snapshots[index - 1]!.id);
  });

  it("describes the same columns, indexes, checks and cascade as the Drizzle schema, in the snapshot and in the SQL", () => {
    const snapshotTables = snapshot(8).tables;
    for (const [table, key] of [[messagingContacts, "public.messaging_contacts"], [messagingContactAliases, "public.messaging_contact_aliases"]] as const) {
      const config = getTableConfig(table);
      const described = snapshotTables[key]!;
      expect(Object.keys(described.columns).sort()).toEqual(config.columns.map((column) => column.name).sort());
      for (const column of config.columns) {
        expect(described.columns[column.name]!.notNull, column.name).toBe(column.notNull);
        expect(sql).toContain(`"${column.name}"`);
      }
      expect(Object.keys(described.indexes).sort()).toEqual(config.indexes.map((index) => index.config.name!).sort());
      for (const index of config.indexes) {
        expect(described.indexes[index.config.name!]!.isUnique).toBe(index.config.unique);
        expect(sql).toContain(`${index.config.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX"} "${index.config.name!}"`);
      }
      expect(Object.keys(described.checkConstraints).sort()).toEqual(config.checks.map((check) => check.name).sort());
      for (const check of config.checks) expect(sql).toContain(`CONSTRAINT "${check.name}" CHECK`);
    }
    const foreignKeys = getTableConfig(messagingContactAliases).foreignKeys;
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]!.onDelete).toBe("cascade");
    expect(sql).toContain("ON DELETE cascade");
    expect(sql).toContain('REFERENCES "public"."messaging_contacts"("id")');
  });

  it("keeps the unique normalized-name and alias indexes and the phone format check", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "messaging_contacts_lookup_key_unique"');
    expect(sql).toContain('CREATE UNIQUE INDEX "messaging_contact_aliases_lookup_key_unique"');
    expect(sql).toContain("^[1-9][0-9]{7,14}$");
    expect(sql).toContain('"phone_digits" varchar(15) NOT NULL');
    // Statements are separated the way drizzle-kit writes them, and the file touches nothing outside its tables.
    expect(sql.match(/--> statement-breakpoint/gu)).toHaveLength(5);
    expect(sql).not.toMatch(/DROP |ALTER TYPE|ALTER TABLE "(?!messaging_contact)/u);
  });

  it("accepts the numbers the service produces and rejects what the check would", () => {
    const check = /^[1-9][0-9]{7,14}$/u;
    for (const digits of ["573001234567", "14155550123", "34612345678"]) expect(check.test(digits)).toBe(true);
    for (const digits of ["03001234567", "1234567", "5730012345678901", "57300abc4567", ""]) expect(check.test(digits)).toBe(false);
  });
});
