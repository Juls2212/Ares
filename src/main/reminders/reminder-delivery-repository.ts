import { and, asc, eq, lte } from "drizzle-orm";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { reminders } from "../database/schema";

export type DueReminder = {
  id: string;
  title: string;
  remindAt: Date;
};

export class ReminderDeliveryRepositoryError extends Error {
  public constructor() {
    super("Reminder delivery persistence failed.");
    this.name = "ReminderDeliveryRepositoryError";
  }
}

export type ReminderDeliveryRepository = {
  listDuePending: (now: Date, limit: number) => Promise<DueReminder[]>;
  claimPending: (reminderId: string, deliveredAt: Date) => Promise<DueReminder | undefined>;
};

const mapDueReminder = (record: {
  id: string;
  title: string;
  remindAt: Date;
}): DueReminder => ({
  id: record.id,
  title: record.title,
  remindAt: record.remindAt
});

const executePersistence = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new ReminderDeliveryRepositoryError();
  }
};

/**
 * Claims are conditional updates, not read-then-write transitions. A second
 * scheduler can discover the same pending reminder but cannot claim it after
 * the first successful update changes its status.
 */
export const createReminderDeliveryRepository = (
  database: AresDatabase = getDatabase()
): ReminderDeliveryRepository => ({
  listDuePending: async (now, limit) =>
    executePersistence(async () => {
      const records = await database
        .select({ id: reminders.id, title: reminders.title, remindAt: reminders.remindAt })
        .from(reminders)
        .where(and(eq(reminders.status, "PENDING"), lte(reminders.remindAt, now)))
        .orderBy(asc(reminders.remindAt), asc(reminders.createdAt), asc(reminders.id))
        .limit(limit);
      return records.map(mapDueReminder);
    }),
  claimPending: async (reminderId, deliveredAt) =>
    executePersistence(async () => {
      const [record] = await database
        .update(reminders)
        .set({
          status: "TRIGGERED",
          deliveredAt,
          updatedAt: deliveredAt
        })
        .where(
          and(
            eq(reminders.id, reminderId),
            eq(reminders.status, "PENDING"),
            lte(reminders.remindAt, deliveredAt)
          )
        )
        .returning({ id: reminders.id, title: reminders.title, remindAt: reminders.remindAt });
      return record ? mapDueReminder(record) : undefined;
    })
});
