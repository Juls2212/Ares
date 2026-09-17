import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { categories } from "./categories";

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 240 }).notNull(),
    description: varchar("description", { length: 4000 }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null"
    }),
    location: varchar("location", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("events_title_non_blank_check", sql`btrim(${table.title}) <> ''`),
    check(
      "events_time_range_check",
      sql`${table.endAt} IS NULL OR ${table.endAt} > ${table.startAt}`
    ),
    index("events_start_at_index").on(table.startAt),
    index("events_category_id_index").on(table.categoryId)
  ]
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
