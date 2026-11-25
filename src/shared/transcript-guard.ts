/**
 * A local, pure check of a transcription before it reaches the interpreter. It makes no network call and uses no
 * language-detection service: it only looks at the characters and a few closed word lists.
 *
 * It rejects what cannot be a Spanish command: empty text, text without real words (punctuation, digits, filler such
 * as "eh" or "mmm"), text written mostly in a non-Latin script, a known "silence" hallucination of speech models, and
 * an obviously English sentence. Everything else is accepted, so accented Spanish and names pass.
 */

import { foldCaseAndDiacritics } from "./text-fold";

export const TRANSCRIPT_OUTCOMES = [
  "TRANSCRIPT_OK",
  "TRANSCRIPT_EMPTY",
  "TRANSCRIPT_TOO_SHORT",
  "TRANSCRIPT_REJECTED_LANGUAGE"
] as const;
export type TranscriptOutcome = (typeof TRANSCRIPT_OUTCOMES)[number];

/** At least this many letters must be present for the text to count as words. */
export const MIN_TRANSCRIPT_LETTERS = 2;

/** More than this share of non-Latin letters means the text is not Latin-script Spanish. */
export const MAX_NON_LATIN_SHARE = 0.3;

const FILLER = new Set([
  "eh", "ehh", "ehm", "em", "emm", "mm", "mmm", "mmmm", "hm", "hmm", "hmmm", "mhm", "uh", "uhm", "uhh", "um", "umm", "ah", "aah", "oh", "ooh", "ay", "ey"
]);

/** Phrases that speech models typically invent for silence or noise. They are never a command. */
const HALLUCINATION_FRAGMENTS = [
  "amara.org",
  "subtitulos realizados",
  "subtitulos por la comunidad",
  "gracias por ver",
  "suscribete",
  "thanks for watching",
  "thank you for watching",
  "subtitles by"
];

const ENGLISH_STOPWORDS = new Set([
  "the", "and", "you", "is", "are", "was", "what", "this", "that", "with", "for", "your", "have", "will", "would", "can", "please", "hello", "thanks", "thank", "it", "to", "of", "in", "my", "me", "i"
]);

const SPANISH_STOPWORDS = new Set([
  "el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una", "es", "para", "con", "por", "mi", "se", "lo", "al", "abre", "busca", "qué", "que", "cuál", "hora", "dime", "pon", "quiero", "tengo", "hoy"
]);

const fold = (text: string): string => foldCaseAndDiacritics(text);

const words = (text: string): string[] => fold(text).match(/[\p{L}\p{N}'.]+/gu)?.map((word) => word.replace(/^['.]+|['.]+$/gu, "")).filter(Boolean) ?? [];

/** Classifies a transcription with one closed outcome. Pure and deterministic. */
export const evaluateTranscript = (text: unknown): TranscriptOutcome => {
  if (typeof text !== "string" || text.trim() === "") return "TRANSCRIPT_EMPTY";
  const trimmed = text.trim();

  const letters = trimmed.match(/\p{L}/gu) ?? [];
  const nonLatin = letters.filter((letter) => !/\p{Script=Latin}/u.test(letter)).length;
  if (letters.length > 0 && nonLatin / letters.length > MAX_NON_LATIN_SHARE) return "TRANSCRIPT_REJECTED_LANGUAGE";
  if (letters.length < MIN_TRANSCRIPT_LETTERS) return "TRANSCRIPT_TOO_SHORT";

  const folded = fold(trimmed);
  if (HALLUCINATION_FRAGMENTS.some((fragment) => folded.includes(fragment))) return "TRANSCRIPT_REJECTED_LANGUAGE";

  const tokens = words(trimmed);
  if (tokens.length > 0 && tokens.every((token) => FILLER.has(token))) return "TRANSCRIPT_TOO_SHORT";

  // A conservative English check: only a sentence of several words, mostly English function words, with no Spanish one.
  const alphabetic = tokens.filter((token) => /^\p{L}+$/u.test(token));
  if (alphabetic.length >= 4) {
    const english = alphabetic.filter((token) => ENGLISH_STOPWORDS.has(token)).length;
    const spanish = alphabetic.filter((token) => SPANISH_STOPWORDS.has(token)).length;
    if (spanish === 0 && english >= 3 && english * 2 >= alphabetic.length) return "TRANSCRIPT_REJECTED_LANGUAGE";
  }

  return "TRANSCRIPT_OK";
};

/** Short, natural Spanish examples. The request to repeat cycles through them so it does not repeat itself. */
export const REPEAT_EXAMPLES = [
  "¿qué hora es?",
  "abre la calculadora",
  "qué tengo hoy en la agenda",
  "busca mis recibos",
  "dime cómo está mi equipo"
] as const;

/** The fixed Spanish request to repeat; `variation` selects the example (any integer). It never contains the transcript. */
export const repeatRequestMessage = (outcome: Exclude<TranscriptOutcome, "TRANSCRIPT_OK">, variation: number): string => {
  const index = ((Math.trunc(variation) % REPEAT_EXAMPLES.length) + REPEAT_EXAMPLES.length) % REPEAT_EXAMPLES.length;
  const example = REPEAT_EXAMPLES[index];
  const lead = outcome === "TRANSCRIPT_REJECTED_LANGUAGE" ? "No te entendí en español." : outcome === "TRANSCRIPT_TOO_SHORT" ? "Te escuché muy poco." : "No se entendió lo que dijiste.";
  return `${lead} Repite con una frase corta y natural, por ejemplo: «${example}».`;
};

/** The closed outcomes of one transcription attempt, for the diagnostic line. */
export const TRANSCRIBE_OUTCOMES = [
  ...TRANSCRIPT_OUTCOMES,
  "TRANSCRIPT_TOO_LONG",
  "PROVIDER_FAILED",
  "PROVIDER_TIMEOUT",
  "CONFIGURATION_UNAVAILABLE"
] as const;
export type TranscribeOutcome = (typeof TRANSCRIBE_OUTCOMES)[number];

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

/**
 * One privacy-safe line per transcription: the model name (or "custom" when it is not a plain identifier), the fixed
 * language, bounded numbers and a closed outcome. Never the text, a path or a key.
 */
export const formatTranscribeLine = (facts: { model: unknown; durationMs: unknown; bytes: unknown; outcome: unknown }): string => {
  const bounded = (value: unknown, maximum: number): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.trunc(value))) : 0;
  const model = typeof facts.model === "string" && MODEL_NAME.test(facts.model) ? facts.model : "custom";
  const outcome = (TRANSCRIBE_OUTCOMES as readonly unknown[]).includes(facts.outcome) ? (facts.outcome as string) : "INVALID";
  return `transcribe model=${model} lang=es durationMs=${bounded(facts.durationMs, 600_000)} bytes=${bounded(facts.bytes, 100_000_000)} outcome=${outcome}`;
};
