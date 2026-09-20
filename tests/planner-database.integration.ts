import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDatabaseConnection, getDatabase } from "../src/main/database/database-client";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionHistoryRepository } from "../src/main/actions/action-history-repository";
import { createActionHistoryService } from "../src/main/actions/action-history-service";
import { createPlannerActionExecutor } from "../src/main/actions/planner-action-executor";
import { createApplicationService } from "../src/main/applications/application-service";
import {
  actionHistory,
  applicationAliases,
  applications,
  categories,
  events,
  reminders,
  settings,
  tasks
} from "../src/main/database/schema";
import { createPlannerRepositories } from "../src/main/planner/planner-repositories";
import { createPlannerService, type PlannerClock } from "../src/main/planner/planner-service";
import { createReminderDeliveryRepository } from "../src/main/reminders/reminder-delivery-repository";
import { createDashboardRepository } from "../src/main/dashboard/dashboard-repository";
import { createDashboardService, type DashboardClock } from "../src/main/dashboard/dashboard-service";
import type {
  CategoryRecord,
  EventRecord,
  PlannerOperationResult,
  ReminderRecord,
  TaskRecord
} from "../src/shared/planner-contracts";
import type { ActionHistoryRecord, ActionOperationResult } from "../src/shared/action-contracts";
import type {
  ApplicationOperationResult,
  ApplicationRecord
} from "../src/shared/application-contracts";

const database = getDatabase();
const repositories = createPlannerRepositories(database);
const reminderDeliveryRepository = createReminderDeliveryRepository(database);
const testSuffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const createdCategoryIds: string[] = [];
const createdTaskIds: string[] = [];
const createdEventIds: string[] = [];
const createdReminderIds: string[] = [];
const createdActionHistoryIds: string[] = [];
const createdApplicationIds: string[] = [];

const clock: PlannerClock = {
  getLocalDate: () => "2026-09-17",
  getRangeBounds: (startDate, days) => ({
    startAt: `${startDate}T05:00:00.000Z`,
    endAt: days === 1 ? "2026-09-18T05:00:00.000Z" : "2026-09-21T05:00:00.000Z"
  })
};

const service = createPlannerService({ repositories, clock, logError: () => undefined });
const dashboardClock: DashboardClock = {
  now: () => new Date("2026-09-17T12:00:00.000Z"),
  getLocalDate: () => "2026-09-17",
  getRangeBounds: (startDate, days) => ({
    startAt: `${startDate}T05:00:00.000Z`,
    endAt: days === 1 ? "2026-09-18T05:00:00.000Z" : "2026-09-24T05:00:00.000Z"
  })
};
const actionHistoryService = createActionHistoryService({
  repository: createActionHistoryRepository(database),
  generateActionId: () => `history-${testSuffix}-${createdActionHistoryIds.length + 1}`,
  logError: () => undefined
});
const actionOrchestrator = createActionOrchestrator({
  executor: createActionExecutor({
    plannerExecutor: createPlannerActionExecutor({ plannerService: service, logError: () => undefined })
  }),
  historyService: actionHistoryService,
  logError: () => undefined
});
const applicationService = createApplicationService({ logError: () => undefined });

const getSuccessData = <T>(result: PlannerOperationResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected integration operation to succeed: ${result.error.code}`);
  }
  return result.data;
};

const getFailureCode = <T>(result: PlannerOperationResult<T>): string => {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected integration operation to fail.");
  }
  return result.error.code;
};

const getHistorySuccess = <T>(result: ActionOperationResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected action history operation to succeed: ${result.error.code}`);
  }
  return result.data;
};

const getApplicationSuccess = <T>(result: ApplicationOperationResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected application operation to succeed: ${result.error.code}`);
  }
  return result.data;
};

const trackCategory = (record: CategoryRecord): CategoryRecord => {
  createdCategoryIds.push(record.id);
  return record;
};

const trackTask = (record: TaskRecord): TaskRecord => {
  createdTaskIds.push(record.id);
  return record;
};

const trackEvent = (record: EventRecord): EventRecord => {
  createdEventIds.push(record.id);
  return record;
};

const trackReminder = (record: ReminderRecord): ReminderRecord => {
  createdReminderIds.push(record.id);
  return record;
};

const trackActionHistory = (record: ActionHistoryRecord): ActionHistoryRecord => {
  createdActionHistoryIds.push(record.id);
  return record;
};

const trackApplication = (record: ApplicationRecord): ApplicationRecord => {
  createdApplicationIds.push(record.id);
  return record;
};

afterEach(async () => {
  if (createdActionHistoryIds.length > 0) {
    await database.delete(actionHistory).where(inArray(actionHistory.id, createdActionHistoryIds));
  }
  if (createdReminderIds.length > 0) {
    await database.delete(reminders).where(inArray(reminders.id, createdReminderIds));
  }
  if (createdTaskIds.length > 0) {
    await database.delete(tasks).where(inArray(tasks.id, createdTaskIds));
  }
  if (createdEventIds.length > 0) {
    await database.delete(events).where(inArray(events.id, createdEventIds));
  }
  if (createdCategoryIds.length > 0) {
    await database.delete(categories).where(inArray(categories.id, createdCategoryIds));
  }
  if (createdApplicationIds.length > 0) {
    await database.delete(applications).where(inArray(applications.id, createdApplicationIds));
  }

  createdReminderIds.length = 0;
  createdActionHistoryIds.length = 0;
  createdTaskIds.length = 0;
  createdEventIds.length = 0;
  createdCategoryIds.length = 0;
  createdApplicationIds.length = 0;
});

afterAll(async () => {
  try {
    const tables = [
      categories,
      tasks,
      events,
      reminders,
      applications,
      applicationAliases,
      actionHistory,
      settings
    ];

    for (const table of tables) {
      const [result] = await database.select({ count: sql<number>`count(*)::int` }).from(table);
      expect(result.count).toBe(0);
    }
  } finally {
    await closeDatabaseConnection();
  }
});

describe("planner database integration", () => {
  it("builds a bounded read-only dashboard summary from safe planner and history records", async () => {
    const category = trackCategory(
      getSuccessData(await service.createCategory({ name: `Dashboard category ${testSuffix}` })).record
    );
    const todayTask = trackTask(
      getSuccessData(await service.createTask({
        title: `Dashboard task ${testSuffix}`,
        dueDate: "2026-09-17",
        dueTime: "09:00",
        categoryId: category.id
      })).record
    );
    const upcomingEvent = trackEvent(
      getSuccessData(await service.createEvent({
        title: `Dashboard event ${testSuffix}`,
        startAt: "2026-09-18T15:00:00.000Z",
        categoryId: category.id
      })).record
    );
    const todayReminder = trackReminder(
      getSuccessData(await service.createReminder({
        title: `Dashboard reminder ${testSuffix}`,
        remindAt: "2026-09-17T16:00:00.000Z",
        taskId: todayTask.id
      })).record
    );
    const history = trackActionHistory(getHistorySuccess(await actionHistoryService.recordTerminal({
      actionId: `dashboard-action-${testSuffix}`,
      action: "CREATE_TASK",
      riskLevel: 1,
      status: "SUCCEEDED",
      userSummary: "Se creó una tarea de prueba.",
      startedAt: "2026-09-17T11:00:00.000Z",
      finishedAt: "2026-09-17T11:01:00.000Z",
      metadata: { itemCount: 1, sourcePath: "C:\\private" }
    })));
    const dashboard = createDashboardService({
      repository: createDashboardRepository(database),
      historyService: actionHistoryService,
      clock: dashboardClock,
      logError: () => undefined
    });

    const result = await dashboard.getTodaySummary();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected dashboard summary.");
    expect(result.data.today.localDate).toBe("2026-09-17");
    expect(result.data.today.tasks.map((record) => record.id)).toContain(todayTask.id);
    expect(result.data.today.reminders.map((record) => record.id)).toContain(todayReminder.id);
    expect(result.data.upcomingEvents.map((record) => record.id)).toContain(upcomingEvent.id);
    expect(result.data.recentActivity.map((record) => record.id)).toContain(history.id);
    expect(JSON.stringify(result.data.recentActivity)).not.toContain("C:\\private");
  });

  it("persists and reads categories, tasks, events, and reminders", async () => {
    const category = trackCategory(
      getSuccessData(await service.createCategory({ name: `Integration category ${testSuffix}` })).record
    );
    const task = trackTask(
      getSuccessData(
        await service.createTask({
          title: `Integration task ${testSuffix}`,
          dueDate: "2026-09-17",
          dueTime: "09:30",
          categoryId: category.id
        })
      ).record
    );
    const event = trackEvent(
      getSuccessData(
        await service.createEvent({
          title: `Integration event ${testSuffix}`,
          startAt: "2026-09-17T15:00:00.000Z",
          endAt: "2026-09-17T16:00:00.000Z",
          categoryId: category.id
        })
      ).record
    );
    const reminder = trackReminder(
      getSuccessData(
        await service.createReminder({
          title: `Integration reminder ${testSuffix}`,
          remindAt: "2026-09-17T16:30:00.000Z",
          taskId: task.id
        })
      ).record
    );

    const updatedTask = getSuccessData(
      await service.updateTask({ taskId: task.id, dueTime: "10:15" })
    ).record;

    const categoriesResult = getSuccessData(await service.listCategories({}));
    const tasksResult = getSuccessData(await service.listTasks({ categoryId: category.id }));
    const eventsResult = getSuccessData(await service.listEvents({ categoryId: category.id }));
    const remindersResult = getSuccessData(await service.listReminders({ taskId: task.id }));

    expect(categoriesResult.items.map((item) => item.id)).toContain(category.id);
    expect(tasksResult.items.map((item) => item.id)).toContain(task.id);
    expect(eventsResult.items.map((item) => item.id)).toContain(event.id);
    expect(remindersResult.items.map((item) => item.id)).toContain(reminder.id);
    expect(updatedTask.dueTime).toBe("10:15");
  });

  it("returns controlled missing-reference outcomes without creating records", async () => {
    const missingId = "550e8400-e29b-41d4-a716-446655440000";

    expect(
      getFailureCode(await service.createTask({ title: "Missing category", categoryId: missingId }))
    ).toBe("PLANNER_REFERENCE_NOT_FOUND");
    expect(
      getFailureCode(
        await service.createReminder({
          title: "Missing task",
          remindAt: "2026-09-17T16:30:00.000Z",
          taskId: missingId
        })
      )
    ).toBe("PLANNER_REFERENCE_NOT_FOUND");
    expect(
      getFailureCode(
        await service.createReminder({
          title: "Missing event",
          remindAt: "2026-09-17T16:30:00.000Z",
          eventId: missingId
        })
      )
    ).toBe("PLANNER_REFERENCE_NOT_FOUND");
  });

  it("uses controlled day and Monday-to-Sunday schedule boundaries", async () => {
    const category = trackCategory(
      getSuccessData(await service.createCategory({ name: `Schedule category ${testSuffix}` })).record
    );
    const task = trackTask(
      getSuccessData(
        await service.createTask({
          title: `Schedule task ${testSuffix}`,
          dueDate: "2026-09-17",
          categoryId: category.id
        })
      ).record
    );
    const event = trackEvent(
      getSuccessData(
        await service.createEvent({
          title: `Schedule event ${testSuffix}`,
          startAt: "2026-09-17T15:00:00.000Z",
          endAt: "2026-09-17T16:00:00.000Z"
        })
      ).record
    );
    const reminder = trackReminder(
      getSuccessData(
        await service.createReminder({
          title: `Schedule reminder ${testSuffix}`,
          remindAt: "2026-09-17T16:30:00.000Z"
        })
      ).record
    );

    const today = getSuccessData(await service.getTodaySchedule({}));
    const week = getSuccessData(await service.getWeekSchedule({}));

    expect(today.localDate).toBe("2026-09-17");
    expect(today.tasks.map((item) => item.id)).toContain(task.id);
    expect(today.events.map((item) => item.id)).toContain(event.id);
    expect(today.reminders.map((item) => item.id)).toContain(reminder.id);
    expect(week.weekStart).toBe("2026-09-14");
    expect(week.weekEnd).toBe("2026-09-20");
    expect(week.tasks.map((item) => item.id)).toContain(task.id);
  });

  it("atomically claims a due pending reminder once across concurrent delivery attempts", async () => {
    const reminder = trackReminder(
      getSuccessData(
        await service.createReminder({
          title: `Atomic reminder ${testSuffix}`,
          remindAt: "2026-09-17T10:00:00.000Z"
        })
      ).record
    );
    const deliveryTime = new Date("2026-09-18T12:00:00.000Z");

    const due = await reminderDeliveryRepository.listDuePending(deliveryTime, 10);
    const [firstClaim, secondClaim] = await Promise.all([
      reminderDeliveryRepository.claimPending(reminder.id, deliveryTime),
      reminderDeliveryRepository.claimPending(reminder.id, deliveryTime)
    ]);
    const successfulClaims = [firstClaim, secondClaim].filter((claim) => claim !== undefined);
    const [persisted] = await database.select().from(reminders).where(eq(reminders.id, reminder.id));

    expect(due.map((item) => item.id)).toContain(reminder.id);
    expect(successfulClaims).toHaveLength(1);
    expect(persisted).toMatchObject({ status: "TRIGGERED", deliveredAt: deliveryTime });
    await expect(reminderDeliveryRepository.listDuePending(deliveryTime, 10)).resolves.not.toContainEqual(
      expect.objectContaining({ id: reminder.id })
    );
  });

  it("records terminal action history with sanitized metadata and stable ordering", async () => {
    const successful = trackActionHistory(
      getHistorySuccess(
        await actionHistoryService.recordTerminal({
          action: "CREATE_TASK",
          riskLevel: 1,
          status: "SUCCEEDED",
          userSummary: "Se creó una tarea.",
          metadata: {
            itemCount: 1,
            scopeKind: "PLANNER",
            databaseUrl: "postgresql://discarded",
            sourcePath: "C:\\discarded"
          },
          startedAt: "2026-09-17T10:00:00.000Z",
          finishedAt: "2026-09-17T10:00:01.000Z"
        })
      )
    );
    const failed = trackActionHistory(
      getHistorySuccess(
        await actionHistoryService.recordTerminal({
          action: "UPDATE_TASK",
          riskLevel: 2,
          status: "EXECUTION_FAILED",
          userSummary: "No se pudo actualizar la tarea.",
          errorCode: "PLANNER_DATABASE_UNAVAILABLE",
          startedAt: "2026-09-17T10:01:00.000Z",
          finishedAt: "2026-09-17T10:01:01.000Z"
        })
      )
    );

    const listed = getHistorySuccess(await actionHistoryService.list({ limit: 10 }));

    expect(successful.metadata).toEqual({ itemCount: 1, scopeKind: "PLANNER" });
    expect(listed.items.slice(0, 2).map((item) => item.id)).toEqual([failed.id, successful.id]);
  });

  it("persists only a registered public display name for OPEN_APPLICATION history", async () => {
    const executablePath = `C:\\Program Files\\Ares Tests\\history-${testSuffix}.exe`;
    const application = trackApplication(
      getApplicationSuccess(
        await applicationService.registerApplication({
          name: `History application ${testSuffix}`,
          executablePath,
          aliases: [`History alias ${testSuffix}`]
        })
      ).record
    );

    const history = trackActionHistory(
      getHistorySuccess(
        await actionHistoryService.recordTerminal({
          action: "OPEN_APPLICATION",
          riskLevel: 1,
          status: "SUCCEEDED",
          userSummary: `Se abrió ${application.name}.`,
          metadata: {
            scopeKind: "APPLICATION",
            resultKind: "SUCCEEDED",
            applicationDisplayName: application.name,
            alias: `History alias ${testSuffix}`,
            executablePath,
            canonicalPath: executablePath,
            command: "history.exe",
            processId: 1234
          },
          startedAt: "2026-09-17T10:02:00.000Z",
          finishedAt: "2026-09-17T10:02:01.000Z"
        })
      )
    );

    expect(history.metadata).toEqual({
      scopeKind: "APPLICATION",
      resultKind: "SUCCEEDED",
      applicationDisplayName: application.name
    });
    expect(JSON.stringify(history)).not.toContain(executablePath);
    expect(JSON.stringify(history)).not.toContain(`History alias ${testSuffix}`);
  });

  it("persists an orchestrated planner mutation and its terminal history entry", async () => {
    const result = await actionOrchestrator.propose({
      action: "CREATE_TASK",
      input: { title: `Orchestrated task ${testSuffix}`, dueDate: "2026-09-17" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !("status" in result.data)) {
      throw new Error("Expected a terminal action outcome.");
    }
    expect(result.data.status).toBe("SUCCEEDED");

    const [createdTask] = await database
      .select()
      .from(tasks)
      .where(eq(tasks.title, `Orchestrated task ${testSuffix}`));
    const [historyEntry] = await database
      .select()
      .from(actionHistory)
      .where(eq(actionHistory.actionId, result.data.actionId));

    expect(createdTask).toBeDefined();
    expect(historyEntry).toMatchObject({
      actionName: "CREATE_TASK",
      resultStatus: "SUCCEEDED",
      riskLevel: 1
    });
    if (createdTask) createdTaskIds.push(createdTask.id);
    if (historyEntry) createdActionHistoryIds.push(historyEntry.id);
  });

  it("keeps executable paths Main-only while registering, updating, and resolving aliases", async () => {
    const executablePath = `C:\\Program Files\\Ares Tests\\catalog-${testSuffix}.exe`;
    const application = trackApplication(
      getApplicationSuccess(
        await applicationService.registerApplication({
          name: `Catalog application ${testSuffix}`,
          executablePath,
          aliases: [`Catalog ${testSuffix}`, `Alias ${testSuffix}`]
        })
      ).record
    );

    expect(JSON.stringify(application)).not.toContain(executablePath);
    expect(application.aliases.map((alias) => alias.alias)).toContain(`Catalog ${testSuffix}`);

    const resolved = getApplicationSuccess(
      await applicationService.resolveEnabledApplicationByAlias(` catalog ${testSuffix} `)
    );
    expect(resolved.executablePath).toBe(executablePath);

    const listed = getApplicationSuccess(await applicationService.listApplications({ enabled: true }));
    expect(listed.items.find((item) => item.id === application.id)).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(executablePath);

    const duplicateName = await applicationService.registerApplication({
      name: `  catalog application ${testSuffix}  `,
      executablePath: `C:\\Program Files\\Ares Tests\\same-name-${testSuffix}.exe`,
      aliases: [`Different name ${testSuffix}`]
    });
    expect(duplicateName).toMatchObject({ ok: false, error: { code: "APPLICATION_CONFLICT" } });

    const duplicate = await applicationService.registerApplication({
      name: `Duplicate alias ${testSuffix}`,
      executablePath: `C:\\Program Files\\Ares Tests\\duplicate-${testSuffix}.exe`,
      aliases: [`  catalog ${testSuffix}  `]
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "APPLICATION_CONFLICT" } });

    const updated = getApplicationSuccess(
      await applicationService.updateApplication({
        applicationId: application.id,
        aliases: [`Updated ${testSuffix}`],
        isEnabled: false
      })
    ).record;
    expect(updated.isEnabled).toBe(false);
    expect(updated.aliases.map((alias) => alias.alias)).toEqual([`Updated ${testSuffix}`]);

    await expect(
      applicationService.resolveEnabledApplicationByAlias(`Updated ${testSuffix}`)
    ).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_DISABLED" } });
  });
});
