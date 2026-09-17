import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { applicationPlatformEnum } from "./enums";

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    executablePath: varchar("executable_path", { length: 2048 }).notNull(),
    platform: applicationPlatformEnum("platform").default("WINDOWS").notNull(),
    isFavorite: boolean("is_favorite").default(false).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    lastLaunchedAt: timestamp("last_launched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("applications_name_non_blank_check", sql`btrim(${table.name}) <> ''`),
    check(
      "applications_executable_path_non_blank_check",
      sql`btrim(${table.executablePath}) <> ''`
    ),
    uniqueIndex("applications_executable_path_lower_unique").on(
      sql`lower(btrim(${table.executablePath}))`
    ),
    index("applications_favorite_index").on(table.isFavorite),
    index("applications_enabled_index").on(table.isEnabled)
  ]
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
