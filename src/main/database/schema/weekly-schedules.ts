import { sql } from "drizzle-orm";
import { check, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const weeklySchedules = pgTable(
  "weekly_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 240 }).notNull(),
    description: varchar("description", { length: 4000 }),
    color: varchar("color", { length: 7 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("weekly_schedules_title_lower_unique").on(sql`lower(btrim(${table.title}))`),
    check("weekly_schedules_title_non_blank_check", sql`btrim(${table.title}) <> ''`),
    check(
      "weekly_schedules_description_non_blank_check",
      sql`${table.description} IS NULL OR btrim(${table.description}) <> ''`
    ),
    check(
      "weekly_schedules_color_format_check",
      sql`${table.color} IS NULL OR ${table.color} ~ '^#[0-9A-Fa-f]{6}$'`
    )
  ]
);

export type WeeklySchedule = typeof weeklySchedules.$inferSelect;
export type NewWeeklySchedule = typeof weeklySchedules.$inferInsert;
