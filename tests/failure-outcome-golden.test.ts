import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createSpotifyActionExecutor } from "../src/main/actions/spotify-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import {
  CATALOG_LAUNCH_FAILURE,
  CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES,
  CATALOG_REGISTRATION_FAILURES,
  catalogRegistrationFailure
} from "../src/main/applications/catalog-registration-failures";
import {
  FILES_EXECUTION_FAILURE_CODES,
  FILES_FAILURES,
  filesFailure,
  filesSuccess
} from "../src/main/files/supervised-file-failures";
import {
  MESSAGING_EXECUTION_FAILURE_CODES,
  MESSAGING_FAILURES,
  messagingFailure,
  messagingSuccess
} from "../src/main/messaging/messaging-failures";
import {
  SPOTIFY_EXECUTION_FAILURE_CODES,
  SPOTIFY_FAILURES,
  spotifyFailure,
  spotifySuccess
} from "../src/main/spotify/spotify-failures";
import { ELEVENLABS_FAILURES } from "../src/main/voice/elevenlabs-speech-provider";
import { WEATHER_ERROR_CODES, weatherUserMessage } from "../src/main/weather/weather-service";
import { ACTION_ERROR_CODES } from "../src/shared/action-contracts";
import { PLANNER_ERROR_CODES } from "../src/shared/planner-contracts";

/**
 * Golden tables for the closed failure taxonomies, the failure and success builders and the generic history sentences, recorded
 * from the code as it was BEFORE the shared failure and outcome kits (Refactor 4.2) and kept in
 * tests/golden/failure-outcome-golden.json. Messages are exact Spanish strings: a byte of difference fails. Set
 * ARES_GOLDEN_WRITE=1 only to re-record deliberately.
 */

const GOLDEN_PATH = path.resolve(process.cwd(), "tests/golden/failure-outcome-golden.json");
const ID = "11111111-1111-4111-8111-111111111111";

const historySentences = async (): Promise<Record<string, Record<string, string>>> => {
  const submissions: Record<string, unknown> = {
    SEARCH_FILES: { action: "SEARCH_FILES", input: { query: "informe" } },
    LIST_CONTACTS: { action: "LIST_CONTACTS", input: {} },
    PAUSE_SPOTIFY: { action: "PAUSE_SPOTIFY", input: {} },
    SEARCH_SPOTIFY_APP: { action: "SEARCH_SPOTIFY_APP", input: { query: "Natalia" } },
    GET_CURRENT_DATE_TIME: { action: "GET_CURRENT_DATE_TIME", input: {} },
    CREATE_TASK: { action: "CREATE_TASK", input: { title: "Informe" } },
    GET_WEATHER: { action: "GET_WEATHER", input: {} },
    OPEN_APPLICATION: { action: "OPEN_APPLICATION", input: { alias: "word" } }
  };
  const out: Record<string, Record<string, string>> = {};
  for (const [action, submission] of Object.entries(submissions)) {
    out[action] = {};
    for (const status of ["SUCCEEDED", "VALIDATION_FAILED", "EXECUTION_FAILED", "CANCELLED"] as const) {
      const recorded: string[] = [];
      const orchestrator = createActionOrchestrator({
        executor: {
          execute: vi.fn(async (proposal: { actionId: string; action: string }) => ({
            actionId: proposal.actionId,
            action: proposal.action,
            riskLevel: 1,
            status,
            userSummary: "raw outcome text with a private title"
          }))
        } as never,
        historyService: { recordTerminal: vi.fn(async (input: { userSummary: string }) => { recorded.push(input.userSummary); return { ok: true as const, data: {} as never }; }), list: vi.fn() } as unknown as ActionHistoryService,
        generateIdentifier: () => ID,
        now: () => new Date("2026-09-17T10:00:00.000Z"),
        logError: vi.fn()
      });
      await orchestrator.propose(submission);
      out[action][status] = recorded[0] ?? "[none]";
    }
  }
  return out;
};

const spotifyExecutorOutcomes = async (): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = {};
  for (const code of Object.keys(SPOTIFY_FAILURES) as Array<keyof typeof SPOTIFY_FAILURES>) {
    const executor = createSpotifyActionExecutor({
      auth: { connect: async () => spotifyFailure(code), disconnect: async () => undefined, getStatus: async () => ({ configured: true, connected: false }) } as never,
      logError: vi.fn()
    });
    out[code] = await executor.execute({ actionId: ID, action: "CONNECT_SPOTIFY", input: {} }, { riskLevel: 2 } as never);
  }
  const ok = createSpotifyActionExecutor({ auth: { connect: async () => spotifySuccess({}), disconnect: async () => undefined, getStatus: async () => ({ configured: true, connected: true }) } as never, logError: vi.fn() });
  out.SUCCESS_STATUS = await ok.execute({ actionId: ID, action: "GET_SPOTIFY_STATUS", input: {} }, { riskLevel: 1 } as never);
  const throwing = createSpotifyActionExecutor({ auth: { connect: async () => { throw new Error("private"); } } as never, logError: vi.fn() });
  out.THROWN = await throwing.execute({ actionId: ID, action: "CONNECT_SPOTIFY", input: {} }, { riskLevel: 2 } as never);
  return out;
};

const record = async (): Promise<Record<string, unknown>> => ({
  messagingTable: MESSAGING_FAILURES,
  spotifyTable: SPOTIFY_FAILURES,
  filesTable: FILES_FAILURES,
  catalogRegistrationTable: CATALOG_REGISTRATION_FAILURES,
  catalogLaunchFailure: CATALOG_LAUNCH_FAILURE,
  weatherTable: Object.fromEntries(Object.values(WEATHER_ERROR_CODES).map((code) => [code, weatherUserMessage(code)])),
  elevenLabsTable: ELEVENLABS_FAILURES.messages,
  plannerCodes: PLANNER_ERROR_CODES,
  actionErrorCodes: ACTION_ERROR_CODES,
  executionCodes: {
    messaging: MESSAGING_EXECUTION_FAILURE_CODES,
    spotify: SPOTIFY_EXECUTION_FAILURE_CODES,
    files: FILES_EXECUTION_FAILURE_CODES,
    catalog: CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES
  },
  messagingBuilders: {
    failures: Object.keys(MESSAGING_FAILURES).map((code) => messagingFailure(code as never)),
    success: messagingSuccess({ value: 1 })
  },
  spotifyBuilders: {
    failures: Object.keys(SPOTIFY_FAILURES).map((code) => spotifyFailure(code as never)),
    success: spotifySuccess({ value: 1 })
  },
  filesBuilders: {
    failures: Object.keys(FILES_FAILURES).map((code) => filesFailure(code as never)),
    withCounts: filesFailure("FILES_PARTIAL_COMPLETION", { moved: 2, failed: 1 }),
    success: filesSuccess({ value: 1 })
  },
  catalogBuilders: Object.keys(CATALOG_REGISTRATION_FAILURES).map((category) => catalogRegistrationFailure(category as never)),
  historySentences: await historySentences(),
  spotifyExecutorOutcomes: await spotifyExecutorOutcomes()
});

if (process.env.ARES_GOLDEN_WRITE === "1") {
  mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, `${JSON.stringify(await record(), null, 1)}\n`);
}

const golden = existsSync(GOLDEN_PATH) ? (JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, unknown>) : {};
/** Normalizes values to their JSON form so comparisons ignore `undefined` fields the same way the recording did. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("failure taxonomies, builders and history sentences (golden)", () => {
  it("has a recorded golden entry for every section", () => {
    expect(Object.keys(golden).sort()).toEqual([
      "actionErrorCodes", "catalogBuilders", "catalogLaunchFailure", "catalogRegistrationTable", "elevenLabsTable", "executionCodes", "filesBuilders",
      "filesTable", "historySentences", "messagingBuilders", "messagingTable", "plannerCodes", "spotifyBuilders", "spotifyExecutorOutcomes",
      "spotifyTable", "weatherTable"
    ]);
  });

  it("keeps every code to message table byte-identical", () => {
    expect(asJson(MESSAGING_FAILURES)).toEqual(golden.messagingTable);
    expect(asJson(SPOTIFY_FAILURES)).toEqual(golden.spotifyTable);
    expect(asJson(FILES_FAILURES)).toEqual(golden.filesTable);
    expect(asJson(CATALOG_REGISTRATION_FAILURES)).toEqual(golden.catalogRegistrationTable);
    expect(asJson(CATALOG_LAUNCH_FAILURE)).toEqual(golden.catalogLaunchFailure);
    expect(asJson(Object.fromEntries(Object.values(WEATHER_ERROR_CODES).map((code) => [code, weatherUserMessage(code)])))).toEqual(golden.weatherTable);
    expect(asJson(ELEVENLABS_FAILURES.messages)).toEqual(golden.elevenLabsTable);
    expect(asJson(PLANNER_ERROR_CODES)).toEqual(golden.plannerCodes);
    expect(asJson(ACTION_ERROR_CODES)).toEqual(golden.actionErrorCodes);
    expect(asJson({
      messaging: MESSAGING_EXECUTION_FAILURE_CODES, spotify: SPOTIFY_EXECUTION_FAILURE_CODES, files: FILES_EXECUTION_FAILURE_CODES,
      catalog: CATALOG_REGISTRATION_EXECUTION_FAILURE_CODES
    })).toEqual(golden.executionCodes);
  });

  it("keeps the failure and success builders' output shapes", () => {
    expect(asJson({
      failures: Object.keys(MESSAGING_FAILURES).map((code) => messagingFailure(code as never)), success: messagingSuccess({ value: 1 })
    })).toEqual(golden.messagingBuilders);
    expect(asJson({
      failures: Object.keys(SPOTIFY_FAILURES).map((code) => spotifyFailure(code as never)), success: spotifySuccess({ value: 1 })
    })).toEqual(golden.spotifyBuilders);
    expect(asJson({
      failures: Object.keys(FILES_FAILURES).map((code) => filesFailure(code as never)),
      withCounts: filesFailure("FILES_PARTIAL_COMPLETION", { moved: 2, failed: 1 }),
      success: filesSuccess({ value: 1 })
    })).toEqual(golden.filesBuilders);
    expect(asJson(Object.keys(CATALOG_REGISTRATION_FAILURES).map((category) => catalogRegistrationFailure(category as never)))).toEqual(golden.catalogBuilders);
  });

  it("keeps the generic history sentence of every domain and status", async () => {
    expect(await historySentences()).toEqual(golden.historySentences);
  });

  it("keeps the Spotify executor's outcome shape and status mapping for every code", async () => {
    expect(asJson(await spotifyExecutorOutcomes())).toEqual(golden.spotifyExecutorOutcomes);
  });

  it("is big enough to mean something", () => {
    const tables = [MESSAGING_FAILURES, SPOTIFY_FAILURES, FILES_FAILURES, CATALOG_REGISTRATION_FAILURES];
    expect(tables.reduce((total, table) => total + Object.keys(table).length, 0)).toBe(17 + 16 + 13 + 7);
  });
});
