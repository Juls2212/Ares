import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { eventNotificationDeliveries, events } from "../database/schema";

export type DueEvent = {
  id: string;
  title: string;
  startAt: Date;
};

export class EventDeliveryRepositoryError extends Error {
  public constructor() {
    super("Event delivery persistence failed.");
    this.name = "EventDeliveryRepositoryError";
  }
}

export type EventDeliveryRepository = {
  listDueUnclaimed: (windowStart: Date, now: Date, limit: number) => Promise<DueEvent[]>;
  claimEventStart: (eventId: string, scheduledAt: Date, deliveredAt: Date) => Promise<boolean>;
};

const mapDueEvent = (record: { id: string; title: string; startAt: Date }): DueEvent => ({
  id: record.id,
  title: record.title,
  startAt: record.startAt
});

const executePersistence = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new EventDeliveryRepositoryError();
  }
};

/**
 * The claim is one INSERT ... SELECT statement. The event must still have the
 * selected start instant, and the unique delivery index admits only one claim.
 */
export const createEventDeliveryRepository = (
  database: AresDatabase = getDatabase()
): EventDeliveryRepository => ({
  listDueUnclaimed: async (windowStart, now, limit) =>
    executePersistence(async () => {
      const records = await database
        .select({ id: events.id, title: events.title, startAt: events.startAt })
        .from(events)
        .leftJoin(
          eventNotificationDeliveries,
          and(
            eq(eventNotificationDeliveries.eventId, events.id),
            eq(eventNotificationDeliveries.scheduledAt, events.startAt)
          )
        )
        .where(
          and(
            gte(events.startAt, windowStart),
            lte(events.startAt, now),
            isNull(eventNotificationDeliveries.id)
          )
        )
        .orderBy(asc(events.startAt), asc(events.id))
        .limit(limit);
      return records.map(mapDueEvent);
    }),
  claimEventStart: async (eventId, scheduledAt, deliveredAt) =>
    executePersistence(async () => {
      const selectedEvent = database
        .select({
          id: sql<string>`gen_random_uuid()`.as("id"),
          eventId: events.id,
          scheduledAt: events.startAt,
          deliveredAt: sql<Date>`${deliveredAt}`.as("delivered_at")
        })
        .from(events)
        .where(and(eq(events.id, eventId), eq(events.startAt, scheduledAt)));

      const claimed = await database
        .insert(eventNotificationDeliveries)
        .select(selectedEvent)
        .onConflictDoNothing()
        .returning({ id: eventNotificationDeliveries.id });
      return claimed.length === 1;
    })
});
