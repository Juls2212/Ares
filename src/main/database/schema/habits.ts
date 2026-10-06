import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { habitFrequencyEnum } from "./enums";

const defaultHabitIcon = "SPARK";

export const habits = pgTable(
  "habits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 240 }).notNull(),
    description: varchar("description", { length: 4000 }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    icon: varchar("icon", { length: 16 }).default(defaultHabitIcon).notNull(),
    frequency: habitFrequencyEnum("frequency").notNull(),
    targetCount: integer("target_count").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("habits_title_non_blank_check", sql`btrim(${table.title}) <> ''`),
    check("habits_description_non_blank_check", sql`${table.description} IS NULL OR btrim(${table.description}) <> ''`),
    check("habits_icon_check", sql`${table.icon} in ('SPARK', 'BOOK', 'DUMBBELL', 'HOME', 'HEART', 'WATER', 'RUNNING', 'BRAIN', 'LEAF')`),
    check("habits_target_count_check", sql`${table.targetCount} between 1 and 7`),
    check("habits_frequency_target_check", sql`(${table.frequency} = 'DAILY' and ${table.targetCount} = 1) or (${table.frequency} = 'WEEKLY' and ${table.targetCount} between 1 and 7)`),
    index("habits_active_created_at_index").on(table.active, table.createdAt),
    index("habits_category_id_index").on(table.categoryId)
  ]
);

export type Habit = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
