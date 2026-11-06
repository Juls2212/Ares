import { asc, eq, inArray } from "drizzle-orm";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { messagingContactAliases, messagingContacts } from "../database/schema";

/** Everything the matching logic needs. The phone number is deliberately absent from this shape. */
export type ContactIdentity = {
  id: string;
  displayName: string;
  lookupKey: string;
  aliases: Array<{ alias: string; lookupKey: string }>;
};

export type NewContact = {
  displayName: string;
  lookupKey: string;
  phoneDigits: string;
  aliases: Array<{ alias: string; lookupKey: string }>;
};

/**
 * A closed, safe label for why storage failed. It is derived only from the driver's SQLSTATE or network code and
 * never carries SQL, table or constraint names, parameters or the original message, so it can be logged.
 */
export type StorageFailureCategory = "SCHEMA_MISSING" | "SCHEMA_MISMATCH" | "CONSTRAINT" | "CONNECTION" | "OTHER";

export class MessagingRepositoryError extends Error {
  public constructor(
    public readonly kind: "CONFLICT" | "UNAVAILABLE",
    public readonly category: StorageFailureCategory = "OTHER"
  ) {
    super("Messaging persistence operation failed.");
  }
}

export type MessagingContactRepository = {
  listIdentities: () => Promise<ContactIdentity[]>;
  findIdentity: (contactId: string) => Promise<ContactIdentity | undefined>;
  /** The last four digits only, for the masked review label. The full number never leaves the repository. */
  findPhoneTail: (contactId: string) => Promise<string | undefined>;
  /** Digits for the one confirmed chat launch; only the service passes them on, and only to the launcher. */
  findPhoneDigits: (contactId: string) => Promise<string | undefined>;
  insert: (contact: NewContact) => Promise<string>;
  remove: (contactId: string) => Promise<boolean>;
};

const UNIQUE_VIOLATION = "23505";
const PHONE_TAIL_LENGTH = 4;
const MAXIMUM_CAUSE_DEPTH = 4;

/** Drizzle wraps the driver error in a query error whose `cause` holds the original; walk the chain. */
const driverCode = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < MAXIMUM_CAUSE_DEPTH && typeof current === "object" && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0 && code.length <= 16) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

const isUniqueViolation = (error: unknown): boolean => driverCode(error) === UNIQUE_VIOLATION;

const NETWORK_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE"]);

/** Maps a driver error to a closed category; unknown shapes are «OTHER». */
export const classifyStorageError = (error: unknown): StorageFailureCategory => {
  const code = driverCode(error);
  if (code === undefined) return "OTHER";
  if (code === "42P01") return "SCHEMA_MISSING";
  if (code === "42703" || code === "42704" || code === "42883" || code === "42P07") return "SCHEMA_MISMATCH";
  if (code.startsWith("23")) return "CONSTRAINT";
  if (NETWORK_CODES.has(code) || code.startsWith("08") || code.startsWith("28") || code === "3D000" || code.startsWith("57P") || code === "53300") {
    return "CONNECTION";
  }
  return "OTHER";
};

/** Every driver failure leaves the repository as one error type with a safe category; nothing else escapes. */
const guard = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MessagingRepositoryError) throw error;
    throw new MessagingRepositoryError(isUniqueViolation(error) ? "CONFLICT" : "UNAVAILABLE", classifyStorageError(error));
  }
};

export const createMessagingContactRepository = (
  database: AresDatabase = getDatabase()
): MessagingContactRepository => {
  const toIdentities = async (
    contacts: Array<typeof messagingContacts.$inferSelect>
  ): Promise<ContactIdentity[]> => {
    if (contacts.length === 0) return [];
    const aliases = await database
      .select()
      .from(messagingContactAliases)
      .where(inArray(messagingContactAliases.contactId, contacts.map((contact) => contact.id)));
    return contacts.map((contact) => ({
      id: contact.id,
      displayName: contact.displayName,
      lookupKey: contact.lookupKey,
      aliases: aliases
        .filter((alias) => alias.contactId === contact.id)
        .map((alias) => ({ alias: alias.alias, lookupKey: alias.lookupKey }))
    }));
  };

  return {
    listIdentities: () =>
      guard(async () => toIdentities(await database.select().from(messagingContacts).orderBy(asc(messagingContacts.displayName)))),
    findIdentity: (contactId) =>
      guard(async () => {
        const [contact] = await database.select().from(messagingContacts).where(eq(messagingContacts.id, contactId)).limit(1);
        return contact ? (await toIdentities([contact]))[0] : undefined;
      }),
    findPhoneTail: (contactId) =>
      guard(async () => {
        const [contact] = await database
          .select({ phoneDigits: messagingContacts.phoneDigits })
          .from(messagingContacts)
          .where(eq(messagingContacts.id, contactId))
          .limit(1);
        return contact?.phoneDigits.slice(-PHONE_TAIL_LENGTH);
      }),
    findPhoneDigits: (contactId) =>
      guard(async () => {
        const [contact] = await database
          .select({ phoneDigits: messagingContacts.phoneDigits })
          .from(messagingContacts)
          .where(eq(messagingContacts.id, contactId))
          .limit(1);
        return contact?.phoneDigits;
      }),
    insert: (contact) =>
      guard(() =>
        database.transaction(async (transaction) => {
          const [created] = await transaction
            .insert(messagingContacts)
            .values({
              displayName: contact.displayName,
              lookupKey: contact.lookupKey,
              phoneDigits: contact.phoneDigits
            })
            .returning({ id: messagingContacts.id });
          if (contact.aliases.length > 0) {
            await transaction.insert(messagingContactAliases).values(
              contact.aliases.map((alias) => ({ contactId: created.id, alias: alias.alias, lookupKey: alias.lookupKey }))
            );
          }
          return created.id;
        })
      ),
    remove: (contactId) =>
      guard(async () => {
        const removed = await database
          .delete(messagingContacts)
          .where(eq(messagingContacts.id, contactId))
          .returning({ id: messagingContacts.id });
        return removed.length > 0;
      })
  };
};
