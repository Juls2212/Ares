import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDatabaseConnection, getDatabase } from "../src/main/database/database-client";
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
import type {
  CategoryRecord,
  EventRecord,
  PlannerOperationResult,
  ReminderRecord,
  TaskRecord
} from "../src/shared/planner-contracts";

const database = getDatabase();
const repositories = createPlannerRepositories(database);
const testSuffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const createdCategoryIds: string[] = [];
const createdTaskIds: string[] = [];
const createdEventIds: string[] = [];
const createdReminderIds: string[] = [];

const clock: PlannerClock = {
  getLocalDate: () => "2026-09-17",
  getRangeBounds: (startDate, days) => ({
    startAt: `${startDate}T05:00:00.000Z`,
    endAt: days === 1 ? "2026-09-18T05:00:00.000Z" : "2026-09-21T05:00:00.000Z"
  })
};

const service = createPlannerService({ repositories, clock, logError: () => undefined });

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

afterEach(async () => {
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

  createdReminderIds.length = 0;
  createdTaskIds.length = 0;
  createdEventIds.length = 0;
  createdCategoryIds.length = 0;
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
});
