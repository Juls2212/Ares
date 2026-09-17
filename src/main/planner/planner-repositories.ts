import {
  and,
  asc,
  eq,
  gte,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql
} from "drizzle-orm";
import { getDatabase, type AresDatabase } from "../database/database-client";
import {
  categories,
  events,
  reminders,
  tasks
} from "../database/schema";
import type {
  CategoryListInput,
  CategoryRecord,
  CreateCategoryInput,
  CreateEventInput,
  CreateReminderInput,
  CreateTaskInput,
  EventListInput,
  EventRecord,
  ReminderListInput,
  ReminderRecord,
  TaskListInput,
  TaskRecord,
  UpdateCategoryInput,
  UpdateEventInput,
  UpdateTaskInput
} from "../../shared/planner-contracts";

export class PlannerRepositoryError extends Error {
  public readonly kind: "CONFLICT" | "REFERENCE_NOT_FOUND" | "UNAVAILABLE";

  public constructor(kind: "CONFLICT" | "REFERENCE_NOT_FOUND" | "UNAVAILABLE") {
    super(
      kind === "CONFLICT"
        ? "Planner persistence conflict."
        : kind === "REFERENCE_NOT_FOUND"
          ? "Planner persistence reference was not found."
          : "Planner persistence failed."
    );
    this.name = "PlannerRepositoryError";
    this.kind = kind;
  }
}

export type PlannerRepositories = {
  createCategory: (input: CreateCategoryInput) => Promise<CategoryRecord>;
  findCategoryById: (categoryId: string) => Promise<CategoryRecord | undefined>;
  listCategories: (_input: CategoryListInput) => Promise<CategoryRecord[]>;
  updateCategory: (input: UpdateCategoryInput) => Promise<CategoryRecord | undefined>;
  createTask: (input: CreateTaskInput) => Promise<TaskRecord>;
  findTaskById: (taskId: string) => Promise<TaskRecord | undefined>;
  listTasks: (input: TaskListInput) => Promise<TaskRecord[]>;
  updateTask: (input: UpdateTaskInput) => Promise<TaskRecord | undefined>;
  updateTaskCompletion: (
    taskId: string,
    status: "COMPLETED",
    completedAt: string
  ) => Promise<TaskRecord | undefined>;
  createEvent: (input: CreateEventInput) => Promise<EventRecord>;
  findEventById: (eventId: string) => Promise<EventRecord | undefined>;
  listEvents: (input: EventListInput) => Promise<EventRecord[]>;
  updateEvent: (input: UpdateEventInput) => Promise<EventRecord | undefined>;
  createReminder: (input: CreateReminderInput) => Promise<ReminderRecord>;
  findReminderById: (reminderId: string) => Promise<ReminderRecord | undefined>;
  listReminders: (input: ReminderListInput) => Promise<ReminderRecord[]>;
};

const toDateTime = (value: Date): string => value.toISOString();
const toLocalTime = (value: string | null): string | null =>
  value === null ? null : value.slice(0, 5);

const mapCategory = (record: typeof categories.$inferSelect): CategoryRecord => ({
  id: record.id,
  name: record.name,
  color: record.color,
  icon: record.icon,
  createdAt: toDateTime(record.createdAt),
  updatedAt: toDateTime(record.updatedAt)
});

const mapTask = (record: typeof tasks.$inferSelect): TaskRecord => ({
  id: record.id,
  title: record.title,
  description: record.description,
  dueDate: record.dueDate,
  dueTime: toLocalTime(record.dueTime),
  priority: record.priority,
  status: record.status,
  categoryId: record.categoryId,
  completedAt: record.completedAt ? toDateTime(record.completedAt) : null,
  createdAt: toDateTime(record.createdAt),
  updatedAt: toDateTime(record.updatedAt)
});

const mapEvent = (record: typeof events.$inferSelect): EventRecord => ({
  id: record.id,
  title: record.title,
  description: record.description,
  startAt: toDateTime(record.startAt),
  endAt: record.endAt ? toDateTime(record.endAt) : null,
  categoryId: record.categoryId,
  location: record.location,
  createdAt: toDateTime(record.createdAt),
  updatedAt: toDateTime(record.updatedAt)
});

const mapReminder = (record: typeof reminders.$inferSelect): ReminderRecord => ({
  id: record.id,
  title: record.title,
  remindAt: toDateTime(record.remindAt),
  taskId: record.taskId,
  eventId: record.eventId,
  status: record.status,
  deliveredAt: record.deliveredAt ? toDateTime(record.deliveredAt) : null,
  createdAt: toDateTime(record.createdAt),
  updatedAt: toDateTime(record.updatedAt)
});

const databaseErrorKind = (
  error: unknown
): "CONFLICT" | "REFERENCE_NOT_FOUND" | "UNAVAILABLE" => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "UNAVAILABLE";
  }

  const code = (error as { code?: unknown }).code;
  if (code === "23505") return "CONFLICT";
  if (code === "23503") return "REFERENCE_NOT_FOUND";
  return "UNAVAILABLE";
};

const executePersistence = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw new PlannerRepositoryError(databaseErrorKind(error));
  }
};

export const createPlannerRepositories = (
  database: AresDatabase = getDatabase()
): PlannerRepositories => ({
  createCategory: async (input) =>
    executePersistence(async () => {
      const [record] = await database.insert(categories).values(input).returning();
      return mapCategory(record);
    }),
  findCategoryById: async (categoryId) =>
    executePersistence(async () => {
      const [record] = await database.select().from(categories).where(eq(categories.id, categoryId));
      return record ? mapCategory(record) : undefined;
    }),
  listCategories: async () =>
    executePersistence(async () => {
      const records = await database
        .select()
        .from(categories)
        .orderBy(asc(sql`lower(${categories.name})`), asc(categories.id));
      return records.map(mapCategory);
    }),
  updateCategory: async (input) =>
    executePersistence(async () => {
      const changes = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        updatedAt: new Date()
      };
      const [record] = await database
        .update(categories)
        .set(changes)
        .where(eq(categories.id, input.categoryId))
        .returning();
      return record ? mapCategory(record) : undefined;
    }),
  createTask: async (input) =>
    executePersistence(async () => {
      const { completedAt, ...taskValues } = input;
      const [record] = await database
        .insert(tasks)
        .values({
          ...taskValues,
          ...(completedAt === undefined ? {} : { completedAt: new Date(completedAt) })
        })
        .returning();
      return mapTask(record);
    }),
  findTaskById: async (taskId) =>
    executePersistence(async () => {
      const [record] = await database.select().from(tasks).where(eq(tasks.id, taskId));
      return record ? mapTask(record) : undefined;
    }),
  listTasks: async (input) =>
    executePersistence(async () => {
      const conditions = [
        ...(input.statuses === undefined ? [] : [inArray(tasks.status, input.statuses)]),
        ...(input.categoryId === undefined ? [] : [eq(tasks.categoryId, input.categoryId)]),
        ...(input.dueDateFrom === undefined ? [] : [gte(tasks.dueDate, input.dueDateFrom)]),
        ...(input.dueDateTo === undefined ? [] : [lte(tasks.dueDate, input.dueDateTo)]),
        ...(input.includeCompleted || input.statuses !== undefined
          ? []
          : [ne(tasks.status, "COMPLETED")])
      ];
      const records = await database
        .select()
        .from(tasks)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.createdAt));
      return records.map(mapTask);
    }),
  updateTask: async (input) =>
    executePersistence(async () => {
      const changes = {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        ...(input.dueTime === undefined ? {} : { dueTime: input.dueTime }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.completedAt === undefined
          ? {}
          : { completedAt: input.completedAt === null ? null : new Date(input.completedAt) }),
        updatedAt: new Date()
      };
      const [record] = await database
        .update(tasks)
        .set(changes)
        .where(eq(tasks.id, input.taskId))
        .returning();
      return record ? mapTask(record) : undefined;
    }),
  updateTaskCompletion: async (taskId, status, completedAt) =>
    executePersistence(async () => {
      const [record] = await database
        .update(tasks)
        .set({ status, completedAt: new Date(completedAt), updatedAt: new Date() })
        .where(eq(tasks.id, taskId))
        .returning();
      return record ? mapTask(record) : undefined;
    }),
  createEvent: async (input) =>
    executePersistence(async () => {
      const { endAt, ...eventValues } = input;
      const [record] = await database
        .insert(events)
        .values({
          ...eventValues,
          startAt: new Date(eventValues.startAt),
          ...(endAt === undefined ? {} : { endAt: new Date(endAt) })
        })
        .returning();
      return mapEvent(record);
    }),
  findEventById: async (eventId) =>
    executePersistence(async () => {
      const [record] = await database.select().from(events).where(eq(events.id, eventId));
      return record ? mapEvent(record) : undefined;
    }),
  listEvents: async (input) =>
    executePersistence(async () => {
      const startAt = input.startAt ? new Date(input.startAt) : undefined;
      const endAt = input.endAt ? new Date(input.endAt) : undefined;
      const rangeCondition =
        startAt && endAt
          ? or(
              and(gte(events.startAt, startAt), lt(events.startAt, endAt)),
              and(isNotNull(events.endAt), lt(events.startAt, endAt), gt(events.endAt, startAt))
            )
          : startAt
            ? gte(events.startAt, startAt)
            : endAt
              ? lt(events.startAt, endAt)
              : undefined;
      const conditions = [
        ...(input.categoryId === undefined ? [] : [eq(events.categoryId, input.categoryId)]),
        ...(rangeCondition === undefined ? [] : [rangeCondition])
      ];
      const records = await database
        .select()
        .from(events)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(asc(events.startAt), asc(events.createdAt));
      return records.map(mapEvent);
    }),
  updateEvent: async (input) =>
    executePersistence(async () => {
      const changes = {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.startAt === undefined ? {} : { startAt: new Date(input.startAt) }),
        ...(input.endAt === undefined
          ? {}
          : { endAt: input.endAt === null ? null : new Date(input.endAt) }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.location === undefined ? {} : { location: input.location }),
        updatedAt: new Date()
      };
      const [record] = await database
        .update(events)
        .set(changes)
        .where(eq(events.id, input.eventId))
        .returning();
      return record ? mapEvent(record) : undefined;
    }),
  createReminder: async (input) =>
    executePersistence(async () => {
      const { deliveredAt, ...reminderValues } = input;
      const [record] = await database
        .insert(reminders)
        .values({
          ...reminderValues,
          remindAt: new Date(reminderValues.remindAt),
          ...(deliveredAt === undefined ? {} : { deliveredAt: new Date(deliveredAt) })
        })
        .returning();
      return mapReminder(record);
    }),
  findReminderById: async (reminderId) =>
    executePersistence(async () => {
      const [record] = await database.select().from(reminders).where(eq(reminders.id, reminderId));
      return record ? mapReminder(record) : undefined;
    }),
  listReminders: async (input) =>
    executePersistence(async () => {
      const conditions = [
        ...(input.statuses === undefined ? [] : [inArray(reminders.status, input.statuses)]),
        ...(input.taskId === undefined ? [] : [eq(reminders.taskId, input.taskId)]),
        ...(input.eventId === undefined ? [] : [eq(reminders.eventId, input.eventId)]),
        ...(input.remindAtFrom === undefined
          ? []
          : [gte(reminders.remindAt, new Date(input.remindAtFrom))]),
        ...(input.remindAtTo === undefined ? [] : [lt(reminders.remindAt, new Date(input.remindAtTo))])
      ];
      const records = await database
        .select()
        .from(reminders)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(asc(reminders.remindAt), asc(reminders.createdAt));
      return records.map(mapReminder);
    })
});
