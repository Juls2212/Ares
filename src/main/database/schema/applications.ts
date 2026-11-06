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
import {
  applicationCatalogKeyEnum,
  applicationLaunchModeEnum,
  applicationPlatformEnum
} from "./enums";

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    executablePath: varchar("executable_path", { length: 2048 }),
    platform: applicationPlatformEnum("platform").default("WINDOWS").notNull(),
    launchMode: applicationLaunchModeEnum("launch_mode")
      .default("WINDOWS_EXECUTABLE")
      .notNull(),
    catalogKey: applicationCatalogKeyEnum("catalog_key"),
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
      sql`(${table.launchMode} = 'WINDOWS_EXECUTABLE' AND btrim(${table.executablePath}) <> '') OR (${table.launchMode} = 'CATALOG_APPLICATION' AND ${table.executablePath} IS NULL)`
    ),
    check(
      "applications_launch_target_check",
      sql`(${table.launchMode} = 'WINDOWS_EXECUTABLE' AND ${table.platform} = 'WINDOWS' AND ${table.catalogKey} IS NULL) OR (${table.launchMode} = 'CATALOG_APPLICATION' AND ${table.catalogKey} IS NOT NULL AND ${table.executablePath} IS NULL)`
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
