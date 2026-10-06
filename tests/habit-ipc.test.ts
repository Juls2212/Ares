import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
import { createHabitIpcRegistration } from "../src/main/ipc/register-habit-ipc";
import { IPC_CHANNELS, type OperationResult } from "../src/shared/contracts";
import type { HabitService } from "../src/main/habits/habit-service";

const success: OperationResult<never> = { ok: true, data: undefined as never };
const methods = ["create", "list", "update", "complete", "getDailyProgress", "getWeeklyProgress"] as const;

describe("habit IPC registration", () => {
  it("registers and delegates only the explicit habit methods", async () => {
    const handlers = new Map<string, (input: unknown) => Promise<OperationResult<unknown>>>();
    const service = Object.fromEntries(methods.map((method) => [method, vi.fn(async () => success)])) as unknown as HabitService;
    createHabitIpcRegistration({ registerHandler: (channel, handler) => handlers.set(channel, handler), getService: () => service, logError: vi.fn() })();
    const channels = Object.values(IPC_CHANNELS.habits);
    expect([...handlers.keys()]).toEqual(channels);
    for (const method of methods) {
      const channel = IPC_CHANNELS.habits[method];
      await expect(handlers.get(channel)!({})).resolves.toEqual(success);
      expect(service[method]).toHaveBeenCalledWith({});
    }
    expect(handlers.has("habits:invoke")).toBe(false);
  });

  it("maps unexpected handler failures to controlled results", async () => {
    const handlers = new Map<string, (input: unknown) => Promise<OperationResult<unknown>>>();
    const service = Object.fromEntries(methods.map((method) => [method, vi.fn(async () => success)])) as unknown as HabitService;
    vi.mocked(service.create).mockRejectedValueOnce(new Error("database-password"));
    const logError = vi.fn();
    createHabitIpcRegistration({ registerHandler: (channel, handler) => handlers.set(channel, handler), getService: () => service, logError })();
    const result = await handlers.get(IPC_CHANNELS.habits.create)!({});
    expect(result).toEqual({ ok: false, error: { code: "HABIT_IPC_UNAVAILABLE", userMessage: "No se pudo procesar la solicitud de hábitos." } });
    expect(JSON.stringify(result)).not.toContain("password");
  });
});
