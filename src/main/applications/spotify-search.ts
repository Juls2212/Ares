/**
 * Validation of the one value a person or the model may supply for the Spotify app search: a short
 * plain-text query. The URI itself is composed privately inside the catalog adapter's Spotify strategy.
 */
export const MAX_SPOTIFY_SEARCH_QUERY_LENGTH = 100;

const ALLOWED_QUERY = /^[\p{L}\p{N}"¿¡(][\p{L}\p{M}\p{N} .,'’&!?¿¡()"#+-]*$/u;
const URL_LIKE = /(?:[a-z][a-z\d+.-]*:|\bwww\.|[\p{L}\d-]+\.[\p{L}]{2,}\b)/iu;

/**
 * Control and invisible characters are stripped; the result must be 1-100 characters of letters, digits,
 * spaces, accents and basic punctuation. Anything that looks like a URL, a scheme, a domain, a path or a
 * parent-directory sequence is rejected.
 */
export const validateSpotifySearchQuery = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const query = value.replace(/[\p{C}]/gu, "").replace(/\s+/gu, " ").trim();
  if (query.length === 0 || query.length > MAX_SPOTIFY_SEARCH_QUERY_LENGTH) return undefined;
  if (query.includes("..") || /[\\/]/u.test(query) || URL_LIKE.test(query)) return undefined;
  return ALLOWED_QUERY.test(query) ? query : undefined;
};
