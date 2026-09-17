import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { reminderStatusEnum } from "./enums";
import { events } from "./events";
import { tasks } from "./tasks";

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 240 }).notNull(),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    status: reminderStatusEnum("status").default("PENDING").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("reminders_title_non_blank_check", sql`btrim(${table.title}) <> ''`),
    check(
      "reminders_single_association_check",
      sql`NOT (${table.taskId} IS NOT NULL AND ${table.eventId} IS NOT NULL)`
    ),
    check(
      "reminders_delivery_state_check",
      sql`(${table.status} = 'TRIGGERED' AND ${table.deliveredAt} IS NOT NULL) OR (${table.status} <> 'TRIGGERED' AND ${table.deliveredAt} IS NULL)`
    ),
    index("reminders_pending_remind_at_index")
      .on(table.remindAt)
      .where(sql`${table.status} = 'PENDING'`),
    index("reminders_task_id_index").on(table.taskId),
    index("reminders_event_id_index").on(table.eventId)
  ]
);

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
