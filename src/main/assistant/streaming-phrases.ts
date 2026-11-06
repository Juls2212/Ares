import type { SpotifySearchKind } from "../../shared/action-contracts";

/**
 * Deterministic classification of «busca/pon/reproduce … en Spotify», «busca … en Google/YouTube» and
 * «abre Google/YouTube». It only classifies text; it never composes a URL or URI and never launches.
 */
export type StreamingCommand =
  | { kind: "SPOTIFY_SEARCH"; query: string; searchKind: SpotifySearchKind; playRequested: boolean }
  | { kind: "WEB_SEARCH"; site: "GOOGLE" | "YOUTUBE"; query: string }
  | { kind: "WEB_OPEN"; site: "GOOGLE" | "YOUTUBE" };

const POLITE = "(?:por\\s+favor,?\\s+)?";
const SEARCH = "(?:busca|buscar|b[uú]scame|buscame)";
const PLAY = "(?:pon|poner|ponme|p[oó]nme|reproduce|reproducir|reprod[uú]ceme|toca|tocar|play)";
const SPOTIFY_TAIL = "(?:en|con|desde|por|a\\s+trav[eé]s\\s+de)\\s+(?:el\\s+)?spotify";
const OTHER_PLATFORM_TAIL = /\s+en\s+(?:el\s+)?(?:youtube|google)$/iu;

const SPOTIFY_PATTERNS: readonly RegExp[] = [
  new RegExp(`^${POLITE}(${SEARCH}|${PLAY})\\s+(.+?)\\s+${SPOTIFY_TAIL}$`, "iu"),
  new RegExp(`^${POLITE}en\\s+spotify\\s*,?\\s*(${SEARCH}|${PLAY})\\s+(.+)$`, "iu"),
  new RegExp(`^${POLITE}(?:abre|abrir|[aá]breme)\\s+spotify\\s+y\\s+(${SEARCH}|${PLAY})\\s+(.+)$`, "iu")
];
const MUSIC_PATTERN = new RegExp(`^${POLITE}(pon|poner|ponme|p[oó]nme)\\s+(?:algo\\s+de\\s+)?m[uú]sica\\s+(?:de\\s+la|de\\s+los|de\\s+las|del|de)\\s+(.+)$`, "iu");
const PLAY_VERB = new RegExp(`^${PLAY}$`, "iu");

const KIND_PREFIX =
  /^(?:(?:la|el|una|un|al|a la)\s+)?(canci[oó]n|tema|artista|cantante|grupo|banda|[aá]lbum|disco|playlist|lista\s+de\s+reproducci[oó]n)\s+(?:de\s+)?(.+)$/iu;

const kindOf = (word: string): SpotifySearchKind => {
  const normalized = word.toLocaleLowerCase("es-CO");
  if (/^(canci|tema)/u.test(normalized)) return "TRACK";
  if (/^(artista|cantante|grupo|banda)/u.test(normalized)) return "ARTIST";
  if (/^([aá]lbum|disco)/u.test(normalized)) return "ALBUM";
  return "PLAYLIST";
};

const cleanQuery = (value: string): string =>
  value.trim().replace(/^[«"“'‘]+/u, "").replace(/[»"”'’.,;:!?¡¿]+$/u, "").trim();

const WEB_PATTERNS: ReadonlyArray<{ pattern: RegExp; build: (match: RegExpMatchArray) => StreamingCommand }> = [
  {
    pattern: new RegExp(`^${POLITE}(?:busca|buscar|b[uú]scame|buscame|investiga)\\s+(.+?)\\s+(?:en|con|por)\\s+(?:el\\s+)?(google|youtube)$`, "iu"),
    build: (match) => ({ kind: "WEB_SEARCH", site: match[2].toUpperCase() as "GOOGLE" | "YOUTUBE", query: cleanQuery(match[1]) })
  },
  {
    pattern: new RegExp(`^${POLITE}(?:busca|buscar|b[uú]scame|buscame)\\s+en\\s+(?:el\\s+)?(google|youtube)\\s+(.+)$`, "iu"),
    build: (match) => ({ kind: "WEB_SEARCH", site: match[1].toUpperCase() as "GOOGLE" | "YOUTUBE", query: cleanQuery(match[2]) })
  },
  {
    pattern: new RegExp(`^${POLITE}${PLAY}\\s+(.+?)\\s+en\\s+(?:el\\s+)?youtube$`, "iu"),
    build: (match) => ({ kind: "WEB_SEARCH", site: "YOUTUBE", query: cleanQuery(match[1]) })
  },
  {
    pattern: new RegExp(`^${POLITE}(?:abre|abrir|[aá]breme|abreme|ve\\s+a|ir\\s+a)\\s+(?:el\\s+|la\\s+)?(?:p[aá]gina\\s+de\\s+)?(google|youtube)$`, "iu"),
    build: (match) => ({ kind: "WEB_OPEN", site: match[1].toUpperCase() as "GOOGLE" | "YOUTUBE" })
  }
];

// «pon X» / «reproduce X» without a platform plays on Spotify, except for words that clearly name something else.
const BARE_PLAY = new RegExp(`^${POLITE}(${PLAY})\\s+(.+)$`, "iu");
const BARE_EXCLUDED =
  /^(?:un|una|unos|unas|el|la|lo|los|las|mi|mis|este|esta|esto|ese|esa|eso|volumen|pausa|alarma|temporizador|recordatorio|tarea|evento|m[uú]sica$|algo|todo|todos|todas|nada)\b|\ben\s+(?:google|youtube|spotify|el\s+navegador|la\s+web)$/iu;

const toSpotifyCommand = (verb: string, rawQuery: string): StreamingCommand | undefined => {
  let query = cleanQuery(rawQuery);
  let searchKind: SpotifySearchKind = "ANY";
  const prefixed = query.match(KIND_PREFIX);
  if (prefixed && cleanQuery(prefixed[2]).length > 0) {
    searchKind = kindOf(prefixed[1]);
    query = cleanQuery(prefixed[2]);
  }
  return query.length === 0
    ? undefined
    : { kind: "SPOTIFY_SEARCH", query, searchKind, playRequested: PLAY_VERB.test(verb) };
};

export const parseStreamingCommand = (instruction: string): StreamingCommand | undefined => {
  const text = instruction.trim().replace(/[.!?¡¿]+$/u, "").trim();
  if (text.length === 0) return undefined;
  for (const pattern of SPOTIFY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return toSpotifyCommand(match[1], match[2]);
  }
  const music = text.match(MUSIC_PATTERN);
  if (music && !OTHER_PLATFORM_TAIL.test(text)) {
    const query = cleanQuery(music[2]);
    return query.length === 0 ? undefined : { kind: "SPOTIFY_SEARCH", query, searchKind: "ARTIST", playRequested: true };
  }
  for (const { pattern, build } of WEB_PATTERNS) {
    const match = text.match(pattern);
    if (match) return build(match);
  }
  const bare = text.match(BARE_PLAY);
  if (bare && PLAY_VERB.test(bare[1])) {
    const rest = cleanQuery(bare[2]);
    if (rest.length > 0 && (KIND_PREFIX.test(rest) || !BARE_EXCLUDED.test(rest))) return toSpotifyCommand(bare[1], rest);
  }
  return undefined;
};
