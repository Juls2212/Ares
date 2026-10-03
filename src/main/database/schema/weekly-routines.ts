import { sql } from "drizzle-orm";
import { check, index, pgTable, time, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { weekdayEnum } from "./enums";
import { weeklySchedules } from "./weekly-schedules";

export const weeklyRoutines = pgTable(
  "weekly_routines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    weeklyScheduleId: uuid("weekly_schedule_id")
      .notNull()
      .references(() => weeklySchedules.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    weekday: weekdayEnum("weekday").notNull(),
    startTime: time("start_time", { withTimezone: false }).notNull(),
    endTime: time("end_time", { withTimezone: false }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    location: varchar("location", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("weekly_routines_title_non_blank_check", sql`btrim(${table.title}) <> ''`),
    check(
      "weekly_routines_location_non_blank_check",
      sql`${table.location} IS NULL OR btrim(${table.location}) <> ''`
    ),
    check("weekly_routines_time_range_check", sql`${table.endTime} > ${table.startTime}`),
    index("weekly_routines_schedule_weekday_start_time_index").on(
      table.weeklyScheduleId,
      table.weekday,
      table.startTime
    ),
    index("weekly_routines_category_id_index").on(table.categoryId)
  ]
);

export type WeeklyRoutine = typeof weeklyRoutines.$inferSelect;
export type NewWeeklyRoutine = typeof weeklyRoutines.$inferInsert;
