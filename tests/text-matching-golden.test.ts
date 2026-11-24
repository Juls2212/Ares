import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { isUnsafeAssistantDraftText, isUnsafeAssistantInstruction } from "../src/main/assistant/assistant-safety";
import { parseFileMutationCommand, parseRootAlias } from "../src/main/assistant/found-file-mutations";
import { parseFoundFileCommand, parseOrdinalPhrase } from "../src/main/assistant/found-file-references";
import { parseMessagingCommand } from "../src/main/assistant/messaging-phrases";
import { createPlannerTemporalResolver } from "../src/main/assistant/planner-temporal-resolution";
import { parseSpotifyControlCommand } from "../src/main/assistant/spotify-control-phrases";
import { parseStreamingCommand } from "../src/main/assistant/streaming-phrases";
import { foldCaseAndDiacritics, foldEventTitle, foldForAlias } from "../src/shared/text-fold";
import { DATE_INPUTS, FOLD_INPUTS, LONG_INPUT, UTTERANCES } from "./helpers/text-corpus";

/**
 * Golden tables for the text-folding functions and the phrase matchers. The expected outputs were recorded from the code as
 * it was BEFORE the shared text kit existed (Refactor 4.1) and live in tests/golden/text-matching-golden.json. They pin what
 * each distinct folding function and each phrase matcher accepts and rejects, so a consolidation cannot change behavior.
 * Set ARES_GOLDEN_WRITE=1 only to re-record deliberately; a normal run only compares.
 */

const GOLDEN_PATH = path.resolve(process.cwd(), "tests/golden/text-matching-golden.json");

/** Makes any result comparable and serializable (functions and undefined have no JSON form). */
const describeValue = (value: unknown): unknown =>
  typeof value === "function" ? "[function]" : value === undefined ? "[undefined]" : value;

const resolver = createPlannerTemporalResolver({ now: () => new Date("2026-09-20T15:00:00.000Z"), timeZone: () => "America/Bogota" });

/** Folding functions under test: name in the golden file -> implementation. */
const FOLDERS: Record<string, (value: string) => string> = {
  foldForAlias,
  foldCaseAndDiacritics,
  foldEventTitle
};

/** Phrase matchers under test over the utterance corpus. */
const MATCHERS: Record<string, (value: string) => unknown> = {
  parseOrdinalPhrase,
  parseFoundFileCommand,
  parseFileMutationCommand,
  parseRootAlias,
  parseSpotifyControlCommand,
  parseMessagingCommand,
  parseStreamingCommand,
  isUnsafeAssistantInstruction,
  isUnsafeAssistantDraftText
};

const record = (): Record<string, Array<[string, unknown]>> => {
  const out: Record<string, Array<[string, unknown]>> = {};
  for (const [name, fn] of Object.entries(FOLDERS)) out[name] = FOLD_INPUTS.map((input) => [input, describeValue(fn(input))]);
  for (const [name, fn] of Object.entries(MATCHERS)) out[name] = UTTERANCES.map((input) => [input, describeValue(fn(input))]);
  out.temporalDueDate = DATE_INPUTS.map((input) => [input, describeValue(resolver.resolve("CREATE_TASK", { title: "Tarea", dueDate: input }))]);
  return out;
};

if (process.env.ARES_GOLDEN_WRITE === "1") {
  mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(record(), null, 1)}\n`);
}

const golden = existsSync(GOLDEN_PATH) ? (JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, Array<[string, unknown]>>) : {};

describe("text folding and phrase matching golden tables", () => {
  it("has a recorded golden table for every function and matcher over the whole corpus", () => {
    expect(Object.keys(golden).sort()).toEqual([...Object.keys(FOLDERS), ...Object.keys(MATCHERS), "temporalDueDate"].sort());
    for (const name of Object.keys(FOLDERS)) expect(golden[name]).toHaveLength(FOLD_INPUTS.length);
    for (const name of Object.keys(MATCHERS)) expect(golden[name]).toHaveLength(UTTERANCES.length);
    expect(golden.temporalDueDate).toHaveLength(DATE_INPUTS.length);
    expect(FOLD_INPUTS.length + UTTERANCES.length + DATE_INPUTS.length).toBeGreaterThan(150);
  });

  for (const [name, fn] of Object.entries(FOLDERS)) {
    it(`${name} gives the recorded result for every folding input`, () => {
      expect(FOLD_INPUTS.map((input) => [input, describeValue(fn(input))])).toEqual(golden[name]);
    });

    it(`${name} finishes a 10,000-character input quickly`, () => {
      const started = performance.now();
      fn(LONG_INPUT);
      expect(performance.now() - started).toBeLessThan(2000);
    });
  }

  for (const [name, fn] of Object.entries(MATCHERS)) {
    it(`${name} accepts and rejects exactly what it did before over every utterance`, () => {
      expect(UTTERANCES.map((input) => [input, describeValue(fn(input))])).toEqual(golden[name]);
    });
  }

  it("resolves Spanish due-date words exactly as before", () => {
    expect(DATE_INPUTS.map((input) => [input, describeValue(resolver.resolve("CREATE_TASK", { title: "Tarea", dueDate: input }))])).toEqual(
      golden.temporalDueDate
    );
  });

  it("keeps the matchers finite on a 10,000-character utterance", () => {
    for (const [name, fn] of Object.entries(MATCHERS)) {
      const started = performance.now();
      fn(LONG_INPUT);
      expect(performance.now() - started, name).toBeLessThan(3000);
    }
  });

  it("pins the corpus cases the task calls out", () => {
    const outcome = (name: string, input: string): unknown => golden[name]!.find((entry) => entry[0] === input)?.[1];
    expect(outcome("parseOrdinalPhrase", "abre el segundo")).toBe("[undefined]");
    expect(outcome("parseFoundFileCommand", "abre el segundo")).toMatchObject({ action: "OPEN_FOUND_FILE", target: { kind: "ORDINAL", ordinal: 2 } });
    expect(outcome("parseFoundFileCommand", "ábreme el último")).toMatchObject({ target: { kind: "ORDINAL", ordinal: "LAST" } });
    expect(outcome("foldForAlias", "José")).toBe("jose");
    expect(outcome("foldForAlias", "Núñez")).toBe("nunez");
    expect(outcome("foldForAlias", "pingüino")).toBe("pinguino");
    expect(outcome("foldEventTitle", "José")).toBe("josé");
    // The one deliberate behavior change after the golden tables were recorded (Refactor 4.2, part B): these two entries used to be a
    // function (Object.prototype.constructor) and are now undefined.
    expect(outcome("parseOrdinalPhrase", "constructor")).toBe("[undefined]");
    expect(outcome("parseRootAlias", "constructor")).toBe("[undefined]");
  });

  it("looks every user-text table up by own property, so prototype member names are never a match", () => {
    const names = ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "isPrototypeOf", "Constructor", "CONSTRUCTOR"];
    for (const name of names) {
      expect(parseOrdinalPhrase(name), name).toBeUndefined();
      expect(parseOrdinalPhrase(`el ${name}`), name).toBeUndefined();
      expect(parseOrdinalPhrase(`numero ${name}`), name).toBeUndefined();
      expect(parseRootAlias(name), name).toBeUndefined();
      expect(parseRootAlias(`mi ${name}`), name).toBeUndefined();
      const due = resolver.resolve("CREATE_TASK", { title: "Tarea", dueDate: name });
      expect(due, name).toMatchObject({ ok: false });
    }
    // The real entries still resolve.
    expect(parseOrdinalPhrase("el segundo")).toBe(2);
    expect(parseOrdinalPhrase("numero tres")).toBe(3);
    expect(parseRootAlias("mis documentos")).toBe("DOCUMENTS");
    expect(resolver.resolve("CREATE_TASK", { title: "Tarea", dueDate: "viernes" })).toMatchObject({ ok: true });
  });
});

