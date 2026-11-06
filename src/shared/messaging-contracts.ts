import type { OperationResult } from "./contracts";

/**
 * MESSAGING domain contracts. The only channel is WHATSAPP and nothing here opens, sends or composes
 * a link. A phone number never appears in any action input or output: it travels only through the
 * dedicated contact form channels below and stays in Main.
 */
export const MESSAGING_CHANNELS = ["WHATSAPP"] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export const MAX_CONTACT_NAME_LENGTH = 40;
export const MAX_CONTACT_ALIASES = 3;
export const MAX_MESSAGE_BODY_LENGTH = 1_000;
export const MAX_LISTED_CONTACTS = 20;

export type SaveContactInput = {
  contactName: string;
  aliases?: string[];
};

/** Main-only shape after the contact form ran: the opaque reference never comes from a caller. */
export type PreparedSaveContactInput = SaveContactInput & { pendingId: string };

export type ListContactsInput = Record<string, never>;

export type DeleteContactInput = { contactName: string };
export type PreparedDeleteContactInput = DeleteContactInput & { preparedId: string };

export type PrepareMessageDraftInput = {
  recipient: string;
  body: string;
  channel: MessagingChannel;
};

/** The action always refers to the single active draft; the caller supplies nothing. */
export type OpenWhatsAppChatWithDraftInput = Record<string, never>;
/** Main-only shape after the review snapshot was taken: the opaque reference never comes from a caller. */
export type PreparedOpenWhatsAppChatInput = { preparedId: string };

export type EditMessageDraftInput = { body: string };
export type DiscardMessageDraftInput = Record<string, never>;

/** Safe terminal data. Names and the draft text are user content; a phone number is never included. */
export type MessagingActionData =
  | { kind: "CONTACT_SAVED"; contactName: string }
  | { kind: "CONTACT_DELETED"; contactName: string }
  | { kind: "CONTACT_LIST"; contactCount: number; contactNames: string[] }
  | { kind: "DRAFT_READY"; recipientName: string; channel: MessagingChannel; body: string }
  | { kind: "DRAFT_DISCARDED" }
  | { kind: "CHAT_OPENED"; recipientName: string };

/** The renderer receives only a friendly name for the Main-initiated contact form. */
export type ContactFormRequest = {
  requestId: string;
  displayName: string;
};

/** The one place a phone number leaves the renderer: the form's own field. */
export type ContactFormSubmission = {
  requestId: string;
  displayName: string;
  phone: string;
};

export type ContactFormCancellation = {
  requestId: string;
};

export type ContactFormSubmissionData = { status: "ACCEPTED" };
export type ContactFormCancellationData = { status: "CANCELLED" };

export type MessagingOperationResult<T> = OperationResult<T>;

export type MessagingApi = {
  onContactFormRequested: (callback: (request: ContactFormRequest) => void) => () => void;
  submitContactForm: (
    input: ContactFormSubmission
  ) => Promise<MessagingOperationResult<ContactFormSubmissionData>>;
  cancelContactForm: (
    input: ContactFormCancellation
  ) => Promise<MessagingOperationResult<ContactFormCancellationData>>;
};
