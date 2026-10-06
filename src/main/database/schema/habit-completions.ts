import { index, pgTable, timestamp, unique, uuid, date } from "drizzle-orm/pg-core";
import { habits } from "./habits";

export const habitCompletions = pgTable(
  "habit_completions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    habitId: uuid("habit_id").notNull().references(() => habits.id, { onDelete: "cascade" }),
    completedOn: date("completed_on", { mode: "string" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    unique("habit_completions_habit_id_completed_on_unique").on(table.habitId, table.completedOn),
    index("habit_completions_habit_id_completed_on_index").on(table.habitId, table.completedOn),
    index("habit_completions_completed_on_index").on(table.completedOn)
  ]
);

export type HabitCompletion = typeof habitCompletions.$inferSelect;
export type NewHabitCompletion = typeof habitCompletions.$inferInsert;
