import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createSystemInfoActionExecutor } from "../src/main/actions/system-info-action-executor";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { getActionPolicy } from "../src/main/actions/action-policy";
import { getEnabledAssistantCapability } from "../src/main/actions/capability-registry";
import {
  CPU_SAMPLE_INTERVAL_MS,
  SYSTEM_INFO_ERROR_CODES,
  SYSTEM_INFO_THRESHOLDS,
  buildAdvice,
  composeSystemInfoText,
  createSystemInfoService,
  formatGigabytes,
  formatUptime,
  roundPercentage,
  systemInfoUserMessage,
  validateSystemInfoInput,
  type SystemInfoReaders
} from "../src/main/system/system-info";
import { SYSTEM_INFO_TOPICS } from "../src/shared/action-contracts";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { readSource } from "./helpers/read-source";

const GB = 1024 ** 3;

const readers = (overrides: Partial<SystemInfoReaders> = {}): SystemInfoReaders => {
  let sample = 0;
  return {
    totalMemory: () => 16 * GB,
    freeMemory: () => 4 * GB,
    cpuTimes: () => (sample++ === 0 ? { idle: 1_000, total: 2_000 } : { idle: 1_750, total: 3_000 }),
    uptimeSeconds: () => 2 * 86_400 + 3 * 3_600 + 59,
    diskUsage: async () => ({ totalBytes: 476.04 * GB, freeBytes: 245.31 * GB }),
    sleep: async () => undefined,
    ...overrides
  };
};

const ask = async (topic: string, overrides: Partial<SystemInfoReaders> = {}) => createSystemInfoService(readers(overrides)).getSystemInfo({ topic });

describe("system information: capability registration", () => {
  it("is one read-only direct risk-1 capability in its own domain", () => {
    expect(getEnabledAssistantCapability("GET_SYSTEM_INFO")).toMatchObject({ domain: "SYSTEM_INFO", approval: "DIRECT", executor: "SYSTEM_INFO", enabled: true, label: "Consultar información del equipo" });
    expect(getActionPolicy("GET_SYSTEM_INFO")).toMatchObject({ approval: "DIRECT", riskLevel: 1, availability: "IMPLEMENTED" });
    expect(getActionPolicy("GET_SYSTEM_INFO").confirmation.required).toBe(false);
  });

  it("has a closed topic list without battery", () => {
    expect([...SYSTEM_INFO_TOPICS]).toEqual(["disk", "memory", "cpu", "uptime", "summary"]);
  });
});

describe("system information: closed validator", () => {
  it.each(SYSTEM_INFO_TOPICS)("accepts the topic %s", (topic) => {
    expect(validateSystemInfoInput({ topic })).toEqual({ ok: true, data: { topic } });
  });

  it.each([
    undefined, null, "disk", 7, [], {}, { topic: "battery" }, { topic: "DISK" }, { topic: "" }, { topic: 1 }, { topic: "disk", path: "C:\\" },
    { topic: "disk", extra: true }, { path: "C:\\" }, { topic: ["disk"] }, { topic: "processes" }, { topic: "../disk" }
  ])("rejects %j", (input) => {
    expect(validateSystemInfoInput(input)).toEqual({ ok: false });
  });
});

describe("system information: formatting and rounding", () => {
  it("formats gigabytes with one decimal and a Spanish decimal comma", () => {
    expect(formatGigabytes(245.31 * GB)).toBe("245,3");
    expect(formatGigabytes(0)).toBe("0,0");
    expect(formatGigabytes(15.96 * GB)).toBe("16,0");
    expect(formatGigabytes(1.05 * GB)).toMatch(/^1,[01]$/u);
  });

  it("rounds percentages to whole numbers inside 0 to 100", () => {
    expect([roundPercentage(51.4), roundPercentage(51.5), roundPercentage(-3), roundPercentage(140), roundPercentage(0.4)]).toEqual([51, 52, 0, 100, 0]);
  });

  it("formats the uptime in at most two units", () => {
    expect(formatUptime(2 * 86_400 + 3 * 3_600 + 59)).toBe("2 días y 3 horas");
    expect(formatUptime(86_400)).toBe("1 día");
    expect(formatUptime(86_400 + 3_600)).toBe("1 día y 1 hora");
    expect(formatUptime(5 * 3_600 + 10)).toBe("5 horas");
    expect(formatUptime(40 * 60)).toBe("40 minutos");
    expect(formatUptime(60)).toBe("1 minuto");
    expect(formatUptime(20)).toBe("menos de un minuto");
    expect(formatUptime(-5)).toBe("menos de un minuto");
  });
});

describe("system information: advice thresholds", () => {
  const disk = (freePercent: number) => ({ freePercent, freeGb: "1,0", totalGb: "10,0" });
  const memory = (usedPercent: number) => ({ usedPercent, freeGb: "1,0", totalGb: "10,0" });

  it("warns about the disk only below 10 % free", () => {
    expect(SYSTEM_INFO_THRESHOLDS.diskFreePercentBelow).toBe(10);
    expect(buildAdvice({ disk: disk(8) })).toEqual(["Te queda poco espacio en el disco: 8 % libre."]);
    expect(buildAdvice({ disk: disk(10) })).toEqual([]);
    expect(buildAdvice({ disk: disk(9) })).toHaveLength(1);
  });

  it("warns about memory only above 90 % in use, and about the processor only above 90 %", () => {
    expect(buildAdvice({ memory: memory(90) })).toEqual([]);
    expect(buildAdvice({ memory: memory(93) })).toEqual(["La memoria está casi llena: 93 % en uso. Cierra alguna aplicación si notas lentitud."]);
    expect(buildAdvice({ cpu: { loadPercent: 90 } })).toEqual([]);
    expect(buildAdvice({ cpu: { loadPercent: 97 } })).toEqual(["El procesador está muy ocupado: 97 %."]);
  });

  it("gives no advice when everything is fine, and speaks the facts first", () => {
    expect(buildAdvice({ disk: disk(50), memory: memory(40), cpu: { loadPercent: 10 } })).toEqual([]);
    const text = composeSystemInfoText("disk", { disk: disk(8) });
    expect(text.split(". ")[0]).toMatch(/^Tienes /u);
    expect(text).toContain("Te queda poco espacio en el disco: 8 % libre.");
  });
});

describe("system information: the service", () => {
  it("answers each topic with rounded aggregates", async () => {
    expect(await ask("disk")).toEqual({ ok: true, data: { summary: "Tienes 245,3 GB libres de 476,0 GB en el disco (52 % libre)." } });
    expect(await ask("memory")).toEqual({ ok: true, data: { summary: "Tienes 75 % de la memoria en uso (4,0 GB libres de 16,0 GB)." } });
    expect(await ask("cpu")).toEqual({ ok: true, data: { summary: "El procesador está al 25 % de carga." } });
    expect(await ask("uptime")).toEqual({ ok: true, data: { summary: "El equipo lleva encendido 2 días y 3 horas." } });
  });

  it("summarizes everything in one sentence of facts and adds advice after it", async () => {
    const result = await ask("summary");
    expect(result).toEqual({ ok: true, data: { summary: "Así va tu equipo, disco: 245,3 GB libres de 476,0 GB; memoria: 75 % en uso; procesador: 25 % de carga; encendido hace 2 días y 3 horas." } });
    const low = await ask("summary", { diskUsage: async () => ({ totalBytes: 100 * GB, freeBytes: 8 * GB }), freeMemory: () => 1 * GB });
    expect(low.ok && low.data.summary).toMatch(/Te queda poco espacio en el disco: 8 % libre\./u);
    expect(low.ok && low.data.summary).toMatch(/La memoria está casi llena: 94 % en uso\./u);
  });

  it("takes two processor samples at least 250 ms apart", async () => {
    expect(CPU_SAMPLE_INTERVAL_MS).toBeGreaterThanOrEqual(250);
    const order: string[] = [];
    let samples = 0;
    await createSystemInfoService(readers({
      cpuTimes: () => { order.push(`sample${++samples}`); return samples === 1 ? { idle: 0, total: 100 } : { idle: 50, total: 200 }; },
      sleep: async (milliseconds) => { order.push(`sleep${milliseconds}`); }
    })).getSystemInfo({ topic: "cpu" });
    expect(order).toEqual(["sample1", `sleep${CPU_SAMPLE_INTERVAL_MS}`, "sample2"]);
  });

  it("rejects an invalid topic with the closed input failure", async () => {
    const result = await createSystemInfoService(readers()).getSystemInfo({ topic: "processes" });
    expect(result).toEqual({ ok: false, error: { code: SYSTEM_INFO_ERROR_CODES.inputInvalid, userMessage: systemInfoUserMessage(SYSTEM_INFO_ERROR_CODES.inputInvalid) } });
  });

  it("fails a single topic that cannot be measured and keeps the summary partial", async () => {
    const failingDisk = { diskUsage: async () => { throw new Error("C:\\secret path"); } };
    expect(await ask("disk", failingDisk)).toMatchObject({ ok: false, error: { code: SYSTEM_INFO_ERROR_CODES.unavailable } });
    const summary = await ask("summary", failingDisk);
    expect(summary.ok && summary.data.summary).toMatch(/memoria: 75 % en uso/u);
    expect(summary.ok && summary.data.summary).not.toMatch(/disco/u);
    expect(await ask("cpu", { cpuTimes: () => ({ idle: 5, total: 5 }) })).toMatchObject({ ok: false });
    expect(await ask("memory", { totalMemory: () => 0 })).toMatchObject({ ok: false });
    expect(await ask("uptime", { uptimeSeconds: () => Number.NaN })).toMatchObject({ ok: false });
    expect(await ask("summary", { diskUsage: async () => { throw new Error("x"); }, totalMemory: () => 0, cpuTimes: () => ({ idle: 1, total: 1 }), uptimeSeconds: () => -1 })).toMatchObject({ ok: false });
  });

  it("clamps impossible readings instead of reporting them", async () => {
    const result = await ask("disk", { diskUsage: async () => ({ totalBytes: 100 * GB, freeBytes: 150 * GB }) });
    expect(result.ok && result.data.summary).toContain("100 % libre");
    expect(await ask("disk", { diskUsage: async () => ({ totalBytes: 0, freeBytes: 0 }) })).toMatchObject({ ok: false });
  });

  it("runs against the real computer and returns a sentence with no identifiers", async () => {
    const result = await createSystemInfoService().getSystemInfo({ topic: "summary" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.summary).toMatch(/^Así va tu equipo, /u);
    expect(result.data.summary.length).toBeLessThanOrEqual(400);
    // Nothing that identifies the person or the machine: no drive letter, path separator, address or long digit run.
    expect(result.data.summary).not.toMatch(/[A-Za-z]:\\|\\|\/|\d{4,}|@|\b(?:\d{1,3}\.){3}\d{1,3}\b|([0-9a-f]{2}[:-]){5}/iu);
    const host = process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "";
    const user = process.env.USERNAME ?? process.env.USER ?? "";
    for (const identifier of [host, user].filter((value) => value.length > 3)) expect(result.data.summary.toLowerCase()).not.toContain(identifier.toLowerCase());
  }, 10_000);
});

describe("system information: no identifier can leave the module", () => {
  it("reads nothing but memory, processor totals, uptime and the drive totals", () => {
    // Comments are dropped first: they may name what the module does NOT read.
    const source = readSource("src/main/system/system-info.ts").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    for (const forbidden of ["hostname", "userInfo", "networkInterfaces", "release()", "version()", "machine()", "cpus()[", "model", "serial", "readdir", "readFile", "exec", "spawn", "child_process", "fetch(", "tasklist", "process.env"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    expect(source).not.toContain("console.");
    // The drive path is built and used inside the default reader and never returned.
    expect(source).toMatch(/diskUsage: async \(\) => \{[^}]*return \{ totalBytes/su);
  });

  it("never writes identifiers or numbers to a log when a reader fails", async () => {
    const logs: string[] = [];
    const executor = createSystemInfoActionExecutor({
      systemInfoService: { getSystemInfo: async () => { throw new Error("C:\\Users\\Someone\\secret 192.168.0.4"); } },
      logError: (message) => logs.push(message)
    });
    const outcome = await executor.execute({ actionId: "11111111-1111-4111-8111-111111111111", action: "GET_SYSTEM_INFO", input: { topic: "disk" } }, getActionPolicy("GET_SYSTEM_INFO"));
    expect(outcome).toMatchObject({ status: "EXECUTION_FAILED", errorCode: SYSTEM_INFO_ERROR_CODES.unavailable, userSummary: systemInfoUserMessage(SYSTEM_INFO_ERROR_CODES.unavailable) });
    expect(JSON.stringify([outcome, logs])).not.toMatch(/Someone|192\.168|secret|C:\\/u);
  });

  it("keeps every failure message plain Spanish with no digits, paths or placeholders", () => {
    for (const code of Object.values(SYSTEM_INFO_ERROR_CODES)) {
      const message = systemInfoUserMessage(code);
      expect(message).toMatch(/^[A-ZÁÉÍÓÚÑ¿¡]/u);
      expect(message).not.toMatch(/\d|\\|\/|https?:|\{|undefined|null/u);
    }
    expect(systemInfoUserMessage("SOMETHING_ELSE")).toBe(systemInfoUserMessage(SYSTEM_INFO_ERROR_CODES.unavailable));
  });
});

describe("system information: history and the full action path", () => {
  const flow = (service: Parameters<typeof createSystemInfoActionExecutor>[0]) => {
    const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
    const logs = vi.fn();
    let counter = 0;
    const unused = { execute: vi.fn(), prepare: vi.fn(), release: vi.fn() } as never;
    const orchestrator = createActionOrchestrator({
      executor: createActionExecutor({
        plannerExecutor: unused, applicationExecutor: unused, approvedWebExecutor: unused, filesExecutor: unused, messagingExecutor: unused, spotifyExecutor: unused, weatherExecutor: unused,
        systemInfoExecutor: createSystemInfoActionExecutor({ ...service, logError: logs })
      }),
      historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
      generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      logError: logs
    });
    return { orchestrator, recordTerminal, logs };
  };

  it("answers directly without a confirmation, with the numbers only in the answer, and stores one fixed sentence", async () => {
    const { orchestrator, recordTerminal, logs } = flow({ systemInfoService: createSystemInfoService(readers()) });
    const result = await orchestrator.propose({ action: "GET_SYSTEM_INFO", input: { topic: "summary" } });
    expect(result).toMatchObject({ ok: true, data: { status: "SUCCEEDED", action: "GET_SYSTEM_INFO", riskLevel: 1 } });
    if (!result.ok || !("userSummary" in result.data)) throw new Error("expected an outcome");
    expect(result.data.userSummary).toContain("245,3 GB");
    expect(result.data).not.toHaveProperty("data");
    expect(recordTerminal).toHaveBeenCalledTimes(1);
    const recorded = recordTerminal.mock.calls[0]![0] as { userSummary: string; metadata: unknown };
    expect(recorded.userSummary).toBe("Se consultó información del equipo.");
    expect(recorded.metadata).toEqual({ scopeKind: "SYSTEM_INFO", resultKind: "SUCCEEDED" });
    expect(JSON.stringify([recordTerminal.mock.calls, logs.mock.calls])).not.toMatch(/GB|\d{2} %|245|476|días|horas/u);
  });

  it("stores a fixed failure sentence and no detail when the measurement fails", async () => {
    const { orchestrator, recordTerminal, logs } = flow({ systemInfoService: createSystemInfoService(readers({ diskUsage: async () => { throw new Error("C:\\Users\\Someone"); } })) });
    const result = await orchestrator.propose({ action: "GET_SYSTEM_INFO", input: { topic: "disk" } });
    expect(result).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", errorCode: SYSTEM_INFO_ERROR_CODES.unavailable } });
    expect((recordTerminal.mock.calls[0]![0] as { userSummary: string }).userSummary).toBe("La consulta de información del equipo no se completó.");
    expect(JSON.stringify([recordTerminal.mock.calls, logs.mock.calls])).not.toMatch(/Someone|C:\\/u);
  });

  it("rejects a proposal with an unknown topic or extra field before anything runs", async () => {
    const { orchestrator, recordTerminal } = flow({ systemInfoService: createSystemInfoService(readers()) });
    for (const input of [{ topic: "battery" }, { topic: "disk", path: "C:\\" }, {}, { topic: "processes" }]) {
      const result = await orchestrator.propose({ action: "GET_SYSTEM_INFO", input } as never);
      expect(result.ok, JSON.stringify(input)).toBe(false);
    }
    expect(recordTerminal).not.toHaveBeenCalled();
  });
});

describe("system information: the interpreter accepts only the closed topic", () => {
  const reference = { now: "2026-09-20T15:00:00.000Z", timeZone: "America/Bogota" };
  const interpret = async (draft: Record<string, unknown>) => createAssistantInterpreter({
    getConfiguration: () => ({ apiKey: "", model: "" }),
    createProvider: () => ({ interpret: async () => JSON.stringify({ state: "READY", summary: "x", responseText: "", clarifications: [], drafts: [draft] }) }),
    now: () => new Date(reference.now), timeZone: () => reference.timeZone, logError: () => undefined
  }).interpret({ instruction: "cuánto espacio me queda" }, reference);

  it("turns the structured topic into a draft", async () => {
    expect(await interpret({ action: "GET_SYSTEM_INFO", input: null, systemInfo: { topic: "disk" } })).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "GET_SYSTEM_INFO", input: { topic: "disk" } }] } });
  });

  it("rejects an invalid topic, an extra field, a missing object and a stray systemInfo on another action", async () => {
    for (const draft of [
      { action: "GET_SYSTEM_INFO", input: null, systemInfo: { topic: "battery" } },
      { action: "GET_SYSTEM_INFO", input: null, systemInfo: { topic: "disk", path: "C:\\" } },
      { action: "GET_SYSTEM_INFO", input: null, systemInfo: null },
      { action: "GET_SYSTEM_INFO", input: "{\"topic\":\"disk\"}", systemInfo: null },
      { action: "GET_CURRENT_DATE_TIME", input: "{}", systemInfo: { topic: "disk" } }
    ]) {
      const result = await interpret(draft);
      expect(result.ok && result.data.state, JSON.stringify(draft)).not.toBe("READY");
    }
  });
});
