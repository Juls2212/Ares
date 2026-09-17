import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const settings = pgTable(
  "settings",
  {
    settingKey: varchar("setting_key", { length: 100 }).primaryKey(),
    value: jsonb("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check(
      "settings_key_format_check",
      sql`${table.settingKey} ~ '^[a-z][a-z0-9_]*$'`
    )
  ]
);

export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
