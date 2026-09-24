import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";

/**
 * A durable, at-most-once claim for an event start instant. It intentionally
 * stores no notification content or technical failure details.
 */
export const eventNotificationDeliveries = pgTable(
  "event_notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("event_notification_deliveries_event_scheduled_unique").on(
      table.eventId,
      table.scheduledAt
    )
  ]
);

export type EventNotificationDelivery = typeof eventNotificationDeliveries.$inferSelect;
export type NewEventNotificationDelivery = typeof eventNotificationDeliveries.$inferInsert;
