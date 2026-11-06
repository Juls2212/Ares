import { vi } from "vitest";
import { createContactFormBroker, type ContactFormBroker } from "../../src/main/messaging/contact-form-broker";
import {
  MessagingRepositoryError,
  type ContactIdentity,
  type MessagingContactRepository,
  type NewContact
} from "../../src/main/messaging/messaging-contact-repository";
import { createMessagingService, type MessagingService } from "../../src/main/messaging/messaging-service";
import { toLookupKey } from "../../src/main/messaging/messaging-validation";
import type { ContactFormRequest } from "../../src/shared/messaging-contracts";
import type { ChatLaunchResult, WhatsAppChatLauncher } from "../../src/main/messaging/whatsapp-chat-launcher";

type StoredContact = ContactIdentity & { phoneDigits: string };

/** In-memory stand-in for the Drizzle repository: no database is touched. */
export const createFakeMessagingRepository = () => {
  const contacts = new Map<string, StoredContact>();
  let counter = 0;
  const failures = { listIdentities: false, insert: false };

  const toIdentity = ({ phoneDigits: _phone, ...identity }: StoredContact): ContactIdentity => identity;
  const keysOf = (contact: ContactIdentity): string[] => [contact.lookupKey, ...contact.aliases.map((alias) => alias.lookupKey)];

  const repository: MessagingContactRepository = {
    listIdentities: vi.fn(async () => {
      if (failures.listIdentities) throw new Error("boom: SELECT * FROM messaging_contacts");
      return [...contacts.values()].map(toIdentity).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }),
    findIdentity: vi.fn(async (id: string) => {
      const found = contacts.get(id);
      return found ? toIdentity(found) : undefined;
    }),
    findPhoneTail: vi.fn(async (id: string) => contacts.get(id)?.phoneDigits.slice(-4)),
    findPhoneDigits: vi.fn(async (id: string) => contacts.get(id)?.phoneDigits),
    insert: vi.fn(async (input: NewContact) => {
      if (failures.insert) throw new MessagingRepositoryError("UNAVAILABLE");
      const taken = new Set([...contacts.values()].flatMap(keysOf));
      if ([input.lookupKey, ...input.aliases.map((alias) => alias.lookupKey)].some((key) => taken.has(key))) {
        throw new MessagingRepositoryError("CONFLICT");
      }
      const id = `contact-${++counter}`;
      contacts.set(id, { id, displayName: input.displayName, lookupKey: input.lookupKey, aliases: input.aliases, phoneDigits: input.phoneDigits });
      return id;
    }),
    remove: vi.fn(async (id: string) => contacts.delete(id))
  };

  const seed = (displayName: string, phoneDigits: string, aliases: string[] = []): string => {
    const id = `contact-${++counter}`;
    contacts.set(id, {
      id,
      displayName,
      lookupKey: toLookupKey(displayName),
      phoneDigits,
      aliases: aliases.map((alias) => ({ alias, lookupKey: toLookupKey(alias) }))
    });
    return id;
  };

  return { repository, contacts, seed, failures };
};

export type FakeMessagingFlow = ReturnType<typeof createFakeMessagingFlow>;

/** A real service and a real form broker wired to a fake window and an in-memory repository. */
export const createFakeMessagingFlow = (options: { deliverForm?: boolean; launch?: ChatLaunchResult; canCarry?: boolean } = {}) => {
  const open = vi.fn(async (_target: { digits: string; body: string }): Promise<ChatLaunchResult> => options.launch ?? { ok: true });
  const chatLauncher: WhatsAppChatLauncher = { canCarry: vi.fn(() => options.canCarry ?? true), open };
  const repo = createFakeMessagingRepository();
  const requests: ContactFormRequest[] = [];
  let clock = 1_000_000;
  let counter = 0;
  const timers: Array<{ callback: () => void; delay: number; active: boolean }> = [];
  const broker: ContactFormBroker = createContactFormBroker({
    notify: (request) => {
      requests.push(request);
      return options.deliverForm ?? true;
    },
    generateIdentifier: () => `form-${++counter}`,
    setTimer: (callback, delay) => {
      const timer = { callback, delay, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { active: boolean }).active = false;
    },
    logError: vi.fn()
  });
  const logError = vi.fn();
  const service: MessagingService = createMessagingService({
    repository: repo.repository,
    contactForm: broker,
    chatLauncher,
    now: () => clock,
    generateIdentifier: () => `ref-${++counter}`,
    logError
  });
  return {
    ...repo,
    broker,
    service,
    chatLauncher,
    open,
    requests,
    logError,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    /** Fires the form timeout timer that is still active. */
    expireForm: () => {
      for (const timer of timers) {
        if (timer.active) {
          timer.active = false;
          timer.callback();
        }
      }
    },
    /** Starts saving a contact, lets the test answer the form, and returns the pending result. */
    startSave: (input: { contactName: string; aliases?: string[] }) => service.prepareSaveContact(input),
    lastRequest: () => requests[requests.length - 1]
  };
};
