import { and, asc, eq, gte, gt, isNotNull, lt, ne, or } from "drizzle-orm";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { events, reminders, tasks } from "../database/schema";
import type {
  EventRecord,
  ReminderRecord,
  TaskRecord
} from "../../shared/planner-contracts";

export class DashboardRepositoryError extends Error {
  public constructor() {
    super("Dashboard read operation failed.");
    this.name = "DashboardRepositoryError";
  }
}

export type DashboardRepository = {
  listTodayTasks: (localDate: string, limit: number) => Promise<TaskRecord[]>;
  listTodayEvents: (startAt: Date, endAt: Date, limit: number) => Promise<EventRecord[]>;
  listTodayReminders: (startAt: Date, endAt: Date, limit: number) => Promise<ReminderRecord[]>;
  listPendingTasks: (limit: number) => Promise<TaskRecord[]>;
  listUpcomingEvents: (startAt: Date, endAt: Date, limit: number) => Promise<EventRecord[]>;
  listUpcomingPendingReminders: (startAt: Date, endAt: Date, limit: number) => Promise<ReminderRecord[]>;
};

const mapTask = (record: typeof tasks.$inferSelect): TaskRecord => ({
  id: record.id,
  title: record.title,
  description: record.description,
  dueDate: record.dueDate,
  dueTime: record.dueTime === null ? null : record.dueTime.slice(0, 5),
  priority: record.priority,
  status: record.status,
  categoryId: record.categoryId,
  completedAt: record.completedAt?.toISOString() ?? null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
});

const mapEvent = (record: typeof events.$inferSelect): EventRecord => ({
  id: record.id,
  title: record.title,
  description: record.description,
  startAt: record.startAt.toISOString(),
  endAt: record.endAt?.toISOString() ?? null,
  categoryId: record.categoryId,
  location: record.location,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
});

const mapReminder = (record: typeof reminders.$inferSelect): ReminderRecord => ({
  id: record.id,
  title: record.title,
  remindAt: record.remindAt.toISOString(),
  taskId: record.taskId,
  eventId: record.eventId,
  status: record.status,
  deliveredAt: record.deliveredAt?.toISOString() ?? null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
});

const executeRead = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new DashboardRepositoryError();
  }
};

const occurringWithin = (startAt: Date, endAt: Date) =>
  or(
    and(gte(events.startAt, startAt), lt(events.startAt, endAt)),
    and(isNotNull(events.endAt), lt(events.startAt, endAt), gt(events.endAt, startAt))
  );

export const createDashboardRepository = (
  database: AresDatabase = getDatabase()
): DashboardRepository => ({
  listTodayTasks: async (localDate, limit) =>
    executeRead(async () => {
      const records = await database
        .select()
        .from(tasks)
        .where(and(eq(tasks.dueDate, localDate), ne(tasks.status, "COMPLETED")))
        .orderBy(asc(tasks.dueTime), asc(tasks.createdAt), asc(tasks.id))
        .limit(limit);
      return records.map(mapTask);
    }),
  listTodayEvents: async (startAt, endAt, limit) =>
    executeRead(async () => {
      const records = await database
        .select()
        .from(events)
        .where(occurringWithin(startAt, endAt))
        .orderBy(asc(events.startAt), asc(events.createdAt), asc(events.id))
        .limit(limit);
      return records.map(mapEvent);
    }),
  listTodayReminders: async (startAt, endAt, limit) =>
    executeRead(async () => {
      const records = await database
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.status, "PENDING"),
            gte(reminders.remindAt, startAt),
            lt(reminders.remindAt, endAt)
          )
        )
        .orderBy(asc(reminders.remindAt), asc(reminders.createdAt), asc(reminders.id))
        .limit(limit);
      return records.map(mapReminder);
    }),
  listPendingTasks: async (limit) =>
    executeRead(async () => {
      const records = await database
        .select()
        .from(tasks)
        .where(ne(tasks.status, "COMPLETED"))
        .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.createdAt), asc(tasks.id))
        .limit(limit);
      return records.map(mapTask);
    }),
  listUpcomingEvents: async (startAt, endAt, limit) =>
    executeRead(async () => {
      const records = await database
        .select()
        .from(events)
        .where(occurringWithin(startAt, endAt))
        .orderBy(asc(events.startAt), asc(events.createdAt), asc(events.id))
        .limit(limit);
      return records.map(mapEvent);
    }),
  listUpcomingPendingReminders: async (startAt, endAt, limit) =>
    executeRead(async () => {
      const records = await database
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.status, "PENDING"),
            gte(reminders.remindAt, startAt),
            lt(reminders.remindAt, endAt)
          )
        )
        .orderBy(asc(reminders.remindAt), asc(reminders.createdAt), asc(reminders.id))
        .limit(limit);
      return records.map(mapReminder);
    })
});
