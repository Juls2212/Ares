import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

/** Saved contacts. The phone number is stored as digits only and is never returned to a renderer. */
export const messagingContacts = pgTable(
  "messaging_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    displayName: varchar("display_name", { length: 40 }).notNull(),
    lookupKey: varchar("lookup_key", { length: 80 }).notNull(),
    phoneDigits: varchar("phone_digits", { length: 15 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("messaging_contacts_display_name_non_blank_check", sql`btrim(${table.displayName}) <> ''`),
    check("messaging_contacts_lookup_key_non_blank_check", sql`btrim(${table.lookupKey}) <> ''`),
    check("messaging_contacts_phone_digits_format_check", sql`${table.phoneDigits} ~ '^[1-9][0-9]{7,14}$'`),
    uniqueIndex("messaging_contacts_lookup_key_unique").on(table.lookupKey)
  ]
);

export const messagingContactAliases = pgTable(
  "messaging_contact_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => messagingContacts.id, { onDelete: "cascade" }),
    alias: varchar("alias", { length: 40 }).notNull(),
    lookupKey: varchar("lookup_key", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("messaging_contact_aliases_alias_non_blank_check", sql`btrim(${table.alias}) <> ''`),
    check("messaging_contact_aliases_lookup_key_non_blank_check", sql`btrim(${table.lookupKey}) <> ''`),
    uniqueIndex("messaging_contact_aliases_lookup_key_unique").on(table.lookupKey),
    index("messaging_contact_aliases_contact_id_index").on(table.contactId)
  ]
);

export type MessagingContact = typeof messagingContacts.$inferSelect;
export type NewMessagingContact = typeof messagingContacts.$inferInsert;
export type MessagingContactAlias = typeof messagingContactAliases.$inferSelect;
export type NewMessagingContactAlias = typeof messagingContactAliases.$inferInsert;
