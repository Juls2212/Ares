const removePresentationFormatting = (text: string): string => text
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^\s*(?:[-*+]|[•▪◦])\s+/gm, "")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/__([^_]+)__/g, "$1")
  .replace(/`([^`]+)`/g, "$1");

// This changes only presentational markup and spacing for speech. Stored and displayed response text is untouched.
export const normalizeSpeechText = (text: string): string =>
  removePresentationFormatting(text).replace(/\s+/g, " ").trim();
