import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import { createApprovedWebActionExecutor } from "../src/main/actions/approved-web-action-executor";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import { createWeatherActionExecutor } from "../src/main/actions/weather-action-executor";
import { createSystemInfoActionExecutor } from "../src/main/actions/system-info-action-executor";
import { createSystemInfoService, type SystemInfoReaders } from "../src/main/system/system-info";
import { createWeatherService } from "../src/main/weather/weather-service";
import type { ApplicationLauncher } from "../src/main/applications/application-launcher";
import type { PlannerService } from "../src/main/planner/planner-service";

/**
 * History and log privacy for the domains without their own test: planner (INTERNAL_MEMORY: tasks, events, reminders, schedule
 * queries, date/time), applications, web, the read-only weather query and the read-only computer information query.
 * Already covered elsewhere and not repeated here:
 *  - messaging: tests/messaging-actions.test.ts, messaging-storage.test.ts, whatsapp-chat-launch.test.ts
 *  - files: tests/supervised-file-actions.test.ts, supervised-file-mutation-actions.test.ts, found-file-open-voice.test.ts
 *  - music: tests/spotify-playback.test.ts, spotify-search.test.ts
 *  - custom application registration: tests/custom-application-voice-registration.test.ts
 */

const LEAK = /Cumpleaños de Sofía|Reunión con Marta|3001234567|573001234567|contraseña secreta|mi secreto|C:\\|\.exe|https?:\/\/|google\.com|youtube\.com|Cali|Bogot|latitude|3\.43|°C/iu;

const unused = { execute: vi.fn() } as never;

const flow = (options: {
  plannerService?: PlannerService;
  launcher?: ApplicationLauncher;
  openExternal?: (url: string) => Promise<void>;
  systemInfoReaders?: Partial<SystemInfoReaders>;
  weatherFetch?: Parameters<typeof createWeatherService>[0] extends infer D ? (D extends { fetch?: infer F } ? F : never) : never;
}) => {
  const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
  const logs = vi.fn();
  let counter = 0;
  const executor = createActionExecutor({
    plannerExecutor: createPlannerActionExecutor({
      plannerService: options.plannerService,
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      timeZone: () => "America/Bogota",
      logError: logs
    }),
    applicationExecutor: options.launcher ? createApplicationActionExecutor({ launcher: options.launcher, logError: logs }) : unused,
    approvedWebExecutor: options.openExternal ? createApprovedWebActionExecutor({ openExternal: options.openExternal, logError: logs }) : unused,
    filesExecutor: unused,
    messagingExecutor: unused,
    spotifyExecutor: unused,
    systemInfoExecutor: options.systemInfoReaders
      ? createSystemInfoActionExecutor({ systemInfoService: createSystemInfoService(options.systemInfoReaders), logError: logs })
      : unused,
    weatherExecutor: options.weatherFetch
      ? createWeatherActionExecutor({ weatherService: createWeatherService({ fetch: options.weatherFetch }), logError: logs })
      : unused
  });
  const orchestrator = createActionOrchestrator({
    executor,
    historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
    generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: logs
  });
  const recorded = (): string => JSON.stringify([recordTerminal.mock.calls, logs.mock.calls]);
  return { orchestrator, recordTerminal, logs, recorded };
};

const success = { ok: true as const, data: { record: {} } };
const plannerService = (overrides: Record<string, unknown> = {}): PlannerService =>
  ({
    createTask: vi.fn(async () => success),
    createReminder: vi.fn(async () => success),
    getTodaySchedule: vi.fn(async () => ({
      ok: true,
      data: {
        localDate: "2026-09-17",
        tasks: [{ title: "Cumpleaños de Sofía 3001234567", priority: "MEDIUM", status: "PENDING", dueTime: null }],
        events: [],
        reminders: []
      }
    })),
    ...overrides
  }) as unknown as PlannerService;

describe("planner (memory) history privacy", () => {
  it("records no title or number for a created task or reminder, and logs nothing", async () => {
    const run = flow({ plannerService: plannerService() });
    await run.orchestrator.propose({ action: "CREATE_TASK", input: { title: "Cumpleaños de Sofía 3001234567" } });
    await run.orchestrator.propose({ action: "CREATE_REMINDER", input: { title: "Cumpleaños de Sofía", remindAt: "2026-09-17T10:00:00Z" } });
    expect(run.recordTerminal).toHaveBeenCalledTimes(2);
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.logs).not.toHaveBeenCalled();
  });

  it("records only fixed text when the planner service fails, with a constant log line", async () => {
    const failing = plannerService({ createTask: vi.fn(async () => { throw new Error("boom: Cumpleaños de Sofía 3001234567 SELECT"); }) });
    const run = flow({ plannerService: failing });
    await run.orchestrator.propose({ action: "CREATE_TASK", input: { title: "Cumpleaños de Sofía 3001234567" } });
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recorded()).not.toMatch(/SELECT|boom/u);
    expect(run.logs.mock.calls).toEqual([["Planner action execution failed."]]);
  });

  it("keeps titles out of history metadata for a schedule query", async () => {
    const run = flow({ plannerService: plannerService() });
    await run.orchestrator.propose({ action: "GET_TODAY_SCHEDULE", input: {} });
    const metadata = JSON.stringify(run.recordTerminal.mock.calls.map((call) => (call[0] as { metadata?: unknown }).metadata));
    expect(metadata).not.toMatch(LEAK);
  });

  it("persists only a generic fixed sentence for a schedule query, with no title, time or count", async () => {
    const run = flow({ plannerService: plannerService() });
    const outcome = await run.orchestrator.propose({ action: "GET_TODAY_SCHEDULE", input: {} });
    // The person still hears and sees the real agenda text; only the persisted summary is generic.
    expect(outcome).toMatchObject({ ok: true, data: { userSummary: expect.stringContaining("Cumpleaños de Sofía") } });
    const summaries = run.recordTerminal.mock.calls.map((call) => (call[0] as { userSummary: string }).userSummary);
    expect(summaries).toEqual(["Se consultó la agenda."]);
    expect(run.recorded()).not.toMatch(LEAK);
  });

  it("hears and sees the titles and the 12-hour times of another day, while history has no title, time or count", async () => {
    const run = flow({
      plannerService: plannerService({
        getTodaySchedule: vi.fn(async () => ({
          ok: true,
          data: {
            localDate: "2026-09-18",
            tasks: [{ title: "Pagar la luz de Sofía", priority: "MEDIUM", status: "PENDING", dueTime: "17:30" }],
            events: [{ title: "Reunión con Marta", startAt: "2026-09-18T14:00:00.000Z" }],
            reminders: [{ title: "Llamar al banco", remindAt: "2026-09-18T22:00:00.000Z" }]
          }
        }))
      })
    });
    const result = await run.orchestrator.propose({ action: "GET_TODAY_SCHEDULE", input: { date: "2026-09-18" } });
    const text = (result as { data: { userSummary: string } }).data.userSummary;
    expect(text).toContain("Reunión con Marta");
    expect(text).toContain("a las 9 de la mañana");
    expect(text).toContain("a las 5 y media de la tarde");
    expect(text).toContain("un recordatorio a las 5 de la tarde");
    const persisted = JSON.stringify(run.recordTerminal.mock.calls);
    expect(persisted).toContain("Se consultó la agenda.");
    expect(persisted).not.toMatch(/Marta|Sofía|banco|luz|de la tarde|de la mañana|17:30|09:00|cosas|3 /u);
    expect(run.logs).not.toHaveBeenCalled();
  });

  it("persists a generic sentence for every planner action and for failures, never the outcome text", async () => {
    const titled = { ...success, data: { record: { title: "Reunión con Marta 3001234567" } } };
    const run = flow({
      plannerService: plannerService({
        createTask: vi.fn(async () => titled),
        updateTask: vi.fn(async () => titled),
        completeTask: vi.fn(async () => titled),
        createEvent: vi.fn(async () => titled),
        updateEvent: vi.fn(async () => titled),
        createReminder: vi.fn(async () => titled),
        getWeekSchedule: vi.fn(async () => ({ ok: true, data: { weekStart: "2026-09-14", weekEnd: "2026-09-20", tasks: [{ title: "Reunión con Marta" }], events: [], reminders: [] } }))
      })
    });
    const id = "550e8400-e29b-41d4-a716-446655440000";
    for (const submission of [
      { action: "CREATE_TASK", input: { title: "Reunión con Marta 3001234567" } },
      { action: "UPDATE_TASK", input: { taskId: id, title: "Reunión con Marta" } },
      { action: "COMPLETE_TASK", input: { taskId: id } },
      { action: "CREATE_EVENT", input: { title: "Reunión con Marta", startAt: "2026-09-17T10:00:00Z" } },
      { action: "UPDATE_EVENT", input: { eventId: id, title: "Reunión con Marta" } },
      { action: "CREATE_REMINDER", input: { title: "Reunión con Marta", remindAt: "2026-09-17T10:00:00Z" } },
      { action: "GET_WEEK_SCHEDULE", input: {} },
      { action: "GET_CURRENT_DATE_TIME", input: {} }
    ]) await run.orchestrator.propose(submission);
    const summaries = run.recordTerminal.mock.calls.map((call) => (call[0] as { userSummary: string }).userSummary);
    expect(summaries).toEqual([
      "Se creó una tarea.", "Se actualizó una tarea.", "Se completó una tarea.", "Se creó un evento.",
      "Se actualizó un evento.", "Se creó un recordatorio.", "Se consultó la agenda de la semana.", "Se consultó la fecha y la hora."
    ]);
    for (const summary of summaries) expect(summary).not.toMatch(/\d/u);
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.logs).not.toHaveBeenCalled();
  });
});

describe("weather history privacy", () => {
  const providerFetch = (calls: string[] = []) => vi.fn(async (url: string) => {
    calls.push(url);
    const body = url.includes("geocoding-api")
      ? { results: [{ name: "Cali", country_code: "CO", latitude: 3.4372, longitude: -76.5225, timezone: "America/Bogota" }] }
      : {
          current: { temperature_2m: 24, apparent_temperature: 26, weather_code: 2 },
          daily: { weather_code: [2, 61], temperature_2m_min: [19, 18], temperature_2m_max: [29, 27], precipitation_probability_max: [30, 70] }
        };
    return { ok: true, text: async () => JSON.stringify(body) };
  });

  it("answers the person with the place and numbers, but persists and logs only a generic sentence", async () => {
    const run = flow({ weatherFetch: providerFetch() as never });
    const outcome = await run.orchestrator.propose({ action: "GET_WEATHER", input: { location: "Cali" } });
    expect(outcome).toMatchObject({ ok: true, data: { status: "SUCCEEDED", userSummary: expect.stringMatching(/Cali.*24 grados/u) } });
    expect(run.recordTerminal).toHaveBeenCalledOnce();
    expect(run.recordTerminal.mock.calls[0]?.[0]).toMatchObject({
      action: "GET_WEATHER",
      status: "SUCCEEDED",
      userSummary: "Se respondió una consulta del clima."
    });
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recorded()).not.toMatch(/\d+(?:[.,]\d+)? ?(?:°|%)/u);
    expect(run.logs).not.toHaveBeenCalled();
  });

  it("persists a generic failure sentence, with no place, when the place is unknown or the provider fails", async () => {
    const unknown = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify({}) }));
    const failing = flow({ weatherFetch: unknown as never });
    const outcome = await failing.orchestrator.propose({ action: "GET_WEATHER", input: { location: "Cali" } });
    expect(outcome).toMatchObject({ ok: true, data: { status: "VALIDATION_FAILED", errorCode: "WEATHER_LOCATION_NOT_FOUND" } });
    expect(failing.recordTerminal.mock.calls[0]?.[0]).toMatchObject({ userSummary: "La consulta del clima no se completó.", errorCode: "WEATHER_LOCATION_NOT_FOUND" });
    expect(failing.recorded()).not.toMatch(LEAK);

    const down = flow({ weatherFetch: (async () => { throw new Error("private Cali 3.43"); }) as never });
    await down.orchestrator.propose({ action: "GET_WEATHER", input: { location: "Cali" } });
    expect(down.recorded()).not.toMatch(LEAK);
    expect(down.recorded()).not.toMatch(/private/u);
  });

  it("needs no confirmation, makes at most the two bounded provider requests, and rejects invalid input before any request", async () => {
    const calls: string[] = [];
    const run = flow({ weatherFetch: providerFetch(calls) as never });
    const outcome = await run.orchestrator.propose({ action: "GET_WEATHER", input: { location: "Cali", dayOffset: 1 } });
    expect(outcome).toMatchObject({ ok: true, data: { status: "SUCCEEDED", riskLevel: 1 } });
    expect(calls).toHaveLength(2);
    for (const url of calls) expect(new URL(url).host).toMatch(/^(?:geocoding-api|api)\.open-meteo\.com$/u);

    for (const input of [{ location: "https://evil.example" }, { dayOffset: 99 }, { location: "Cali", extra: 1 }, "Cali"]) {
      await expect(run.orchestrator.propose({ action: "GET_WEATHER", input }), JSON.stringify(input)).resolves.toMatchObject({ ok: false });
    }
    expect(calls).toHaveLength(2);
  });
});

describe("applications history privacy", () => {
  const launcher = (result: unknown): ApplicationLauncher =>
    ({ launchByAlias: vi.fn(async () => result), launchResolvedTarget: vi.fn() }) as unknown as ApplicationLauncher;

  it("records the public application name only, never the typed alias, a path or an executable", async () => {
    const run = flow({ launcher: launcher({ ok: true, data: { applicationName: "Microsoft Word" } }) });
    await run.orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "Mi Secreto" } });
    expect(run.recordTerminal).toHaveBeenCalledOnce();
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recorded()).toContain("Microsoft Word");
  });

  it("records only the fixed failure text, with no alias, path or raw error", async () => {
    const run = flow({
      launcher: launcher({ ok: false, error: { code: "APPLICATION_LAUNCH_FAILED", userMessage: "No se pudo abrir la aplicación." } })
    });
    await run.orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "Mi Secreto" } });
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recordTerminal.mock.calls[0]?.[0]).toMatchObject({ status: "EXECUTION_FAILED", errorCode: "APPLICATION_LAUNCH_FAILED" });
  });

  it("contains a launcher that throws a message with a path, logging only a constant", async () => {
    const throwing = { launchByAlias: vi.fn(async () => { throw new Error("spawn C:\\Users\\Ana\\secreto.exe ENOENT"); }), launchResolvedTarget: vi.fn() } as unknown as ApplicationLauncher;
    const run = flow({ launcher: throwing });
    await run.orchestrator.propose({ action: "OPEN_APPLICATION", input: { alias: "Mi Secreto" } });
    expect(run.recorded()).not.toMatch(/C:\\|\.exe|ENOENT|mi secreto/iu);
    for (const call of run.logs.mock.calls) expect(typeof call[0]).toBe("string");
  });
});

describe("web history privacy", () => {
  it("records no query and no URL for an approved-site search, and opens the URL only through the wrapper", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const run = flow({ openExternal });
    await run.orchestrator.propose({ action: "SEARCH_APPROVED_SITE", input: { site: "GOOGLE", query: "mi contraseña secreta 3001234567" } });
    expect(openExternal).toHaveBeenCalledOnce();
    expect(String(openExternal.mock.calls[0]?.[0])).toContain("https://www.google.com/search");
    expect(run.recorded()).not.toMatch(LEAK);
    expect(run.recorded()).toContain("Google");
  });

  it("records no URL for opening an approved page", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const run = flow({ openExternal });
    await run.orchestrator.propose({ action: "OPEN_APPROVED_PAGE", input: { site: "YOUTUBE" } });
    expect(run.recorded()).not.toMatch(LEAK);
  });

  it("records only fixed text when opening fails, never the query or the URL", async () => {
    const openExternal = vi.fn(async () => { throw new Error("failed https://www.google.com/search?q=mi+contraseña+secreta"); });
    const run = flow({ openExternal });
    await run.orchestrator.propose({ action: "SEARCH_APPROVED_SITE", input: { site: "GOOGLE", query: "mi contraseña secreta" } });
    expect(run.recorded()).not.toMatch(LEAK);
  });
});

describe("computer information history privacy", () => {
  const GB = 1024 ** 3;
  const readers = (overrides: Partial<SystemInfoReaders> = {}): Partial<SystemInfoReaders> => ({
    totalMemory: () => 16 * GB,
    freeMemory: () => 1 * GB,
    cpuTimes: (() => { let sample = 0; return () => (sample++ === 0 ? { idle: 0, total: 100 } : { idle: 5, total: 200 }); })(),
    uptimeSeconds: () => 3 * 86_400 + 7 * 3_600,
    diskUsage: async () => ({ totalBytes: 476.04 * GB, freeBytes: 38.1 * GB }),
    sleep: async () => undefined,
    ...overrides
  });
  const NUMBERS = /GB|\d{2,3} ?%|476|38,1|días|horas|C:\\|Someone/u;

  it("answers with the real numbers but stores only one fixed sentence and a category", async () => {
    const run = flow({ systemInfoReaders: readers() });
    const outcome = await run.orchestrator.propose({ action: "GET_SYSTEM_INFO", input: { topic: "summary" } });
    expect(outcome).toMatchObject({ ok: true, data: { status: "SUCCEEDED", userSummary: expect.stringContaining("38,1 GB") } });
    expect(run.recordTerminal.mock.calls[0]?.[0]).toMatchObject({
      userSummary: "Se consultó información del equipo.",
      metadata: { scopeKind: "SYSTEM_INFO", resultKind: "SUCCEEDED" }
    });
    expect(run.recorded()).not.toMatch(NUMBERS);
  });

  it("stores a fixed sentence and no detail when a reader fails with private text", async () => {
    const run = flow({ systemInfoReaders: readers({ diskUsage: async () => { throw new Error("C:\\Users\\Someone\\private"); } }) });
    const outcome = await run.orchestrator.propose({ action: "GET_SYSTEM_INFO", input: { topic: "disk" } });
    expect(outcome).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", errorCode: "SYSTEM_INFO_UNAVAILABLE" } });
    expect(run.recordTerminal.mock.calls[0]?.[0]).toMatchObject({ userSummary: "La consulta de información del equipo no se completó." });
    expect(run.recorded()).not.toMatch(NUMBERS);
  });
});
