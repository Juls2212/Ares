import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { categories, habitCompletions, habits } from "../database/schema";
import type {
  CompleteHabitInput,
  CreateHabitInput,
  HabitCompletionRecord,
  HabitListInput,
  HabitRecord,
  UpdateHabitInput
} from "../../shared/habit-contracts";

export class HabitRepositoryError extends Error {
  public constructor(public readonly kind: "CONFLICT" | "REFERENCE_NOT_FOUND" | "UNAVAILABLE") {
    super("Habit persistence failed.");
    this.name = "HabitRepositoryError";
  }
}

export type HabitRepositories = {
  createHabit: (input: CreateHabitInput) => Promise<HabitRecord>;
  findHabitById: (habitId: string) => Promise<HabitRecord | undefined>;
  listHabits: (input: HabitListInput) => Promise<HabitRecord[]>;
  updateHabit: (input: UpdateHabitInput) => Promise<HabitRecord | undefined>;
  findCategoryById: (categoryId: string) => Promise<boolean>;
  completeHabit: (input: CompleteHabitInput) => Promise<HabitCompletionRecord>;
  listCompletions: (input: { habitIds: string[]; from?: string; to?: string }) => Promise<HabitCompletionRecord[]>;
};

const toDateTime = (value: Date): string => value.toISOString();
const mapHabit = (record: typeof habits.$inferSelect): HabitRecord => ({ id: record.id, title: record.title, description: record.description, categoryId: record.categoryId, icon: record.icon as HabitRecord["icon"], frequency: record.frequency, targetCount: record.targetCount, active: record.active, createdAt: toDateTime(record.createdAt), updatedAt: toDateTime(record.updatedAt) });
const mapCompletion = (record: typeof habitCompletions.$inferSelect): HabitCompletionRecord => ({ id: record.id, habitId: record.habitId, completedOn: record.completedOn, completedAt: toDateTime(record.completedAt) });

const errorKind = (error: unknown): "CONFLICT" | "REFERENCE_NOT_FOUND" | "UNAVAILABLE" => {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "23505" ? "CONFLICT" : code === "23503" ? "REFERENCE_NOT_FOUND" : "UNAVAILABLE";
};

const persist = async <T>(operation: () => Promise<T>): Promise<T> => {
  try { return await operation(); } catch (error) { throw new HabitRepositoryError(errorKind(error)); }
};

export const createHabitRepositories = (database: AresDatabase = getDatabase()): HabitRepositories => ({
  createHabit: (input) => persist(async () => {
    const [record] = await database.insert(habits).values(input).returning();
    return mapHabit(record);
  }),
  findHabitById: (habitId) => persist(async () => {
    const [record] = await database.select().from(habits).where(eq(habits.id, habitId));
    return record ? mapHabit(record) : undefined;
  }),
  listHabits: (input) => persist(async () => {
    const records = await database.select().from(habits).where(input.includeInactive ? undefined : eq(habits.active, true)).orderBy(asc(habits.createdAt), asc(habits.id));
    return records.map(mapHabit);
  }),
  updateHabit: (input) => persist(async () => {
    const { habitId, ...changes } = input;
    const [record] = await database.update(habits).set({ ...changes, updatedAt: new Date() }).where(eq(habits.id, habitId)).returning();
    return record ? mapHabit(record) : undefined;
  }),
  findCategoryById: (categoryId) => persist(async () => {
    const [record] = await database.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId));
    return record !== undefined;
  }),
  completeHabit: (input) => persist(async () => {
    const inserted = await database.insert(habitCompletions).values(input).onConflictDoNothing({ target: [habitCompletions.habitId, habitCompletions.completedOn] }).returning();
    if (inserted[0]) return mapCompletion(inserted[0]);
    const [existing] = await database.select().from(habitCompletions).where(and(eq(habitCompletions.habitId, input.habitId), eq(habitCompletions.completedOn, input.completedOn)));
    if (!existing) throw new HabitRepositoryError("UNAVAILABLE");
    return mapCompletion(existing);
  }),
  listCompletions: ({ habitIds, from, to }) => persist(async () => {
    if (habitIds.length === 0) return [];
    const conditions = [inArray(habitCompletions.habitId, habitIds), ...(from === undefined ? [] : [gte(habitCompletions.completedOn, from)]), ...(to === undefined ? [] : [lte(habitCompletions.completedOn, to)])];
    const records = await database.select().from(habitCompletions).where(and(...conditions)).orderBy(asc(habitCompletions.completedOn), asc(habitCompletions.habitId));
    return records.map(mapCompletion);
  })
});
