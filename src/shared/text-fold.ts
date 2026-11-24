/**
 * The one shared kit for folding user text (case, diacritics, whitespace, quotes) before it is compared or matched.
 *
 * Every function here reproduces, character for character, a folding that already existed somewhere in the code base.
 * They are NOT interchangeable: each differs in a way that decides what a caller accepts, so each keeps its own name and
 * callers must pick the variant that matches the behavior they had. tests/text-fold.test.ts documents every divergence with
 * the exact input where two variants give different results.
 *
 * Rules about specific letters, stated once:
 *  - Every variant built on Unicode decomposition (NFD or NFKD) turns «ñ» into «n» and «ü» into «u», because the combining
 *    tilde and diaeresis are removed. Only foldAccentsOneToOne keeps «ñ»: it maps a fixed list of vowels and nothing else.
 *  - foldEventTitle never removes accents; it only normalizes composition (NFC), trims and lowercases.
 */

/** Lowercase letters/digits only matter to the alias fold; everything else becomes a space there. */
const NON_LETTER_OR_DIGIT = /[^\p{L}\p{N}\s]/gu;

/** Decomposes (NFD) and removes every character with the Unicode Diacritic property (accents, tilde, diaeresis, ^ ` ´ ¨). */
export const stripDiacritics = (value: string): string => value.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Decomposes (NFD) and removes only the combining marks U+0300 to U+036F; spacing marks such as ^ ` ´ ¨ stay. */
export const stripCombiningMarks = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Decomposes with compatibility rules (NFKD, so «ﬁ» becomes «fi») and removes every combining mark (Unicode category M). */
export const stripCompatibilityMarks = (value: string): string => value.normalize("NFKD").replace(/\p{M}/gu, "");

/** Replaces every run of whitespace with one space; it does not trim. */
export const collapseWhitespace = (value: string): string => value.replace(/\s+/gu, " ");

/** Replaces every run of whitespace with one space and trims both ends. */
export const collapseAndTrim = (value: string): string => collapseWhitespace(value).trim();

/**
 * Exact alias comparison key: strips diacritics, lowercases (en-US), turns every character that is not a letter, digit or
 * whitespace into a space, collapses whitespace and trims. «José   Núñez!» becomes «jose nunez».
 */
export const foldForAlias = (value: string): string =>
  collapseAndTrim(stripDiacritics(value).toLocaleLowerCase("en-US").replace(NON_LETTER_OR_DIGIT, " "));

/**
 * Case- and accent-insensitive matching key that keeps punctuation and whitespace exactly as given: strips diacritics, then
 * lowercases (en-US). It does not trim or collapse, so «  Núñez  » keeps both outer spaces.
 */
export const foldCaseAndDiacritics = (value: string): string => stripDiacritics(value).toLocaleLowerCase("en-US");

/** Spanish word key: trims, lowercases (es) and only then strips diacritics. It keeps inner spacing and punctuation. */
export const foldSpanishWord = (value: string): string => stripDiacritics(value.trim().toLocaleLowerCase("es"));

/**
 * Loose text key for «does the instruction mention this?» checks: strips combining marks U+0300 to U+036F, collapses
 * whitespace, trims and lowercases (es-CO). Unlike the other folds it keeps punctuation and the spacing marks ^ ` ´ ¨.
 */
export const foldLooseText = (value: string): string => collapseAndTrim(stripCombiningMarks(value)).toLocaleLowerCase("es-CO");

/**
 * Folds accented vowels one to one, so the result has the same length as the input and match indices still point into the
 * original text. It keeps the case of every letter and leaves «ñ» and «Ñ» untouched.
 */
export const foldAccentsOneToOne = (value: string): string =>
  value
    .replace(/[áàä]/gu, "a").replace(/[éèë]/gu, "e").replace(/[íìï]/gu, "i").replace(/[óòö]/gu, "o").replace(/[úùü]/gu, "u")
    .replace(/[ÁÀÄ]/gu, "A").replace(/[ÉÈË]/gu, "E").replace(/[ÍÌÏ]/gu, "I").replace(/[ÓÒÖ]/gu, "O").replace(/[ÚÙÜ]/gu, "U");

/** Trims and lowercases (en-US) without touching accents. */
export const lowerTrim = (value: string): string => value.trim().toLocaleLowerCase("en-US");

/** Event title key: NFC composition, trim, lowercase (es). Accents are kept, so «José» becomes «josé». */
export const foldEventTitle = (value: string): string => value.normalize("NFC").trim().toLocaleLowerCase("es");

/**
 * Trims, removes leading « " “ ' ‘ and trailing » " ” ' ’ . , ; : ! ? ¡ ¿, then trims again. Used for search queries and
 * contact names taken out of a longer sentence.
 */
export const trimQuotesAndTrailingPunctuation = (value: string): string =>
  value.trim().replace(/^[«"“'‘]+/u, "").replace(/[»"”'’.,;:!?¡¿]+$/u, "").trim();

/**
 * Cleans a name fragment: trims, drops trailing . , ; ! ?, removes quote characters from both ends (« " ' “ ” ‘ ’ and », the
 * closing guillemet only at the end), drops trailing . , ; ! ? again and trims. Unlike trimQuotesAndTrailingPunctuation it
 * keeps : ¡ ¿ and removes the opening quotes that follow trailing punctuation.
 */
export const trimNameFragment = (value: string): string =>
  value.trim().replace(/[.,;!?]+$/u, "").replace(/^[«"'“”‘’]+|[«"'“”‘’»]+$/gu, "").replace(/[.,;!?]+$/u, "").trim();

/** Trims and, only when the whole text is wrapped in matching-kind quotes («…», "…" or “…”), removes that one pair. */
export const unwrapQuotedText = (value: string): string => {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^[«"“](.+)[»"”]$/su);
  return (quoted ? quoted[1] : trimmed).trim();
};
