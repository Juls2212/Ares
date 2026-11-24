import { defineFailureTaxonomy, type TaxonomyFailure } from "./failure-taxonomy";

/** The only two values the toggle can send. "system" stays a tray-only choice. */
export const THEME_CHOICES = ["light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ThemeSetPreferenceInput = { preference: ThemeChoice };

export const THEME_FAILURES = defineFailureTaxonomy({
  THEME_PREFERENCE_INVALID: "No pude cambiar el tema. Inténtalo de nuevo.",
  THEME_NOT_SAVED: "El tema cambió, pero no pude guardarlo para la próxima vez.",
  THEME_UNAVAILABLE: "No pude cambiar el tema ahora."
});
export type ThemeFailureCode = keyof typeof THEME_FAILURES.messages;

export type ThemeOperationResult = { ok: true } | TaxonomyFailure<ThemeFailureCode>;

/** There is no getter: the renderer reads the effective theme from prefers-color-scheme. */
export type ThemeApi = {
  setPreference: (input: ThemeSetPreferenceInput) => Promise<ThemeOperationResult>;
};

/** Strict closed-object validation: exactly one own key, "preference", holding "light" or "dark". */
export const parseThemeSetPreferenceInput = (input: unknown): ThemeChoice | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 1 || keys[0] !== "preference") return undefined;
  const value = (input as { preference?: unknown }).preference;
  return value === "light" || value === "dark" ? value : undefined;
};
