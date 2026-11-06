import { randomUUID } from "node:crypto";
import {
  MAX_LISTED_CONTACTS,
  type MessagingChannel
} from "../../shared/messaging-contracts";
import type { ContactFormBroker } from "./contact-form-broker";
import type { WhatsAppChatLauncher } from "./whatsapp-chat-launcher";
import { createExpiringStore, type ExpiringStore } from "./expiring-store";
import {
  messagingFailure,
  messagingSuccess,
  type MessagingResult
} from "./messaging-failures";
import {
  MessagingRepositoryError,
  type ContactIdentity,
  type MessagingContactRepository
} from "./messaging-contact-repository";
import {
  maskPhoneDigits,
  normalizeContactReference,
  normalizePhoneNumber,
  sanitizeMessageBody,
  validateContactAliases,
  validateContactName,
  type ValidatedContactName
} from "./messaging-validation";

export const PENDING_CONTACT_LIFETIME_MS = 5 * 60 * 1000;
export const MAXIMUM_PENDING_CONTACTS = 8;
export const MESSAGE_DRAFT_LIFETIME_MS = 10 * 60 * 1000;
const MINIMUM_SUBSTRING_LENGTH = 2;

export type ContactResolution =
  | { state: "RESOLVED"; contactId: string; displayName: string }
  | { state: "AMBIGUOUS" }
  | { state: "NONE" }
  | { state: "UNAVAILABLE" };

export type PreparedContact = { pendingId: string; displayName: string; maskedNumber: string };
export type PreparedContactDeletion = { preparedId: string; displayName: string; maskedNumber: string };

/**
 * The single active draft. It stores the contact reference, never a number, so a later phase can open a
 * chat from this exact record without any change to storage.
 */
export type ActiveMessageDraft = {
  contactId: string;
  channel: MessagingChannel;
  body: string;
  createdAt: Date;
};

export type DraftView = { recipientName: string; channel: MessagingChannel; body: string };

type PendingContact = {
  displayName: ValidatedContactName;
  aliases: ValidatedContactName[];
  phoneDigits: string;
};

type StoredDraft = ActiveMessageDraft & { expiresAt: number };

/** Held between the review and the confirmation so a replaced or edited draft can never be opened by mistake. */
type OpenChatSnapshot = { contactId: string; body: string; draftCreatedAt: number };

export type PreparedChatOpening = { preparedId: string; recipientName: string; maskedNumber: string; body: string };

export type MessagingService = {
  prepareSaveContact: (input: { contactName: unknown; aliases?: unknown }) => Promise<MessagingResult<PreparedContact>>;
  commitSaveContact: (pendingId: unknown) => Promise<MessagingResult<{ displayName: string }>>;
  listContacts: () => Promise<MessagingResult<{ contactCount: number; contactNames: string[] }>>;
  prepareDeleteContact: (input: { contactName: unknown }) => Promise<MessagingResult<PreparedContactDeletion>>;
  commitDeleteContact: (preparedId: unknown) => Promise<MessagingResult<{ displayName: string }>>;
  /** Matches a spoken reference against saved contacts: exact name or alias first, then a unique substring. */
  resolveContactReference: (reference: unknown) => Promise<ContactResolution>;
  prepareDraft: (input: { recipient: unknown; body: unknown; channel: unknown }) => Promise<MessagingResult<DraftView>>;
  editDraft: (input: { body: unknown }) => Promise<MessagingResult<DraftView>>;
  discardDraft: () => MessagingResult<{ discarded: true }>;
  /** Takes the review snapshot of the active draft for the confirmed chat launch. */
  prepareOpenChat: () => Promise<MessagingResult<PreparedChatOpening>>;
  /** Re-validates the draft, the contact and the number, opens the chat once and clears the draft. */
  commitOpenChat: (preparedId: unknown) => Promise<MessagingResult<{ recipientName: string }>>;
  /** Forgets a pending contact or prepared deletion that will not be confirmed. */
  releasePrepared: (reference: unknown) => void;
  hasActiveDraft: () => boolean;
  getActiveDraft: () => ActiveMessageDraft | undefined;
  /** Drops every pending contact, prepared deletion and draft; used when the application quits. */
  shutdown: () => void;
};

type MessagingServiceDependencies = {
  repository: MessagingContactRepository;
  contactForm: Pick<ContactFormBroker, "request" | "shutdown">;
  chatLauncher: WhatsAppChatLauncher;
  now: () => number;
  generateIdentifier: () => string;
  logError: (message: string) => void;
};

const allKeys = (identity: ContactIdentity): string[] => [identity.lookupKey, ...identity.aliases.map((alias) => alias.lookupKey)];

export const createMessagingService = (
  overrides: Partial<MessagingServiceDependencies> & Pick<MessagingServiceDependencies, "repository" | "contactForm" | "chatLauncher">
): MessagingService => {
  const dependencies: MessagingServiceDependencies = {
    now: () => Date.now(),
    generateIdentifier: randomUUID,
    logError: (message) => console.error(message),
    ...overrides
  };
  const storeOptions = {
    lifetimeMs: PENDING_CONTACT_LIFETIME_MS,
    maximumEntries: MAXIMUM_PENDING_CONTACTS,
    now: dependencies.now,
    generateIdentifier: dependencies.generateIdentifier
  };
  const pendingContacts: ExpiringStore<PendingContact> = createExpiringStore<PendingContact>(storeOptions);
  const preparedDeletions: ExpiringStore<{ contactId: string }> = createExpiringStore<{ contactId: string }>(storeOptions);
  const openSnapshots: ExpiringStore<OpenChatSnapshot> = createExpiringStore<OpenChatSnapshot>(storeOptions);
  let draft: StoredDraft | undefined;

  /**
   * Any repository failure becomes the one closed storage category. The log line carries only a fixed stage
   * name and the repository's safe category: never SQL, table or constraint names, values or the raw error.
   */
  const storageFailure = (stage: "lookup" | "save" | "delete" | "draft" | "open", error: unknown) => {
    const category = error instanceof MessagingRepositoryError ? error.category : "OTHER";
    dependencies.logError(`Messaging storage unavailable [stage=${stage}, category=${category}].`);
    return messagingFailure("MESSAGING_STORAGE_UNAVAILABLE");
  };

  const readIdentities = async (): Promise<MessagingResult<ContactIdentity[]>> => {
    try {
      return messagingSuccess(await dependencies.repository.listIdentities());
    } catch (error) {
      return storageFailure("lookup", error);
    }
  };

  /** A new name or alias may not equal any saved name or alias, nor another entry of the same contact. */
  const findCollision = (
    identities: readonly ContactIdentity[],
    name: ValidatedContactName,
    aliases: readonly ValidatedContactName[]
  ): "MESSAGING_CONTACT_EXISTS" | "MESSAGING_ALIAS_EXISTS" | undefined => {
    const taken = new Set(identities.flatMap(allKeys));
    if (taken.has(name.lookupKey)) return "MESSAGING_CONTACT_EXISTS";
    const seen = new Set([name.lookupKey]);
    for (const alias of aliases) {
      if (taken.has(alias.lookupKey) || seen.has(alias.lookupKey)) return "MESSAGING_ALIAS_EXISTS";
      seen.add(alias.lookupKey);
    }
    return undefined;
  };

  const resolveFromIdentities = (identities: readonly ContactIdentity[], reference: unknown): ContactResolution => {
    const key = normalizeContactReference(reference);
    if (key === undefined) return { state: "NONE" };
    const exact = identities.filter((identity) => allKeys(identity).includes(key));
    if (exact.length === 1) return { state: "RESOLVED", contactId: exact[0].id, displayName: exact[0].displayName };
    if (exact.length > 1) return { state: "AMBIGUOUS" };
    if (key.length < MINIMUM_SUBSTRING_LENGTH) return { state: "NONE" };
    const partial = identities.filter((identity) => allKeys(identity).some((candidate) => candidate.includes(key)));
    if (partial.length === 1) return { state: "RESOLVED", contactId: partial[0].id, displayName: partial[0].displayName };
    return partial.length > 1 ? { state: "AMBIGUOUS" } : { state: "NONE" };
  };

  const resolveContactReference: MessagingService["resolveContactReference"] = async (reference) => {
    const identities = await readIdentities();
    return identities.ok ? resolveFromIdentities(identities.data, reference) : { state: "UNAVAILABLE" };
  };

  const activeDraft = (): StoredDraft | undefined => {
    if (draft && draft.expiresAt <= dependencies.now()) draft = undefined;
    return draft;
  };

  const toFailureFromResolution = (resolution: ContactResolution) =>
    resolution.state === "AMBIGUOUS"
      ? messagingFailure("MESSAGING_CONTACT_AMBIGUOUS")
      : resolution.state === "UNAVAILABLE"
        ? messagingFailure("MESSAGING_STORAGE_UNAVAILABLE")
        : messagingFailure("MESSAGING_CONTACT_NOT_FOUND");

  const storeDraft = (contactId: string, channel: MessagingChannel, body: string, createdAt: Date): void => {
    draft = { contactId, channel, body, createdAt, expiresAt: dependencies.now() + MESSAGE_DRAFT_LIFETIME_MS };
  };

  return {
    prepareSaveContact: async (input) => {
      const name = validateContactName(input.contactName);
      if (!name.ok) return name;
      const aliases = validateContactAliases(input.aliases);
      if (!aliases.ok) return aliases;
      const identities = await readIdentities();
      if (!identities.ok) return identities;
      const collision = findCollision(identities.data, name.data, aliases.data);
      if (collision) return messagingFailure(collision);

      const outcome = await dependencies.contactForm.request<PreparedContact>({
        displayName: name.data.displayName,
        validate: async (submission) => {
          const submittedName = validateContactName(submission.displayName);
          if (!submittedName.ok) return submittedName;
          const phone = normalizePhoneNumber(submission.phone);
          if (!phone.ok) return phone;
          const current = await readIdentities();
          if (!current.ok) return current;
          const conflict = findCollision(current.data, submittedName.data, aliases.data);
          if (conflict) return messagingFailure(conflict);
          const pendingId = pendingContacts.put({
            displayName: submittedName.data,
            aliases: aliases.data,
            phoneDigits: phone.data
          });
          return messagingSuccess({
            pendingId,
            displayName: submittedName.data.displayName,
            maskedNumber: maskPhoneDigits(phone.data)
          });
        }
      });
      if (outcome.status === "SUBMITTED") return messagingSuccess(outcome.value);
      if (outcome.status === "CANCELLED") return messagingFailure("MESSAGING_FORM_CANCELLED");
      if (outcome.status === "EXPIRED") return messagingFailure("MESSAGING_PENDING_EXPIRED");
      return messagingFailure("MESSAGING_OPERATION_FAILED");
    },
    commitSaveContact: async (pendingId) => {
      const pending = pendingContacts.take(pendingId);
      if (!pending) return messagingFailure("MESSAGING_PENDING_EXPIRED");
      // The pending contact is re-validated at confirmation: another contact may have taken the name since.
      const name = validateContactName(pending.displayName.displayName);
      const phone = normalizePhoneNumber(`+${pending.phoneDigits}`);
      if (!name.ok || !phone.ok) return messagingFailure("MESSAGING_OPERATION_FAILED");
      const identities = await readIdentities();
      if (!identities.ok) return identities;
      const collision = findCollision(identities.data, name.data, pending.aliases);
      if (collision) return messagingFailure(collision);
      try {
        await dependencies.repository.insert({
          displayName: name.data.displayName,
          lookupKey: name.data.lookupKey,
          phoneDigits: phone.data,
          aliases: pending.aliases.map((alias) => ({ alias: alias.displayName, lookupKey: alias.lookupKey }))
        });
      } catch (error) {
        if (error instanceof MessagingRepositoryError && error.kind === "CONFLICT") {
          return messagingFailure("MESSAGING_CONTACT_EXISTS");
        }
        return storageFailure("save", error);
      }
      return messagingSuccess({ displayName: name.data.displayName });
    },
    listContacts: async () => {
      const identities = await readIdentities();
      if (!identities.ok) return identities;
      return messagingSuccess({
        contactCount: identities.data.length,
        contactNames: identities.data.slice(0, MAX_LISTED_CONTACTS).map((identity) => identity.displayName)
      });
    },
    prepareDeleteContact: async (input) => {
      const resolution = await resolveContactReference(input.contactName);
      if (resolution.state !== "RESOLVED") return toFailureFromResolution(resolution);
      let tail: string | undefined;
      try {
        tail = await dependencies.repository.findPhoneTail(resolution.contactId);
      } catch (error) {
        return storageFailure("delete", error);
      }
      if (!tail) return messagingFailure("MESSAGING_CONTACT_NOT_FOUND");
      const preparedId = preparedDeletions.put({ contactId: resolution.contactId });
      return messagingSuccess({ preparedId, displayName: resolution.displayName, maskedNumber: `•••• ${tail}` });
    },
    commitDeleteContact: async (preparedId) => {
      const prepared = preparedDeletions.take(preparedId);
      if (!prepared) return messagingFailure("MESSAGING_PENDING_EXPIRED");
      try {
        const identity = await dependencies.repository.findIdentity(prepared.contactId);
        if (!identity) return messagingFailure("MESSAGING_CONTACT_NOT_FOUND");
        if (!(await dependencies.repository.remove(prepared.contactId))) {
          return messagingFailure("MESSAGING_CONTACT_NOT_FOUND");
        }
        if (draft?.contactId === prepared.contactId) draft = undefined;
        return messagingSuccess({ displayName: identity.displayName });
      } catch (error) {
        return storageFailure("delete", error);
      }
    },
    resolveContactReference,
    prepareDraft: async (input) => {
      if (input.channel !== "WHATSAPP") return messagingFailure("MESSAGING_UNSUPPORTED_CHANNEL");
      const body = sanitizeMessageBody(input.body);
      if (!body.ok) return body;
      const resolution = await resolveContactReference(input.recipient);
      if (resolution.state !== "RESOLVED") return toFailureFromResolution(resolution);
      storeDraft(resolution.contactId, "WHATSAPP", body.data, new Date(dependencies.now()));
      return messagingSuccess({ recipientName: resolution.displayName, channel: "WHATSAPP", body: body.data });
    },
    editDraft: async (input) => {
      const current = activeDraft();
      if (!current) return messagingFailure("MESSAGING_NO_DRAFT");
      const body = sanitizeMessageBody(input.body);
      if (!body.ok) return body;
      let identity: ContactIdentity | undefined;
      try {
        identity = await dependencies.repository.findIdentity(current.contactId);
      } catch (error) {
        return storageFailure("draft", error);
      }
      if (!identity) {
        draft = undefined;
        return messagingFailure("MESSAGING_NO_DRAFT");
      }
      storeDraft(current.contactId, current.channel, body.data, current.createdAt);
      return messagingSuccess({ recipientName: identity.displayName, channel: current.channel, body: body.data });
    },
    discardDraft: () => {
      if (!activeDraft()) return messagingFailure("MESSAGING_NO_DRAFT");
      draft = undefined;
      return messagingSuccess({ discarded: true });
    },
    prepareOpenChat: async () => {
      const current = activeDraft();
      if (!current) return messagingFailure("MESSAGING_NO_DRAFT");
      try {
        const identity = await dependencies.repository.findIdentity(current.contactId);
        const tail = identity ? await dependencies.repository.findPhoneTail(current.contactId) : undefined;
        if (!identity || !tail) {
          draft = undefined;
          return messagingFailure("MESSAGING_CONTACT_NOT_FOUND");
        }
        if (!dependencies.chatLauncher.canCarry(current.body)) return messagingFailure("MESSAGING_BODY_TOO_LONG_FOR_LINK");
        const preparedId = openSnapshots.put({
          contactId: current.contactId,
          body: current.body,
          draftCreatedAt: current.createdAt.getTime()
        });
        return messagingSuccess({ preparedId, recipientName: identity.displayName, maskedNumber: `•••• ${tail}`, body: current.body });
      } catch (error) {
        return storageFailure("open", error);
      }
    },
    commitOpenChat: async (preparedId) => {
      const snapshot = openSnapshots.take(preparedId);
      if (!snapshot) return messagingFailure("MESSAGING_PENDING_EXPIRED");
      const current = activeDraft();
      if (!current) return messagingFailure("MESSAGING_NO_DRAFT");
      if (
        current.contactId !== snapshot.contactId ||
        current.body !== snapshot.body ||
        current.createdAt.getTime() !== snapshot.draftCreatedAt
      ) {
        return messagingFailure("MESSAGING_DRAFT_CHANGED");
      }
      let identity: ContactIdentity | undefined;
      let stored: string | undefined;
      try {
        identity = await dependencies.repository.findIdentity(current.contactId);
        stored = identity ? await dependencies.repository.findPhoneDigits(current.contactId) : undefined;
      } catch (error) {
        return storageFailure("open", error);
      }
      if (!identity) {
        draft = undefined;
        return messagingFailure("MESSAGING_CONTACT_NOT_FOUND");
      }
      try {
        const phone = stored === undefined ? undefined : normalizePhoneNumber(`+${stored}`);
        if (!phone?.ok) return messagingFailure("MESSAGING_INVALID_PHONE");
        const launched = await dependencies.chatLauncher.open({ digits: phone.data, body: current.body });
        if (!launched.ok) {
          return messagingFailure(
            launched.reason === "TOO_LONG" ? "MESSAGING_BODY_TOO_LONG_FOR_LINK" : launched.reason === "OPEN_FAILED" ? "MESSAGING_OPEN_FAILED" : "MESSAGING_INVALID_PHONE"
          );
        }
        // Opened: clear the draft so a repeated request cannot reopen the same chat by accident.
        draft = undefined;
        return messagingSuccess({ recipientName: identity.displayName });
      } catch {
        dependencies.logError("Messaging chat launch failed.");
        return messagingFailure("MESSAGING_OPEN_FAILED");
      }
    },
    releasePrepared: (reference) => {
      pendingContacts.take(reference);
      preparedDeletions.take(reference);
      openSnapshots.take(reference);
    },
    hasActiveDraft: () => activeDraft() !== undefined,
    getActiveDraft: () => {
      const current = activeDraft();
      return current
        ? { contactId: current.contactId, channel: current.channel, body: current.body, createdAt: current.createdAt }
        : undefined;
    },
    shutdown: () => {
      pendingContacts.clear();
      preparedDeletions.clear();
      openSnapshots.clear();
      draft = undefined;
      dependencies.contactForm.shutdown();
    }
  };
};
