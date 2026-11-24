/**
 * Shared building blocks for the deterministic phrase matchers: the polite-prefix fragments the matchers put in front of
 * their patterns, and helpers that compile a phrase list once. Phrase data itself stays in the modules that own it (as plain
 * arrays), written in Spanish exactly as the person says it.
 */

/** «por favor» with an optional comma and any whitespace; used by the messaging and streaming matchers (identical there). */
export const POLITE_PREFIX = "(?:por\\s+favor,?\\s+)?";

/**
 * «por favor» followed by one space. Only valid in front of already-folded text (see foldForAlias): folded text has single
 * spaces and no commas, which is why this shorter fragment accepts exactly what POLITE_PREFIX would accept there.
 */
export const POLITE_PREFIX_FOLDED = "(?:por favor )?";

/** Anchored variant for unfolded text: optional leading whitespace, then «por favor» with a comma and/or spaces. */
export const POLITE_PREFIX_ANCHORED = "^\\s*(?:por favor[, ]+)?";

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export type PhraseMatcher = {
  /** True only when the whole text equals one of the phrases (anchored on both ends). */
  readonly test: (text: string) => boolean;
  readonly pattern: RegExp;
};

/**
 * Compiles a list of phrases once into an anchored whole-string matcher. Phrases are matched literally (every regex
 * character is escaped; spaces stay single literal spaces), so it is meant for folded text. Longer phrases are tried first
 * so a phrase that starts with another one is never cut short. There is no nested quantifier: matching is linear.
 */
export const createPhraseMatcher = (phrases: readonly string[], flags = "u"): PhraseMatcher => {
  if (phrases.length === 0) throw new Error("A phrase matcher needs at least one phrase.");
  const body = [...phrases].sort((left, right) => right.length - left.length).map(escapeRegExp).join("|");
  const pattern = new RegExp(`^(?:${body})$`, flags);
  return { pattern, test: (text) => pattern.test(text) };
};

/** A membership set of folded phrases: both the phrases and the looked-up text go through the same fold. */
export const createPhraseSet = (phrases: readonly string[], fold: (value: string) => string): { readonly has: (text: string) => boolean } => {
  const folded = new Set(phrases.map(fold));
  return { has: (text) => folded.has(fold(text)) };
};
