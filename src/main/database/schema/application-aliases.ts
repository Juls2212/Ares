import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { applications } from "./applications";

export const applicationAliases = pgTable(
  "application_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    alias: varchar("alias", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("application_aliases_alias_non_blank_check", sql`btrim(${table.alias}) <> ''`),
    uniqueIndex("application_aliases_alias_lower_unique").on(
      sql`lower(btrim(${table.alias}))`
    ),
    index("application_aliases_application_id_index").on(table.applicationId)
  ]
);

export type ApplicationAlias = typeof applicationAliases.$inferSelect;
export type NewApplicationAlias = typeof applicationAliases.$inferInsert;
