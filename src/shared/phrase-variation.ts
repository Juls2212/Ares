/**
 * Light, deterministic variation for frequent successes. A picker only chooses between equivalent phrasings; failures and
 * confirmation prompts never go through it. The default picker always returns the first phrasing, so pure callers and tests
 * are stable; production passes a rotating picker.
 */
export type VariantPicker = (variants: readonly string[]) => string;

export const firstVariant: VariantPicker = (variants) => variants[0] ?? "";

/** Index-based rotation from an injectable integer seed: the same seed always yields the same sequence. */
export const createRotatingPicker = (seed = 0): VariantPicker => {
  let index = Number.isInteger(seed) ? Math.abs(seed) : 0;
  return (variants) => {
    if (variants.length === 0) return "";
    const chosen = variants[index % variants.length] ?? variants[0] ?? "";
    index += 1;
    return chosen;
  };
};
