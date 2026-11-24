import { cpus as osCpus, freemem as osFreemem, homedir, totalmem as osTotalmem, uptime as osUptime } from "node:os";
import { statfs as fsStatfs } from "node:fs/promises";
import { parse } from "node:path";
import { SYSTEM_INFO_TOPICS, type GetSystemInfoInput, type SystemInfoTopic } from "../../shared/action-contracts";
import type { OperationResult } from "../../shared/contracts";

/**
 * Read-only computer information. Only rounded aggregates ever leave this module: gigabytes with one decimal, whole percentages
 * and hours or days. It never reads or returns process lists, file names, user names, host names, addresses, serial numbers,
 * installed software or paths. The system drive is located and measured inside Main and its path is never returned.
 */

export const SYSTEM_INFO_ERROR_CODES = {
  inputInvalid: "SYSTEM_INFO_INPUT_INVALID",
  unavailable: "SYSTEM_INFO_UNAVAILABLE"
} as const;

export type SystemInfoErrorCode = (typeof SYSTEM_INFO_ERROR_CODES)[keyof typeof SYSTEM_INFO_ERROR_CODES];

const MESSAGES: Record<SystemInfoErrorCode, string> = {
  SYSTEM_INFO_INPUT_INVALID: "No entendí qué información del equipo quieres. Puedes pedir el disco, la memoria, el procesador o el tiempo encendido.",
  SYSTEM_INFO_UNAVAILABLE: "No pude consultar la información del equipo ahora. Inténtalo de nuevo en un momento."
};

export const systemInfoUserMessage = (code: string): string =>
  (MESSAGES as Record<string, string>)[code] ?? MESSAGES.SYSTEM_INFO_UNAVAILABLE;

/** Closed validator: exactly one key, `topic`, from the closed list. Anything else is rejected. */
export const validateSystemInfoInput = (input: unknown): { ok: true; data: GetSystemInfoInput } | { ok: false } => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false };
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "topic") return { ok: false };
  const topic = record.topic;
  return typeof topic === "string" && (SYSTEM_INFO_TOPICS as readonly string[]).includes(topic)
    ? { ok: true, data: { topic: topic as SystemInfoTopic } }
    : { ok: false };
};

/** The thresholds of the advice layer. Simple on purpose: each one is a single comparison on a rounded percentage. */
export const SYSTEM_INFO_THRESHOLDS = {
  /** Advice when the free share of the system drive is below this percentage. */
  diskFreePercentBelow: 10,
  /** Advice when the used share of memory is above this percentage. */
  memoryUsedPercentAbove: 90,
  /** Advice when the measured processor load is above this percentage. */
  cpuLoadPercentAbove: 90
} as const;

/** Two processor samples are taken at least this far apart. */
export const CPU_SAMPLE_INTERVAL_MS = 300;

export type CpuTimesSample = { idle: number; total: number };
export type DiskUsage = { totalBytes: number; freeBytes: number };

export type SystemInfoReaders = {
  totalMemory: () => number;
  freeMemory: () => number;
  /** Aggregated idle and total ticks across all cores; no per-core detail. */
  cpuTimes: () => CpuTimesSample;
  uptimeSeconds: () => number;
  diskUsage: () => Promise<DiskUsage>;
  sleep: (milliseconds: number) => Promise<void>;
};

const GIGABYTE = 1024 ** 3;

/** «245,3»: one decimal with the Spanish decimal comma. */
export const formatGigabytes = (bytes: number): string => (Math.round((bytes / GIGABYTE) * 10) / 10).toFixed(1).replace(".", ",");

export const roundPercentage = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

/** «2 días y 3 horas», «5 horas», «40 minutos» or «menos de un minuto»; rounded down, never more than two units. */
export const formatUptime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const unit = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
  if (days > 0) return hours > 0 ? `${unit(days, "día", "días")} y ${unit(hours, "hora", "horas")}` : unit(days, "día", "días");
  if (hours > 0) return unit(hours, "hora", "horas");
  if (minutes > 0) return unit(minutes, "minuto", "minutos");
  return "menos de un minuto";
};

type Measurements = {
  disk?: { freePercent: number; freeGb: string; totalGb: string };
  memory?: { usedPercent: number; freeGb: string; totalGb: string };
  cpu?: { loadPercent: number };
  uptime?: { text: string };
};

/** Deterministic advice, spoken in natural Spanish. Only the rounded percentage appears, never a raw number. */
export const buildAdvice = (measurements: Measurements): string[] => {
  const advice: string[] = [];
  const { disk, memory, cpu } = measurements;
  if (disk && disk.freePercent < SYSTEM_INFO_THRESHOLDS.diskFreePercentBelow) {
    advice.push(`Te queda poco espacio en el disco: ${disk.freePercent} % libre.`);
  }
  if (memory && memory.usedPercent > SYSTEM_INFO_THRESHOLDS.memoryUsedPercentAbove) {
    advice.push(`La memoria está casi llena: ${memory.usedPercent} % en uso. Cierra alguna aplicación si notas lentitud.`);
  }
  if (cpu && cpu.loadPercent > SYSTEM_INFO_THRESHOLDS.cpuLoadPercentAbove) {
    advice.push(`El procesador está muy ocupado: ${cpu.loadPercent} %.`);
  }
  return advice;
};

const diskText = (disk: NonNullable<Measurements["disk"]>): string =>
  `${disk.freeGb} GB libres de ${disk.totalGb} GB en el disco (${disk.freePercent} % libre)`;
const memoryText = (memory: NonNullable<Measurements["memory"]>): string =>
  `${memory.usedPercent} % de la memoria en uso (${memory.freeGb} GB libres de ${memory.totalGb} GB)`;

/** One flowing sentence per topic, then the advice sentences. The summary is a single sentence of facts so speech keeps the advice. */
export const composeSystemInfoText = (topic: SystemInfoTopic, measurements: Measurements): string => {
  const { disk, memory, cpu, uptime } = measurements;
  let facts: string;
  switch (topic) {
    case "disk": facts = `Tienes ${diskText(disk!)}.`; break;
    case "memory": facts = `Tienes ${memoryText(memory!)}.`; break;
    case "cpu": facts = `El procesador está al ${cpu!.loadPercent} % de carga.`; break;
    case "uptime": facts = `El equipo lleva encendido ${uptime!.text}.`; break;
    default: {
      const parts = [
        disk ? `disco: ${disk.freeGb} GB libres de ${disk.totalGb} GB` : undefined,
        memory ? `memoria: ${memory.usedPercent} % en uso` : undefined,
        cpu ? `procesador: ${cpu.loadPercent} % de carga` : undefined,
        uptime ? `encendido hace ${uptime.text}` : undefined
      ].filter((part): part is string => part !== undefined);
      facts = `Así va tu equipo, ${parts.join("; ")}.`;
    }
  }
  return [facts, ...buildAdvice(measurements)].join(" ");
};

export type SystemInfoService = {
  getSystemInfo: (input: unknown) => Promise<OperationResult<{ summary: string }>>;
};

const failure = (code: SystemInfoErrorCode): OperationResult<{ summary: string }> => ({
  ok: false,
  error: { code, userMessage: systemInfoUserMessage(code) }
});

export const defaultSystemInfoReaders = (): SystemInfoReaders => ({
  totalMemory: () => osTotalmem(),
  freeMemory: () => osFreemem(),
  cpuTimes: () => {
    let idle = 0;
    let total = 0;
    for (const core of osCpus()) {
      const { user, nice, sys, idle: coreIdle, irq } = core.times;
      idle += coreIdle;
      total += user + nice + sys + coreIdle + irq;
    }
    return { idle, total };
  },
  uptimeSeconds: () => osUptime(),
  diskUsage: async () => {
    // The system drive is the root of the home folder; the path stays inside this function.
    const stats = await fsStatfs(parse(homedir()).root);
    return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
  },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
});

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

export const createSystemInfoService = (overrides: Partial<SystemInfoReaders> = {}): SystemInfoService => {
  const readers: SystemInfoReaders = { ...defaultSystemInfoReaders(), ...overrides };

  const measureDisk = async (): Promise<Measurements["disk"]> => {
    const usage = await readers.diskUsage();
    if (!isFinitePositive(usage.totalBytes) || !Number.isFinite(usage.freeBytes) || usage.freeBytes < 0) return undefined;
    const free = Math.min(usage.freeBytes, usage.totalBytes);
    return { freePercent: roundPercentage((free / usage.totalBytes) * 100), freeGb: formatGigabytes(free), totalGb: formatGigabytes(usage.totalBytes) };
  };
  const measureMemory = (): Measurements["memory"] => {
    const total = readers.totalMemory();
    const free = readers.freeMemory();
    if (!isFinitePositive(total) || !Number.isFinite(free) || free < 0) return undefined;
    const clampedFree = Math.min(free, total);
    return { usedPercent: roundPercentage(((total - clampedFree) / total) * 100), freeGb: formatGigabytes(clampedFree), totalGb: formatGigabytes(total) };
  };
  const measureCpu = async (): Promise<Measurements["cpu"]> => {
    const first = readers.cpuTimes();
    await readers.sleep(CPU_SAMPLE_INTERVAL_MS);
    const second = readers.cpuTimes();
    const totalDelta = second.total - first.total;
    const idleDelta = second.idle - first.idle;
    if (!(totalDelta > 0) || idleDelta < 0) return undefined;
    return { loadPercent: roundPercentage((1 - idleDelta / totalDelta) * 100) };
  };
  const measureUptime = (): Measurements["uptime"] => {
    const seconds = readers.uptimeSeconds();
    return Number.isFinite(seconds) && seconds >= 0 ? { text: formatUptime(seconds) } : undefined;
  };

  /** Runs one measurement; a failure leaves it undefined instead of failing the whole summary. */
  const attempt = async <T>(measure: () => T | Promise<T>): Promise<T | undefined> => {
    try { return await measure(); } catch { return undefined; }
  };

  return {
    async getSystemInfo(input) {
      const validated = validateSystemInfoInput(input);
      if (!validated.ok) return failure(SYSTEM_INFO_ERROR_CODES.inputInvalid);
      const { topic } = validated.data;
      const wants = (name: Exclude<SystemInfoTopic, "summary">): boolean => topic === "summary" || topic === name;
      const measurements: Measurements = {};
      const [disk, cpu] = await Promise.all([
        wants("disk") ? attempt(measureDisk) : undefined,
        wants("cpu") ? attempt(measureCpu) : undefined
      ]);
      if (disk) measurements.disk = disk;
      if (cpu) measurements.cpu = cpu;
      if (wants("memory")) { const memory = await attempt(measureMemory); if (memory) measurements.memory = memory; }
      if (wants("uptime")) { const uptime = await attempt(measureUptime); if (uptime) measurements.uptime = uptime; }
      // A single topic needs its own measurement; a summary needs at least one.
      if (topic === "summary" ? Object.keys(measurements).length === 0 : measurements[topic] === undefined) {
        return failure(SYSTEM_INFO_ERROR_CODES.unavailable);
      }
      return { ok: true, data: { summary: composeSystemInfoText(topic, measurements) } };
    }
  };
};
