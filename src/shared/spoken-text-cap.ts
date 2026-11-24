export const SPOKEN_MAX_SENTENCES = 2;
export const SPOKEN_MAX_CHARACTERS = 240;

export type SpokenCap = { maxSentences: number; maxCharacters: number };
export const SPOKEN_CAP_DEFAULT: SpokenCap = { maxSentences: SPOKEN_MAX_SENTENCES, maxCharacters: SPOKEN_MAX_CHARACTERS };
/**
 * The cap for an agenda answer, which is a list and would be cut by the normal two-sentence cap. It is still bounded
 * (about 600 characters) and still never cuts inside a sentence. Only an agenda response asks for it.
 */
export const SPOKEN_CAP_AGENDA: SpokenCap = { maxSentences: 6, maxCharacters: 600 };

/** A sentence ends at ., ! , ? or … followed by whitespace; decimals such as 14,5 or 3.5 never split. */
const splitSentences = (text: string): string[] =>
  text.trim().split(/(?<=[.!?…])\s+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);

/**
 * Keeps the spoken answer short: at most two whole sentences within about 240 characters. It never cuts inside a sentence, so
 * a single long first sentence is spoken whole. The full text still shows on screen; only the synthesized audio is shortened.
 */
export const capSpokenText = (text: string, cap: SpokenCap = SPOKEN_CAP_DEFAULT): string => {
  const sentences = splitSentences(text);
  if (sentences.length <= cap.maxSentences && text.trim().length <= cap.maxCharacters) return text;
  const kept: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    const next = length + sentence.length + (kept.length > 0 ? 1 : 0);
    if (kept.length >= cap.maxSentences || (kept.length > 0 && next > cap.maxCharacters)) break;
    kept.push(sentence);
    length = next;
  }
  return kept.join(" ");
};
