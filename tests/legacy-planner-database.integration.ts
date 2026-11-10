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
  eventNotificationDeliveries,
  events,
  reminders,
  settings,
  tasks,
  weeklyRoutines,
  weeklySchedules
} from "../src/main/database/schema";
import { createPlannerRepositories } from "../src/main/planner/planner-repositories";
import { createPlannerService, type PlannerClock } from "../src/main/planner/planner-service";
import { createReminderDeliveryRepository } from "../src/main/reminders/reminder-delivery-repository";
import { createReminderDeliveryService } from "../src/main/reminders/reminder-delivery-service";
import { createEventDeliveryRepository } from "../src/main/events/event-delivery-repository";
import { createEventDeliveryService } from "../src/main/events/event-delivery-service";
import type {
  CategoryRecord,
  EventRecord,
  PlannerOperationResult,
  ReminderRecord,
  TaskRecord,
  WeeklyRoutineRecord,
  WeeklyScheduleRecord
} from "../src/shared/planner-contracts";
import type { ActionHistoryRecord, ActionOperationResult } from "../src/shared/action-contracts";
import type {
  ApplicationOperationResult,
  ApplicationRecord
} from "../src/shared/application-contracts";
import { LEGACY_TEST_MARKER } from "./helpers/read-source";
// LEGACY: scheduled for deletion in Refactor Phase 3.1. Only verifies weekly routines and weekly schedules; needs a live database.
void LEGACY_TEST_MARKER;

const database = getDatabase();
const repositories = createPlannerRepositories(database);
const reminderDeliveryRepository = createReminderDeliveryRepository(database);
const eventDeliveryRepository = createEventDeliveryRepository(database);
const testSuffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const createdCategoryIds: string[] = [];
const createdTaskIds: string[] = [];
const createdEventIds: string[] = [];
const createdReminderIds: string[] = [];
const createdActionHistoryIds: string[] = [];
const createdApplicationIds: string[] = [];
const createdWeeklyRoutineIds: string[] = [];
const createdWeeklyScheduleIds: string[] = [];

const clock: PlannerClock = {
  getLocalDate: () => "2026-09-17",
  getRangeBounds: (startDate, days) => ({
    startAt: `${startDate}T05:00:00.000Z`,
    endAt: days === 1 ? "2026-09-18T05:00:00.000Z" : "2026-09-21T05:00:00.000Z"
  })
};

const service = createPlannerService({ repositories, clock, logError: () => undefined });
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

const trackWeeklyRoutine = (record: WeeklyRoutineRecord): WeeklyRoutineRecord => {
  createdWeeklyRoutineIds.push(record.id);
  return record;
};

const trackWeeklySchedule = (record: WeeklyScheduleRecord): WeeklyScheduleRecord => {
  createdWeeklyScheduleIds.push(record.id);
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
  if (createdWeeklyRoutineIds.length > 0) {
    await database.delete(weeklyRoutines).where(inArray(weeklyRoutines.id, createdWeeklyRoutineIds));
  }
  if (createdWeeklyScheduleIds.length > 0) {
    await database.delete(weeklySchedules).where(inArray(weeklySchedules.id, createdWeeklyScheduleIds));
  }
  if (createdEventIds.length > 0) {
    await database
      .delete(eventNotificationDeliveries)
      .where(inArray(eventNotificationDeliveries.eventId, createdEventIds));
  }
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
  createdWeeklyRoutineIds.length = 0;
  createdWeeklyScheduleIds.length = 0;
  createdApplicationIds.length = 0;
});

afterAll(async () => {
  try {
    const tables = [
      categories,
      tasks,
      events,
      eventNotificationDeliveries,
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

describe("legacy weekly schedule database checks", () => {
  it("persists, orders, updates, deletes, and clears category references for weekly routines", async () => {
    const schedules = getSuccessData(await service.listWeeklySchedules({})).items;
    const primarySchedule = schedules.find((schedule) => schedule.title === "Horario principal");
    expect(primarySchedule).toBeDefined();
    const weeklyScheduleId = primarySchedule!.id;
    const category = trackCategory(
      getSuccessData(await service.createCategory({ name: `Weekly routine category ${testSuffix}` })).record
    );
    const fridayRoutine = trackWeeklyRoutine(
      getSuccessData(await service.createWeeklyRoutine({
        weeklyScheduleId,
        title: `Friday class ${testSuffix}`,
        weekday: "FRIDAY",
        startTime: "10:00",
        endTime: "11:00",
        categoryId: category.id,
        location: "Room 2"
      })).record
    );
    const mondayRoutine = trackWeeklyRoutine(
      getSuccessData(await service.createWeeklyRoutine({
        weeklyScheduleId,
        title: `Monday class ${testSuffix}`,
        weekday: "MONDAY",
        startTime: "08:00",
        endTime: "09:00",
        categoryId: category.id
      })).record
    );

    const listed = getSuccessData(await service.listWeeklyRoutines({ weeklyScheduleId }));
    expect(listed.items.map((routine) => routine.id)).toEqual([mondayRoutine.id, fridayRoutine.id]);
    expect(getSuccessData(await service.updateWeeklyRoutine({ routineId: mondayRoutine.id, weeklyScheduleId, endTime: "09:30" })).record.endTime).toBe("09:30");
    expect(getFailureCode(await service.createWeeklyRoutine({ weeklyScheduleId, title: "Invalid", weekday: "MONDAY", startTime: "10:00", endTime: "09:00" }))).toBe("PLANNER_WEEKLY_ROUTINE_TIME_RANGE_INVALID");

    await database.delete(categories).where(eq(categories.id, category.id));
    const uncategorized = getSuccessData(await service.listWeeklyRoutines({ weeklyScheduleId })).items;
    expect(uncategorized.every((routine) => routine.categoryId === null)).toBe(true);
    const deleted = await service.deleteWeeklyRoutine({ routineId: fridayRoutine.id });
    expect(getSuccessData(deleted)).toEqual({ deleted: true });
    createdWeeklyRoutineIds.splice(createdWeeklyRoutineIds.indexOf(fridayRoutine.id), 1);
    createdCategoryIds.splice(createdCategoryIds.indexOf(category.id), 1);
  });
  it("keeps the migration-created primary schedule and cascades only its owned routines on schedule deletion", async () => {
    const primarySchedules = getSuccessData(await service.listWeeklySchedules({})).items
      .filter((schedule) => schedule.title === "Horario principal");
    expect(primarySchedules).toHaveLength(1);

    const schedule = trackWeeklySchedule(
      getSuccessData(await service.createWeeklySchedule({ title: `Routine schedule ${testSuffix}` })).record
    );
    const routine = trackWeeklyRoutine(
      getSuccessData(await service.createWeeklyRoutine({
        weeklyScheduleId: schedule.id,
        title: `Owned routine ${testSuffix}`,
        weekday: "MONDAY",
        startTime: "08:00",
        endTime: "09:00"
      })).record
    );
    expect(getSuccessData(await service.listWeeklyRoutines({ weeklyScheduleId: schedule.id })).items)
      .toEqual([routine]);
    expect(getSuccessData(await service.deleteWeeklySchedule({ weeklyScheduleId: schedule.id }))).toEqual({ deleted: true });
    expect(await repositories.findWeeklyRoutineById(routine.id)).toBeUndefined();
    createdWeeklyRoutineIds.splice(createdWeeklyRoutineIds.indexOf(routine.id), 1);
    createdWeeklyScheduleIds.splice(createdWeeklyScheduleIds.indexOf(schedule.id), 1);
  });
});
