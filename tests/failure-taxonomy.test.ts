import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { CATALOG_LAUNCH_FAILURE, CATALOG_REGISTRATION_FAILURES } from "../src/main/applications/catalog-registration-failures";
import { FILES_FAILURES, filesFailure } from "../src/main/files/supervised-file-failures";
import { MESSAGING_FAILURES, type MessagingFailureCode, messagingFailure } from "../src/main/messaging/messaging-failures";
import { SPOTIFY_FAILURES, spotifyFailure } from "../src/main/spotify/spotify-failures";
import { WEATHER_ERROR_CODES, weatherUserMessage } from "../src/main/weather/weather-service";
import type { ActionData } from "../src/shared/action-contracts";
import { defineFailureTaxonomy } from "../src/shared/failure-taxonomy";
import { ELEVENLABS_FAILURES } from "../src/main/voice/elevenlabs-speech-provider";
import { VOICE_CAPTURE_FAILURES } from "../src/shared/voice-diagnostics";
import {
  cancelledOutcome,
  clarificationInterpretation,
  failedOutcome,
  historySentences,
  outcomeIdentity,
  succeededOutcome
} from "../src/shared/outcome-kit";
import { readSource } from "./helpers/read-source";

const demo = defineFailureTaxonomy({ DEMO_ONE: "Primer mensaje fijo.", DEMO_TWO: "Segundo mensaje fijo." });

describe("failure taxonomy factory", () => {
  it("derives the code list, message lookup and result shapes from the single table", () => {
    expect(demo.codes).toEqual(["DEMO_ONE", "DEMO_TWO"]);
    expect(demo.messageFor("DEMO_TWO")).toBe("Segundo mensaje fijo.");
    expect(demo.failure("DEMO_ONE")).toEqual({ ok: false, error: { code: "DEMO_ONE", userMessage: "Primer mensaje fijo." } });
    expect(demo.success({ value: 1 })).toEqual({ ok: true, data: { value: 1 } });
  });

  it("guards with own-property checks: known codes pass, unknown and prototype-like names do not", () => {
    for (const code of demo.codes) expect(demo.isCode(code)).toBe(true);
    for (const value of ["", "demo_one", "DEMO_THREE", "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", 1, null, undefined, {}, ["DEMO_ONE"]]) {
      expect(demo.isCode(value), String(value)).toBe(false);
    }
  });

  it("makes a missing message a compile-time error (checked by the typechecker, asserted here at the type level)", () => {
    // Each of these lines fails to compile if the taxonomy and its code type ever drift apart.
    const everyMessagingCodeHasAMessage: Record<MessagingFailureCode, string> = MESSAGING_FAILURES;
    // @ts-expect-error a code that is not in the table cannot be looked up
    demo.messageFor("DEMO_THREE");
    // @ts-expect-error a plain string is not a known code until the guard has narrowed it
    demo.failure("anything" as string);
    expect(Object.keys(everyMessagingCodeHasAMessage)).toHaveLength(Object.keys(MESSAGING_FAILURES).length);
  });

  it("keeps the migrated builders on the shared shape", () => {
    expect(messagingFailure("MESSAGING_NO_DRAFT")).toEqual({ ok: false, error: { code: "MESSAGING_NO_DRAFT", userMessage: MESSAGING_FAILURES.MESSAGING_NO_DRAFT } });
    expect(spotifyFailure("SPOTIFY_NO_RESULTS").error.userMessage).toBe(SPOTIFY_FAILURES.SPOTIFY_NO_RESULTS);
    expect(filesFailure("FILES_NO_RESULTS")).toEqual({ ok: false, error: { code: "FILES_NO_RESULTS", userMessage: FILES_FAILURES.FILES_NO_RESULTS } });
    expect(filesFailure("FILES_PARTIAL_COMPLETION", { moved: 1, failed: 2 })).toMatchObject({ error: { counts: { moved: 1, failed: 2 } } });
  });
});

describe("outcome kit", () => {
  const identity = outcomeIdentity({ actionId: "id-1", action: "CREATE_TASK" }, { riskLevel: 1 });

  it("builds the exact outcome shapes the executors used to build by hand", () => {
    expect(identity).toEqual({ actionId: "id-1", action: "CREATE_TASK", riskLevel: 1 });
    expect(succeededOutcome(identity, "Hecho.")).toStrictEqual({ actionId: "id-1", action: "CREATE_TASK", riskLevel: 1, status: "SUCCEEDED", userSummary: "Hecho." });
    const data: ActionData = { applicationName: "Word" };
    expect(succeededOutcome(identity, "Hecho.", { data, errorCode: "X" })).toStrictEqual({
      actionId: "id-1", action: "CREATE_TASK", riskLevel: 1, status: "SUCCEEDED", data, errorCode: "X", userSummary: "Hecho."
    });
    expect(failedOutcome(identity, "VALIDATION_FAILED", "CODE", "No.")).toStrictEqual({
      actionId: "id-1", action: "CREATE_TASK", riskLevel: 1, status: "VALIDATION_FAILED", errorCode: "CODE", userSummary: "No."
    });
    expect(failedOutcome(identity, "EXECUTION_FAILED", "CODE", "No.", { movedCount: 1, failedCount: 2 })).toMatchObject({ status: "EXECUTION_FAILED", data: { movedCount: 1, failedCount: 2 } });
    expect(cancelledOutcome(identity, "Cancelado.")).toStrictEqual({ actionId: "id-1", action: "CREATE_TASK", riskLevel: 1, status: "CANCELLED", userSummary: "Cancelado." });
    expect(cancelledOutcome(identity, "Cancelado.", "WHY")).toStrictEqual({ actionId: "id-1", action: "CREATE_TASK", riskLevel: 1, status: "CANCELLED", errorCode: "WHY", userSummary: "Cancelado." });
  });

  it("never invents fields: nothing but identity, status, the given summary, data and code appears", () => {
    for (const outcome of [succeededOutcome(identity, "a"), failedOutcome(identity, "EXECUTION_FAILED", "c", "b"), cancelledOutcome(identity, "d")]) {
      expect(Object.keys(outcome).every((key) => ["actionId", "action", "riskLevel", "status", "errorCode", "userSummary"].includes(key))).toBe(true);
    }
  });

  it("builds the generic history sentence by category, falling back to the failure sentence when there is no cancelled one", () => {
    const three = historySentences({ succeeded: "S", cancelled: "C", failed: "F" });
    const two = historySentences({ succeeded: "S", failed: "F" });
    expect([three("SUCCEEDED"), three("CANCELLED"), three("VALIDATION_FAILED"), three("EXECUTION_FAILED"), three("DEPENDENCY_SKIPPED")]).toEqual(["S", "C", "F", "F", "F"]);
    expect([two("SUCCEEDED"), two("CANCELLED"), two("EXECUTION_FAILED")]).toEqual(["S", "F", "F"]);
  });

  it("builds the interpreter's clarification with the question as the default summary", () => {
    expect(clarificationInterpretation("¿Cuál?")).toStrictEqual({ state: "NEEDS_CLARIFICATION", summary: "¿Cuál?", drafts: [], clarifications: [{ question: "¿Cuál?" }] });
    expect(clarificationInterpretation("¿Cuál?", "Resumen")).toStrictEqual({ state: "NEEDS_CLARIFICATION", summary: "Resumen", drafts: [], clarifications: [{ question: "¿Cuál?" }] });
  });
});

describe("privacy walk over every failure taxonomy", () => {
  /**
   * Every message must be a fixed sentence. Digit runs of four or more, path-like or URL-like fragments and interpolation
   * placeholders are the signs of user data (or a provider or filesystem string) being pasted into a message.
   */
  const RULES: Array<[string, RegExp]> = [
    ["digit run of 4 or more", /\d{4,}/u],
    ["path-like fragment", /(?:[A-Za-z]:\\|\\\\|(?:^|\s)\/[\w.-]|[\w)]\/[\w.-]+\/|\.(?:exe|pdf|docx?|txt|json|lnk)\b)/u],
    ["URL-like fragment", /(?:https?:|www\.|\w+\.(?:com|org|net|io)\b)/u],
    ["interpolation placeholder", /(?:\$\{|\{\{|\{\w+\}|%[sd]|<\w+>|\bundefined\b|\bnull\b|\[object )/u]
  ];

  /** Fixed numbers that are part of the sentence itself, each with the reason it is not user data. */
  const ALLOWED_DIGIT_RUNS: Record<string, string> = {
    "MESSAGING_INVALID_PHONE": "an example number in the requested format, the same for everyone",
    "MESSAGING_INVALID_BODY": "the fixed maximum length of a message",
    "SPOTIFY_CONNECT_PORT_BUSY": "the fixed loopback port of the Spotify connection"
  };

  const taxonomies: Array<[string, Record<string, string>]> = [
    ["messaging", MESSAGING_FAILURES],
    ["spotify", SPOTIFY_FAILURES],
    ["files", FILES_FAILURES],
    ["catalog registration", Object.fromEntries([...Object.values(CATALOG_REGISTRATION_FAILURES), CATALOG_LAUNCH_FAILURE].map((entry) => [entry.code, entry.userMessage]))],
    ["weather", Object.fromEntries(Object.values(WEATHER_ERROR_CODES).map((code) => [code, weatherUserMessage(code)]))],
    ["voice capture", { ...VOICE_CAPTURE_FAILURES.messages }],
    ["elevenlabs speech", { ...ELEVENLABS_FAILURES.messages }]
  ];

  /**
   * Message tables that stay local to their module (planner, applications, file validation, history, policy, launcher, custom
   * registration) are not exported; their string values are read from the source and held to the same rules.
   */
  const LOCAL_TABLES: Array<[string, string]> = [
    ["src/main/planner/planner-validation.ts", "validationMessages"],
    ["src/main/planner/planner-service.ts", "serviceMessages"],
    ["src/main/applications/application-validation.ts", "validationMessages"],
    ["src/main/applications/application-service.ts", "serviceMessages"],
    ["src/main/applications/application-launcher.ts", "launcherMessages"],
    ["src/main/applications/custom-application-registration-service.ts", "customMessages"],
    ["src/main/files/file-validation.ts", "validationMessages"],
    ["src/main/actions/action-history-service.ts", "historyMessages"],
    ["src/main/actions/action-policy.ts", "failureMessages"]
  ];

  const localMessages = ([file, name]: [string, string]): string[] => {
    const text = readSource(file);
    const start = text.search(new RegExp(`const ${name}\\b`, "u"));
    expect(start, `${file} ${name}`).toBeGreaterThanOrEqual(0);
    const end = text.indexOf("\n};", start) >= 0 ? text.indexOf("\n};", start) : text.indexOf("} as const;", start);
    const block = text.slice(start, end);
    return [...block.matchAll(/:\s*\n?\s*"((?:[^"\\]|\\.)*)"/gu)].map((match) => match[1]!);
  };

  it("finds no digit run, path, URL or placeholder in any message of any taxonomy", () => {
    const offenders: string[] = [];
    for (const [name, table] of taxonomies) {
      for (const [code, message] of Object.entries(table)) {
        for (const [rule, pattern] of RULES) {
          if (!pattern.test(message)) continue;
          if (rule === "digit run of 4 or more" && ALLOWED_DIGIT_RUNS[code] !== undefined) continue;
          offenders.push(`${name}/${code}: ${rule}`);
        }
      }
    }
    for (const table of LOCAL_TABLES) {
      for (const message of localMessages(table)) {
        for (const [rule, pattern] of RULES) if (pattern.test(message)) offenders.push(`${table[0]}/${table[1]}: ${rule}: ${message.slice(0, 40)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads a meaningful number of messages (the walk is not vacuous)", () => {
    const exported = taxonomies.reduce((total, [, table]) => total + Object.keys(table).length, 0);
    const local = LOCAL_TABLES.reduce((total, table) => total + localMessages(table).length, 0);
    expect(exported).toBe(17 + 16 + 13 + 8 + 6 + 9 + 7);
    expect(local).toBeGreaterThan(60);
  });

  it("keeps every allowed digit run honest: each allowlisted code really contains one, and nothing else is allowlisted", () => {
    const all: Record<string, string> = { ...MESSAGING_FAILURES, ...SPOTIFY_FAILURES };
    for (const code of Object.keys(ALLOWED_DIGIT_RUNS)) expect(/\d{4,}/u.test(all[code]!), code).toBe(true);
  });

  it("detects the problems it looks for (the rules are not vacuous)", () => {
    const hit = (rule: string, text: string): boolean => RULES.find(([name]) => name === rule)![1].test(text);
    expect(hit("digit run of 4 or more", "Llama al 3001234567")).toBe(true);
    expect(hit("path-like fragment", "No se pudo abrir C:\\Users\\Ana\\x")).toBe(true);
    expect(hit("path-like fragment", "No se pudo abrir informe.pdf")).toBe(true);
    expect(hit("URL-like fragment", "Visita https://example.com")).toBe(true);
    expect(hit("interpolation placeholder", "Hola ${name}")).toBe(true);
    expect(hit("interpolation placeholder", "Hola {name}")).toBe(true);
    expect(hit("digit run of 4 or more", "Se canceló el guardado del contacto.")).toBe(false);
  });
});
