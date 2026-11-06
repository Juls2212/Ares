import { randomUUID } from "node:crypto";
import type {
  ContactFormCancellationData,
  ContactFormRequest,
  ContactFormSubmissionData,
  MessagingOperationResult
} from "../../shared/messaging-contracts";
import { messagingFailure, type MessagingFailure, type MessagingResult } from "./messaging-failures";

export const CONTACT_FORM_LIFETIME_MS = 5 * 60 * 1000;
const MAX_FORM_NAME_LENGTH = 80;
const MAX_FORM_PHONE_LENGTH = 40;

export type ContactFormSubmissionValues = { displayName: string; phone: string };

export type ContactFormOutcome<T> =
  | { status: "SUBMITTED"; value: T }
  | { status: "CANCELLED" }
  | { status: "EXPIRED" }
  | { status: "UNAVAILABLE" };

export type ContactFormBroker = {
  /**
   * Asks the renderer to show the contact form and waits for one submission or a cancellation. The
   * validator runs in Main on every submission; a rejected submission keeps the form open.
   */
  request: <T>(input: {
    displayName: string;
    validate: (submission: ContactFormSubmissionValues) => Promise<MessagingResult<T>>;
  }) => Promise<ContactFormOutcome<T>>;
  submit: (input: unknown) => Promise<MessagingOperationResult<ContactFormSubmissionData>>;
  cancel: (input: unknown) => Promise<MessagingOperationResult<ContactFormCancellationData>>;
  /** Resolves any waiting request as cancelled; used when the application quits. */
  shutdown: () => void;
};

type ContactFormBrokerDependencies = {
  /** Sends the request to the trusted window. It returns false when no window can show the form. */
  notify: (request: ContactFormRequest) => boolean;
  generateIdentifier: () => string;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
  logError: (message: string) => void;
};

type PendingForm = {
  requestId: string;
  validate: (submission: ContactFormSubmissionValues) => Promise<MessagingResult<unknown>>;
  settle: (outcome: ContactFormOutcome<unknown>) => void;
  timer: unknown;
  validating: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));

const toFailure = <T>(failure: MessagingFailure): MessagingOperationResult<T> => ({ ok: false, error: failure.error });

export const createContactFormBroker = (
  dependencies: Partial<ContactFormBrokerDependencies> & Pick<ContactFormBrokerDependencies, "notify">
): ContactFormBroker => {
  const resolved: ContactFormBrokerDependencies = {
    generateIdentifier: randomUUID,
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    logError: (message) => console.error(message),
    ...dependencies
  };
  let pending: PendingForm | undefined;

  const finish = (form: PendingForm, outcome: ContactFormOutcome<unknown>): void => {
    if (pending === form) pending = undefined;
    resolved.clearTimer(form.timer);
    form.settle(outcome);
  };

  return {
    request: <T>(input: {
      displayName: string;
      validate: (submission: ContactFormSubmissionValues) => Promise<MessagingResult<T>>;
    }) =>
      new Promise<ContactFormOutcome<T>>((resolve) => {
        if (pending && !pending.validating) finish(pending, { status: "CANCELLED" });
        const requestId = resolved.generateIdentifier();
        const form: PendingForm = {
          requestId,
          validate: input.validate,
          settle: (outcome) => resolve(outcome as ContactFormOutcome<T>),
          timer: undefined,
          validating: false
        };
        pending = form;
        form.timer = resolved.setTimer(() => finish(form, { status: "EXPIRED" }), CONTACT_FORM_LIFETIME_MS);
        let delivered = false;
        try {
          delivered = resolved.notify({ requestId, displayName: input.displayName });
        } catch {
          resolved.logError("Contact form notification failed.");
        }
        if (!delivered) finish(form, { status: "UNAVAILABLE" });
      }),
    submit: async (input) => {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, ["requestId", "displayName", "phone"]) ||
        typeof input.requestId !== "string" ||
        typeof input.displayName !== "string" ||
        typeof input.phone !== "string" ||
        input.displayName.length > MAX_FORM_NAME_LENGTH ||
        input.phone.length > MAX_FORM_PHONE_LENGTH
      ) {
        return toFailure(messagingFailure("MESSAGING_INVALID_PHONE"));
      }
      const form = pending;
      if (!form || form.requestId !== input.requestId) return toFailure(messagingFailure("MESSAGING_PENDING_EXPIRED"));
      if (form.validating) return toFailure(messagingFailure("MESSAGING_OPERATION_FAILED"));
      form.validating = true;
      try {
        const validated = await form.validate({ displayName: input.displayName, phone: input.phone });
        if (!validated.ok) return toFailure(validated);
        if (pending !== form) return toFailure(messagingFailure("MESSAGING_PENDING_EXPIRED"));
        finish(form, { status: "SUBMITTED", value: validated.data });
        return { ok: true, data: { status: "ACCEPTED" } };
      } catch {
        resolved.logError("Contact form validation failed.");
        return toFailure(messagingFailure("MESSAGING_OPERATION_FAILED"));
      } finally {
        form.validating = false;
      }
    },
    cancel: async (input) => {
      if (!isRecord(input) || !hasExactKeys(input, ["requestId"]) || typeof input.requestId !== "string") {
        return toFailure(messagingFailure("MESSAGING_PENDING_EXPIRED"));
      }
      const form = pending;
      if (!form || form.requestId !== input.requestId) return toFailure(messagingFailure("MESSAGING_PENDING_EXPIRED"));
      finish(form, { status: "CANCELLED" });
      return { ok: true, data: { status: "CANCELLED" } };
    },
    shutdown: () => {
      if (pending) finish(pending, { status: "CANCELLED" });
    }
  };
};
