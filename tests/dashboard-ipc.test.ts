import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createDashboardIpcRegistration,
  type DashboardIpcHandler,
  type DashboardIpcHandlerRegistrar
} from "../src/main/ipc/register-dashboard-ipc";
import { IPC_CHANNELS } from "../src/shared/contracts";
import type { DashboardService } from "../src/main/dashboard/dashboard-service";

describe("dashboard IPC registration", () => {
  it("registers only the dashboard summary channel once and delegates to the singleton service", async () => {
    const handlers = new Map<string, DashboardIpcHandler>();
    const getTodaySummary = vi.fn(async () => ({ ok: true as const, data: { safe: true } }));
    const register = createDashboardIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ getTodaySummary } as unknown as DashboardService),
      logError: vi.fn()
    });

    register();
    register();
    expect(IPC_CHANNELS.dashboard).toEqual({ getTodaySummary: "dashboard:get-today-summary" });
    expect([...handlers.keys()]).toEqual(["dashboard:get-today-summary"]);
    await expect(handlers.get(IPC_CHANNELS.dashboard.getTodaySummary)?.()).resolves.toEqual({ ok: true, data: { safe: true } });
    expect(getTodaySummary).toHaveBeenCalledTimes(1);
  });

  it("maps unexpected handler failures to a controlled result", async () => {
    const handlers = new Map<string, DashboardIpcHandler>();
    const secret = "database password should not leak";
    const logError = vi.fn();
    createDashboardIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => ({ getTodaySummary: vi.fn(async () => { throw new Error(secret); }) } as unknown as DashboardService),
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.dashboard.getTodaySummary)?.();
    expect(result).toEqual({ ok: false, error: { code: "DASHBOARD_IPC_UNAVAILABLE", userMessage: "No se pudo cargar el resumen de inicio." } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Dashboard IPC handler failed.");
  });
});
