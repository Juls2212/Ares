import { sql } from "drizzle-orm";
import { check, date, index, pgTable, time, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { taskPriorityEnum, taskStatusEnum } from "./enums";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 240 }).notNull(),
    description: varchar("description", { length: 4000 }),
    dueDate: date("due_date"),
    dueTime: time("due_time", { withTimezone: false }),
    priority: taskPriorityEnum("priority").default("MEDIUM").notNull(),
    status: taskStatusEnum("status").default("PENDING").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null"
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("tasks_title_non_blank_check", sql`btrim(${table.title}) <> ''`),
    check(
      "tasks_due_time_requires_date_check",
      sql`${table.dueTime} IS NULL OR ${table.dueDate} IS NOT NULL`
    ),
    check(
      "tasks_completion_state_check",
      sql`(${table.status} = 'COMPLETED' AND ${table.completedAt} IS NOT NULL) OR (${table.status} <> 'COMPLETED' AND ${table.completedAt} IS NULL)`
    ),
    index("tasks_status_index").on(table.status),
    index("tasks_due_date_index").on(table.dueDate),
    index("tasks_category_id_index").on(table.categoryId)
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
