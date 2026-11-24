/**
 * A small, dependency-free fuzzy matcher for the local brain: Levenshtein distance with an early exit and a conservative
 * allowance that grows with the length of the reference text. It compares short, already-folded strings only; anything
 * longer than MAX_FUZZY_LENGTH never matches, which also bounds the work for hostile or very long input.
 */
export const MAX_FUZZY_LENGTH = 60;

/** Edit distance, or `limit + 1` as soon as it is certain to exceed `limit`. Two rolling rows, so memory stays tiny. */
export const boundedLevenshtein = (left: string, right: string, limit: number): number => {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  if (left.length > MAX_FUZZY_LENGTH || right.length > MAX_FUZZY_LENGTH) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left.charCodeAt(row - 1) === right.charCodeAt(column - 1) ? 0 : 1;
      const value = Math.min(previous[column]! + 1, current[column - 1]! + 1, previous[column - 1]! + cost);
      current.push(value);
      if (value < rowMinimum) rowMinimum = value;
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length]!;
};

/**
 * How many edits a phrase of this length may differ by. Short references (under 8 characters) must match exactly, because one
 * edit would turn «hora» into «hola»; the allowance never exceeds about 15 % of the reference.
 */
export const allowedPhraseEdits = (length: number): number => (length < 8 ? 0 : length < 16 ? 1 : 2);

/** The allowance for an application alias: exact below 5 characters, one edit below 9, two from there. */
export const allowedAliasEdits = (length: number): number => (length < 5 ? 0 : length < 9 ? 1 : 2);

/** Distance when it is within `limit`, otherwise undefined. */
export const fuzzyDistance = (candidate: string, reference: string, limit: number): number | undefined => {
  const distance = boundedLevenshtein(candidate, reference, limit);
  return distance <= limit ? distance : undefined;
};
