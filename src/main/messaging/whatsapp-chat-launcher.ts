import { shell } from "electron";

/**
 * The single module that may turn messaging data into a link and hand it to the operating system.
 * It composes only two fixed templates from digits and a body, validates the result against an exact
 * allowlist, and never returns, logs or throws the link, the number or the text. Ares never sends: the
 * person presses send inside WhatsApp.
 *
 *   primary:  whatsapp://send?phone=<digits>&text=<encodeURIComponent(body)>
 *   fallback: https://wa.me/<digits>?text=<encodeURIComponent(body)>
 */
export const MAX_CHAT_URL_LENGTH = 2_000;

const PRIMARY_TEMPLATE = /^whatsapp:\/\/send\?phone=[1-9][0-9]{7,14}&text=[A-Za-z0-9\-_.!~*'()%]*$/u;
const FALLBACK_TEMPLATE = /^https:\/\/wa\.me\/[1-9][0-9]{7,14}\?text=[A-Za-z0-9\-_.!~*'()%]*$/u;
const DIGITS = /^[1-9][0-9]{7,14}$/u;
const MAX_PHONE_DIGITS = 15;

export type ChatLaunchFailure = "TOO_LONG" | "INVALID_TARGET" | "OPEN_FAILED";
export type ChatLaunchResult = { ok: true } | { ok: false; reason: ChatLaunchFailure };

export type WhatsAppChatLauncher = {
  /** Whether the encoded text fits the documented link length; it needs no number. */
  canCarry: (body: string) => boolean;
  open: (target: { digits: string; body: string }) => Promise<ChatLaunchResult>;
};

type LauncherDependencies = {
  openExternal: (url: string) => Promise<void>;
  logError: (message: string) => void;
};

type ComposedLinks = { primary: string; fallback: string };

/** Allowlist: exactly one of the two fixed templates, with the percent-encoding intact and a bounded length. */
export const isAllowedChatUrl = (url: string): boolean => {
  if (url.length > MAX_CHAT_URL_LENGTH) return false;
  if (!PRIMARY_TEMPLATE.test(url) && !FALLBACK_TEMPLATE.test(url)) return false;
  const text = url.slice(url.indexOf("text=") + "text=".length);
  try {
    return encodeURIComponent(decodeURIComponent(text)) === text;
  } catch {
    return false;
  }
};

export const composeChatUrls = (digits: string, body: string): { ok: true; links: ComposedLinks } | { ok: false; reason: ChatLaunchFailure } => {
  if (!DIGITS.test(digits) || typeof body !== "string" || body.length === 0) return { ok: false, reason: "INVALID_TARGET" };
  const encoded = encodeURIComponent(body);
  const links: ComposedLinks = {
    primary: `whatsapp://send?phone=${digits}&text=${encoded}`,
    fallback: `https://wa.me/${digits}?text=${encoded}`
  };
  if (links.primary.length > MAX_CHAT_URL_LENGTH || links.fallback.length > MAX_CHAT_URL_LENGTH) {
    return { ok: false, reason: "TOO_LONG" };
  }
  return isAllowedChatUrl(links.primary) && isAllowedChatUrl(links.fallback)
    ? { ok: true, links }
    : { ok: false, reason: "INVALID_TARGET" };
};

export const createWhatsAppChatLauncher = (overrides: Partial<LauncherDependencies> = {}): WhatsAppChatLauncher => {
  const dependencies: LauncherDependencies = {
    openExternal: (url) => shell.openExternal(url),
    logError: (message) => console.error(message),
    ...overrides
  };

  return {
    canCarry: (body) => composeChatUrls("9".repeat(MAX_PHONE_DIGITS - 1).replace(/^/u, "1"), body).ok,
    open: async ({ digits, body }) => {
      const composed = composeChatUrls(digits, body);
      if (!composed.ok) return composed;
      for (const url of [composed.links.primary, composed.links.fallback]) {
        try {
          await dependencies.openExternal(url);
          return { ok: true };
        } catch {
          dependencies.logError("WhatsApp chat launch attempt failed.");
        }
      }
      return { ok: false, reason: "OPEN_FAILED" };
    }
  };
};
