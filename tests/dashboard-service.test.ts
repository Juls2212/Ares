import { describe, expect, it, vi } from "vitest";
import { createDashboardService, type DashboardClock } from "../src/main/dashboard/dashboard-service";
import type { DashboardRepository } from "../src/main/dashboard/dashboard-repository";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import type { ActionHistoryRecord } from "../src/shared/action-contracts";

const task = {
  id: "task-1", title: "Informe", description: null, dueDate: "2026-09-17", dueTime: "09:00",
  priority: "MEDIUM" as const, status: "PENDING" as const, categoryId: null, completedAt: null,
  createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z"
};
const event = {
  id: "event-1", title: "Reunión", description: null, startAt: "2026-09-17T15:00:00.000Z", endAt: null,
  categoryId: null, location: null, createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z"
};
const reminder = {
  id: "reminder-1", title: "Llamar", remindAt: "2026-09-17T16:00:00.000Z", taskId: null, eventId: null,
  status: "PENDING" as const, deliveredAt: null, createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z"
};
const activity: ActionHistoryRecord = {
  id: "history-1", actionId: "action-1", action: "CREATE_TASK", riskLevel: 1, status: "SUCCEEDED",
  userSummary: "Se creó una tarea.", errorCode: null, metadata: { scopeKind: "PLANNER" },
  startedAt: "2026-09-17T10:00:00.000Z", finishedAt: "2026-09-17T10:01:00.000Z", createdAt: "2026-09-17T10:01:00.000Z"
};

const createRepository = (): DashboardRepository => ({
  listTodayTasks: vi.fn(async () => [task]),
  listTodayEvents: vi.fn(async () => [event]),
  listTodayReminders: vi.fn(async () => [reminder]),
  listPendingTasks: vi.fn(async () => [task]),
  listUpcomingEvents: vi.fn(async () => [event]),
  listUpcomingPendingReminders: vi.fn(async () => [reminder])
});

const createHistoryService = (): ActionHistoryService => ({
  recordTerminal: vi.fn(),
  list: vi.fn(async () => ({ ok: true as const, data: { items: [activity], total: 1 } }))
});

const clock: DashboardClock = {
  now: () => new Date("2026-09-17T12:00:00.000Z"),
  getLocalDate: () => "2026-09-17",
  getRangeBounds: () => ({ startAt: "2026-09-17T05:00:00.000Z", endAt: "2026-09-18T05:00:00.000Z" })
};

describe("dashboard service", () => {
  it("builds a deterministic, bounded summary using the planner local-day boundary", async () => {
    const repository = createRepository();
    const historyService = createHistoryService();
    const service = createDashboardService({ repository, historyService, clock, logError: vi.fn() });

    const result = await service.getTodaySummary();

    expect(result).toEqual({
      ok: true,
      data: {
        today: { localDate: "2026-09-17", tasks: [task], events: [event], reminders: [reminder] },
        pendingTasks: [task], upcomingEvents: [event], upcomingReminders: [reminder],
        recentActivity: [activity], generatedAt: "2026-09-17T12:00:00.000Z"
      }
    });
    expect(repository.listTodayTasks).toHaveBeenCalledWith("2026-09-17", 5);
    expect(repository.listTodayEvents).toHaveBeenCalledWith(
      new Date("2026-09-17T05:00:00.000Z"), new Date("2026-09-18T05:00:00.000Z"), 5
    );
    expect(repository.listUpcomingEvents).toHaveBeenCalledWith(
      new Date("2026-09-17T12:00:00.000Z"), new Date("2026-09-24T12:00:00.000Z"), 5
    );
    expect(historyService.list).toHaveBeenCalledWith({ limit: 5 });
  });

  it("returns an empty safe state without widening any query", async () => {
    const repository = createRepository();
    for (const method of Object.values(repository)) vi.mocked(method).mockResolvedValue([]);
    const historyService = createHistoryService();
    vi.mocked(historyService.list).mockResolvedValueOnce({ ok: true, data: { items: [], total: 0 } });

    const result = await createDashboardService({ repository, historyService, clock, logError: vi.fn() }).getTodaySummary();
    expect(result).toMatchObject({ ok: true, data: { pendingTasks: [], upcomingEvents: [], upcomingReminders: [], recentActivity: [] } });
  });

  it("maps repository and history failures without leaking raw technical details", async () => {
    const secret = "postgresql://private:password@127.0.0.1/ares";
    const repository = createRepository();
    vi.mocked(repository.listPendingTasks).mockRejectedValueOnce(new Error(secret));
    const logError = vi.fn();
    const service = createDashboardService({ repository, historyService: createHistoryService(), clock, logError });

    const result = await service.getTodaySummary();
    expect(result).toEqual({ ok: false, error: { code: "DASHBOARD_UNAVAILABLE", userMessage: "No se pudo cargar el resumen de inicio." } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(secret);

    const failedHistory = createHistoryService();
    vi.mocked(failedHistory.list).mockResolvedValueOnce({ ok: false, error: { code: "ACTION_HISTORY_UNAVAILABLE", userMessage: "No se pudo acceder al historial de acciones." } });
    await expect(createDashboardService({ repository: createRepository(), historyService: failedHistory, clock, logError: vi.fn() }).getTodaySummary())
      .resolves.toEqual({ ok: false, error: { code: "DASHBOARD_UNAVAILABLE", userMessage: "No se pudo cargar el resumen de inicio." } });
  });
});
