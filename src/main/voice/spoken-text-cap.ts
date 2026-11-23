export const SPOKEN_MAX_SENTENCES = 2;
export const SPOKEN_MAX_CHARACTERS = 240;

/** A sentence ends at ., ! , ? or … followed by whitespace; decimals such as 14,5 or 3.5 never split. */
const splitSentences = (text: string): string[] =>
  text.trim().split(/(?<=[.!?…])\s+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);

/**
 * Keeps the spoken answer short: at most two whole sentences within about 240 characters. It never cuts inside a sentence, so
 * a single long first sentence is spoken whole. The full text still shows on screen; only the synthesized audio is shortened.
 */
export const capSpokenText = (text: string): string => {
  const sentences = splitSentences(text);
  if (sentences.length <= SPOKEN_MAX_SENTENCES && text.trim().length <= SPOKEN_MAX_CHARACTERS) return text;
  const kept: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    const next = length + sentence.length + (kept.length > 0 ? 1 : 0);
    if (kept.length >= SPOKEN_MAX_SENTENCES || (kept.length > 0 && next > SPOKEN_MAX_CHARACTERS)) break;
    kept.push(sentence);
    length = next;
  }
  return kept.join(" ");
};
