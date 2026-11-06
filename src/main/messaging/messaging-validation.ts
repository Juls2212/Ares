import {
  MAX_CONTACT_ALIASES,
  MAX_CONTACT_NAME_LENGTH,
  MAX_MESSAGE_BODY_LENGTH
} from "../../shared/messaging-contracts";
import { KNOWN_APPLICATION_CATALOG, normalizeApplicationAlias } from "../applications/known-application-catalog";
import { messagingFailure, messagingSuccess, type MessagingResult } from "./messaging-failures";

/** The single default country code: a 10-digit number starting with 3 is a Colombian mobile number. */
export const DEFAULT_COUNTRY_CODE = "57";

const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;
const MAX_PHONE_INPUT_LENGTH = 40;
/** A digit run this long inside a name would smuggle a phone number through the voice path. */
const NAME_DIGIT_RUN_LIMIT = 7;

const PHONE_SEPARATORS = /[\s\-()]/gu;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’&()_-]*$/u;
const CONTROL_OR_HIDDEN = /[\p{C}]/u;

/**
 * Normalizes a phone number typed in the contact form into digits only (international format, no «+»).
 * Rules: strip spaces, dashes, parentheses and one leading «+»; only digits may remain; 8-15 digits.
 * Without a «+», a number needs a plausible country code: 11-15 digits, or exactly 10 digits starting
 * with 3, which gets the default country code. A leading zero is never a valid country code.
 */
export const normalizePhoneNumber = (input: unknown): MessagingResult<string> => {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_PHONE_INPUT_LENGTH) {
    return messagingFailure("MESSAGING_INVALID_PHONE");
  }
  const trimmed = input.trim();
  const explicitInternational = trimmed.startsWith("+");
  const digits = (explicitInternational ? trimmed.slice(1) : trimmed).replace(PHONE_SEPARATORS, "");
  if (!/^[0-9]+$/u.test(digits) || digits.startsWith("0")) return messagingFailure("MESSAGING_INVALID_PHONE");
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return messagingFailure("MESSAGING_INVALID_PHONE");
  }
  if (explicitInternational) return messagingSuccess(digits);
  if (digits.length === 10 && digits.startsWith("3")) return messagingSuccess(`${DEFAULT_COUNTRY_CODE}${digits}`);
  return digits.length >= 11 ? messagingSuccess(digits) : messagingFailure("MESSAGING_INVALID_PHONE");
};

/** Only the last four digits ever reach a review dialog. */
export const maskPhoneDigits = (digits: string): string => `•••• ${digits.slice(-4)}`;

/** Accent-, case- and punctuation-insensitive comparison key for names, aliases and spoken references. */
export const toLookupKey = (value: string): string => normalizeApplicationAlias(value);

const RESERVED_APPLICATION_KEYS: ReadonlySet<string> = new Set(
  KNOWN_APPLICATION_CATALOG.flatMap((entry) =>
    [entry.defaultAlias, entry.displayName, ...entry.recognitionAliases].map(toLookupKey)
  )
);

/** A bare application alias must keep meaning the application, so it cannot also be a contact name. */
export const isReservedApplicationName = (value: string): boolean => RESERVED_APPLICATION_KEYS.has(toLookupKey(value));

export type ValidatedContactName = { displayName: string; lookupKey: string };

/** 1-40 characters after trimming; letters, digits, spaces and basic punctuation; no hidden characters. */
export const validateContactName = (input: unknown): MessagingResult<ValidatedContactName> => {
  if (typeof input !== "string" || CONTROL_OR_HIDDEN.test(input)) return messagingFailure("MESSAGING_INVALID_NAME");
  const displayName = input.trim().replace(/ {2,}/gu, " ");
  if (displayName.length === 0 || displayName.length > MAX_CONTACT_NAME_LENGTH) {
    return messagingFailure("MESSAGING_INVALID_NAME");
  }
  if (!NAME_PATTERN.test(displayName)) return messagingFailure("MESSAGING_INVALID_NAME");
  if (new RegExp(`\\d{${NAME_DIGIT_RUN_LIMIT},}`, "u").test(displayName.replace(/[\s\-()]/gu, ""))) {
    return messagingFailure("MESSAGING_INVALID_NAME");
  }
  const lookupKey = toLookupKey(displayName);
  if (lookupKey.length === 0 || isReservedApplicationName(displayName)) return messagingFailure("MESSAGING_INVALID_NAME");
  return messagingSuccess({ displayName, lookupKey });
};

/** Optional spoken aliases follow the same rules as names; duplicates inside the list are dropped. */
export const validateContactAliases = (input: unknown): MessagingResult<ValidatedContactName[]> => {
  if (input === undefined) return messagingSuccess([]);
  if (!Array.isArray(input) || input.length > MAX_CONTACT_ALIASES) return messagingFailure("MESSAGING_INVALID_NAME");
  const aliases: ValidatedContactName[] = [];
  for (const candidate of input) {
    const validated = validateContactName(candidate);
    if (!validated.ok) return validated;
    if (!aliases.some((alias) => alias.lookupKey === validated.data.lookupKey)) aliases.push(validated.data);
  }
  return messagingSuccess(aliases);
};

/**
 * 1-1000 characters after cleaning. Control and invisible formatting characters are removed (line breaks
 * and tabs become spaces) so the text the person reads is exactly the text that is stored. URLs are
 * allowed: this is the person's own message and nothing here opens or sends it.
 */
export const sanitizeMessageBody = (input: unknown): MessagingResult<string> => {
  if (typeof input !== "string") return messagingFailure("MESSAGING_INVALID_BODY");
  const cleaned = input
    .replace(/[\r\n\t\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/[\p{C}]/gu, "")
    .replace(/ {2,}/gu, " ")
    .trim();
  if (cleaned.length === 0 || cleaned.length > MAX_MESSAGE_BODY_LENGTH) return messagingFailure("MESSAGING_INVALID_BODY");
  return messagingSuccess(cleaned);
};

/** A spoken recipient or contact reference: bounded text that normalizes to something comparable. */
export const normalizeContactReference = (input: unknown): string | undefined => {
  if (typeof input !== "string" || CONTROL_OR_HIDDEN.test(input)) return undefined;
  const key = toLookupKey(input);
  return key.length >= 1 && key.length <= MAX_CONTACT_NAME_LENGTH * 2 ? key : undefined;
};
