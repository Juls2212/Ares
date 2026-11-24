import type { ActionName } from "../../shared/action-contracts";
import { firstVariant, type VariantPicker } from "../../shared/phrase-variation";
import { foldAccentsOneToOne, foldForAlias, trimQuotesAndTrailingPunctuation } from "../../shared/text-fold";
import { allowedAliasEdits, allowedPhraseEdits, fuzzyDistance, MAX_FUZZY_LENGTH } from "./local-fuzzy";

/**
 * The offline «local brain»: deterministic, rule-based intent matching with a conservative fuzzy matcher. It is NOT a language
 * model. It is a pure module: text plus a read-only context in, one match out. It never calls a service, never reads the
 * computer and never produces anything the cloud provider could not produce: a match is turned into the same provider-shaped
 * output the cloud returns, and the interpreter runs it through the same validators, so policy, the orchestrator, confirmation
 * tokens and the executors stay exactly as they are.
 *
 * Confidence rule: only a high-confidence match acts. Anything else is `none` («not understood»).
 */

export const LOCAL_INTENTS = [
  "open-app", "search-files", "time", "date", "agenda", "system-info", "help", "greeting", "thanks", "farewell", "cancel"
] as const;
export type LocalIntent = (typeof LOCAL_INTENTS)[number];

/** Anything longer than this is never a local command; it goes to the cloud (or to the not-understood message). */
export const MAX_LOCAL_INPUT_LENGTH = 200;

/**
 * `strict` is used for local-first routing and only accepts exact grammar that the cloud flow would map to the same capability.
 * `lenient` is used when the cloud is unavailable and additionally accepts a file search without an explicit file noun.
 */
export type LocalMode = "strict" | "lenient";

export type LocalContext = {
  /** The enabled registered application aliases (the ones a draft may name). */
  registeredAliases: readonly string[];
  /** Whether the OpenAI key is configured; it only changes what the help answer says, so it is read lazily. */
  isKeyAvailable: () => boolean;
  /** Chooses between equivalent phrasings of small talk; the default always picks the first. */
  pick?: VariantPicker;
};

export type LocalDraft = {
  action: ActionName;
  /** A JSON string for actions that take one, null for the structured ones. */
  input: string | null;
  filesAction?: { query: string; root: string | null; kind: string | null };
  systemInfo?: { topic: string };
};

export type LocalMatch =
  | { kind: "none" }
  | { kind: "reply"; intent: LocalIntent; text: string }
  | { kind: "clarify"; intent: LocalIntent; question: string }
  | { kind: "draft"; intent: LocalIntent; draft: LocalDraft };

const NONE: LocalMatch = { kind: "none" };

/* ------------------------------------------------------------------------------------------------------------------ */
/* Phrase tables                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------ */

type PhraseEntry = { intent: LocalIntent; id: string; phrases: readonly string[]; draft?: LocalDraft };

const EQUIPMENT: ReadonlyArray<readonly [article: string, noun: string]> = [
  ["el", "equipo"], ["el", "computador"], ["la", "computadora"], ["el", "pc"], ["el", "ordenador"], ["el", "portatil"], ["la", "laptop"], ["la", "compu"]
];

/** Expands {el} (article), {eq} (equipment noun) and {mi} («mi» or the article) so the tables stay short. */
const expand = (templates: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const template of templates) {
    if (!/\{(?:el|eq|mi)\}/u.test(template)) { out.add(template); continue; }
    for (const [article, noun] of EQUIPMENT) {
      for (const owner of template.includes("{mi}") ? ["mi", article] : [article]) {
        out.add(template.replaceAll("{el}", article).replaceAll("{mi}", owner).replaceAll("{eq}", noun));
      }
    }
  }
  return [...out];
};

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

const agendaEntries = (): PhraseEntry[] => {
  const dayTemplates = [
    "qué tengo {d}", "qué tengo para {d}", "qué hay {d}", "qué hay para {d}", "qué tengo agendado {d}", "qué tengo pendiente {d}",
    "qué tengo en mi agenda {d}", "qué tengo {d} en mi agenda", "qué hay en mi agenda {d}"
  ];
  const nounTemplates = ["mi agenda de {d}", "agenda de {d}", "agenda para {d}", "dime mi agenda de {d}", "léeme mi agenda de {d}", "cuál es mi agenda de {d}"];
  const entry = (id: string, date: string | undefined, spoken: string, withNoun: boolean): PhraseEntry => ({
    intent: "agenda",
    id,
    phrases: [...dayTemplates, ...(withNoun ? nounTemplates : [])].map((template) => template.replaceAll("{d}", spoken)),
    draft: { action: "GET_TODAY_SCHEDULE", input: date === undefined ? "{}" : JSON.stringify({ date }) }
  });
  const entries = [
    entry("agenda-today", undefined, "hoy", true),
    entry("agenda-tomorrow", "mañana", "mañana", true),
    entry("agenda-after", "pasado mañana", "pasado mañana", true),
    ...WEEKDAYS.map((day) => entry(`agenda-${day}`, day, `el ${day}`, false))
  ];
  entries[0] = { ...entries[0]!, phrases: [...entries[0]!.phrases, "mi agenda", "léeme la agenda", "léeme mi agenda", "qué tengo agendado", "qué tengo pendiente"] };
  return entries;
};

const systemEntry = (topic: string, templates: readonly string[]): PhraseEntry => ({
  intent: "system-info",
  id: `system-${topic}`,
  phrases: expand(templates),
  draft: { action: "GET_SYSTEM_INFO", input: null, systemInfo: { topic } }
});

const ENTRIES: readonly PhraseEntry[] = [
  { intent: "help", id: "help", phrases: [
    "ayuda", "ayúdame", "necesito ayuda", "qué puedes hacer", "qué sabes hacer", "qué haces", "qué puedes hacer por mí", "cómo me puedes ayudar",
    "en qué me puedes ayudar", "para qué sirves", "qué comandos entiendes", "qué comandos hay", "qué comandos conoces", "qué más sabes hacer",
    "qué sabes", "cuáles son tus funciones", "qué funciones tienes", "cómo funcionas", "cómo te uso", "qué puedo pedirte", "qué te puedo pedir"
  ] },
  { intent: "greeting", id: "greeting", phrases: [
    "hola", "buenas", "buenos días", "buenas tardes", "buenas noches", "hey", "ey", "qué tal", "cómo estás", "cómo andas", "cómo vas",
    "saludos", "buen día", "qué más", "hola de nuevo", "hola otra vez"
  ] },
  { intent: "thanks", id: "thanks", phrases: [
    "gracias", "grasias", "muchas gracias", "mil gracias", "te agradezco", "muy amable", "gracias por todo", "listo gracias", "perfecto gracias",
    "vale gracias", "genial gracias", "gracias por la ayuda", "muchas gracias por todo"
  ] },
  { intent: "farewell", id: "farewell", phrases: ["adiós", "chao", "chau", "hasta luego", "nos vemos", "hasta pronto", "hasta mañana", "me voy", "bye"] },
  { intent: "cancel", id: "cancel", phrases: [
    "cancela", "cancelar", "cancélalo", "cancela eso", "cancela todo", "olvídalo", "olvida eso", "déjalo así", "no importa", "no gracias",
    "mejor no", "ya no", "ya no quiero", "nada", "nada gracias", "da igual", "para", "detente", "déjalo", "olvida lo que dije", "no hagas nada", "no olvídalo"
  ] },
  { intent: "time", id: "time", draft: { action: "GET_CURRENT_DATE_TIME", input: "{}" }, phrases: [
    "qué hora es", "qué horas son", "qué hora es ahora", "qué hora es en este momento", "dime la hora", "dime qué hora es", "me dices la hora",
    "me das la hora", "me puedes decir la hora", "puedes decirme la hora", "la hora", "hora actual", "tienes hora", "sabes qué hora es",
    "qué hora tienes", "qué hora es ya", "qué hora es hoy"
  ] },
  { intent: "date", id: "date", draft: { action: "GET_CURRENT_DATE_TIME", input: "{}" }, phrases: [
    "qué día es hoy", "qué día es", "a cuánto estamos", "a qué fecha estamos", "qué fecha es hoy", "qué fecha es", "cuál es la fecha",
    "cuál es la fecha de hoy", "dime la fecha", "dime qué día es", "en qué fecha estamos", "qué día estamos", "me dices la fecha", "fecha de hoy",
    "a cuántos estamos", "hoy qué día es", "en qué día estamos", "qué día de la semana es hoy", "qué día es hoy de la semana"
  ] },
  ...agendaEntries(),
  systemEntry("disk", [
    "cuánto espacio libre tengo", "cuánto espacio me queda", "cuánto espacio libre me queda", "cuánto espacio libre hay", "cuánto espacio tengo libre",
    "cuánto espacio queda en el disco", "cuánto espacio libre queda en el disco", "cuánto espacio libre tengo en el disco", "cuánto espacio tengo en el disco",
    "espacio en disco", "espacio en el disco", "espacio libre en disco", "espacio libre en el disco", "cuánto disco me queda", "cuánto disco tengo libre",
    "cómo está el disco", "cómo va el disco", "cómo está el espacio del disco", "me queda espacio en el disco", "cuánto espacio libre tiene {mi} {eq}",
    "cuánto espacio queda en {mi} {eq}", "cuánto espacio libre tengo en {mi} {eq}", "cuánto espacio me queda en {mi} {eq}"
  ]),
  systemEntry("memory", [
    "cuánta memoria libre hay", "cuánta memoria libre tengo", "cuánta memoria me queda", "cuánta memoria queda", "cuánta memoria tengo libre",
    "cuánta ram tengo libre", "cuánta ram libre tengo", "cuánta memoria ram libre hay", "cuánta memoria ram tengo", "cuánta memoria está usando {el} {eq}",
    "cómo está la memoria", "cómo va la memoria", "uso de memoria", "uso de la memoria", "uso de ram", "memoria libre", "cuánta memoria uso",
    "cuánta memoria usa {el} {eq}", "cómo está la ram", "cómo va la ram"
  ]),
  systemEntry("cpu", [
    "cómo está el procesador", "cómo va el procesador", "cuánto procesador estoy usando", "cuánto procesador se está usando", "uso del procesador",
    "uso de cpu", "uso de la cpu", "cómo está la cpu", "cómo va la cpu", "qué tan ocupado está el procesador", "carga del procesador", "carga de la cpu",
    "cuánto está usando el procesador", "cuánta cpu estoy usando", "cuánto usa el procesador", "cómo está el rendimiento de {mi} {eq}"
  ]),
  systemEntry("uptime", [
    "cuánto tiempo lleva encendido {el} {eq}", "cuánto tiempo llevo con {el} {eq} encendido", "cuánto lleva encendido {el} {eq}",
    "desde cuándo está encendido {el} {eq}", "tiempo encendido", "tiempo de encendido", "cuánto tiempo llevo encendido", "hace cuánto encendí {el} {eq}",
    "cuánto tiempo lleva prendido {el} {eq}", "hace cuánto está prendido {el} {eq}", "cuánto tiempo lleva encendido", "cuánto lleva prendido {el} {eq}"
  ]),
  systemEntry("summary", [
    "cómo está {mi} {eq}", "cómo va {mi} {eq}", "cómo anda {mi} {eq}", "estado de {mi} {eq}", "estado del sistema", "estado del equipo",
    "información de {mi} {eq}", "información del equipo", "dame un resumen de {mi} {eq}", "dame el estado de {mi} {eq}", "cómo está el sistema",
    "resumen del equipo", "resumen de {mi} {eq}", "revisa {mi} {eq}", "diagnóstico del equipo", "dame información de {mi} {eq}", "información del sistema"
  ])
];

type CompiledPhrase = { phrase: string; entry: PhraseEntry };

const COMPILED: readonly CompiledPhrase[] = ENTRIES.flatMap((entry) =>
  [...new Set(entry.phrases.map(foldForAlias))].map((phrase) => ({ phrase, entry }))
);
const EXACT = new Map<string, PhraseEntry>();
for (const { phrase, entry } of COMPILED) if (!EXACT.has(phrase)) EXACT.set(phrase, entry);

/* ------------------------------------------------------------------------------------------------------------------ */
/* Normalization                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------ */

const FILLERS = [
  "por favor", "oye", "ey", "hey", "ares", "disculpa", "perdon", "hola", "buenas tardes", "buenas noches", "buenos dias", "buenas", "ok", "okay", "a ver"
];
const TRAILING = ["por favor", "ares", "gracias", "porfa"];

/** Folds the text and drops polite fillers around a command; when only fillers remain the folded text is kept as it was. */
const normalize = (text: string): { folded: string; core: string } => {
  const folded = foldForAlias(text);
  let core = folded;
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of TRAILING) {
      if (core.endsWith(` ${filler}`) && core.length > filler.length + 1) { core = core.slice(0, -(filler.length + 1)); changed = true; }
    }
    for (const filler of FILLERS) {
      if (core.startsWith(`${filler} `) && core.length > filler.length + 1) { core = core.slice(filler.length + 1); changed = true; }
    }
  }
  return { folded, core: core.length > 0 ? core : folded };
};

/* ------------------------------------------------------------------------------------------------------------------ */
/* Phrase matching                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------------ */

const matchPhrase = (core: string): PhraseEntry | undefined => {
  const exact = EXACT.get(core);
  if (exact) return exact;
  let best: { distance: number; entry: PhraseEntry } | undefined;
  let ambiguous = false;
  for (const { phrase, entry } of COMPILED) {
    const limit = allowedPhraseEdits(phrase.length);
    if (limit === 0) continue;
    const distance = fuzzyDistance(core, phrase, limit);
    if (distance === undefined) continue;
    if (!best || distance < best.distance) { best = { distance, entry }; ambiguous = false; }
    else if (distance === best.distance && entry.id !== best.entry.id) ambiguous = true;
  }
  return best && !ambiguous ? best.entry : undefined;
};

/* ------------------------------------------------------------------------------------------------------------------ */
/* Replies                                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------ */

const SMALL_TALK: Record<"greeting" | "thanks" | "farewell" | "cancel", readonly string[]> = {
  greeting: ["¡Hola! ¿En qué te ayudo?", "¡Hola! Dime qué necesitas.", "Hola, aquí estoy. ¿Qué hacemos?"],
  thanks: ["¡Con gusto!", "De nada.", "Para eso estoy."],
  farewell: ["¡Hasta luego!", "Aquí estaré cuando me necesites.", "Nos vemos."],
  cancel: ["Listo, lo dejamos así.", "De acuerdo, no hago nada.", "Cancelado."]
};

const HELP_ONLINE = [
  "Puedo abrir tus aplicaciones, buscar archivos, decirte la hora y la fecha, leerte tu agenda y contarte cómo va tu equipo. Con conexión también creo tareas y eventos, preparo mensajes y pongo música.",
  "Esto es lo que sé hacer: abrir tus aplicaciones, buscar archivos, la hora y la fecha, tu agenda y el estado de tu equipo. Con conexión sumo tareas, eventos, mensajes y música."
];
const HELP_LOCAL = [
  "Estoy en modo local, sin conexión con OpenAI. Puedo abrir tus aplicaciones, buscar archivos, decirte la hora y la fecha, leerte tu agenda y contarte cómo va tu equipo. Escribe con Ctrl+K.",
  "Ahora estoy en modo local. Sé abrir tus aplicaciones, buscar archivos, la hora y la fecha, tu agenda y el estado de tu equipo. Para hablar necesito la clave de OpenAI; mientras tanto escribe con Ctrl+K."
];

/** Shown in local mode when nothing matched: it says so and gives three commands the local brain really supports. */
export const LOCAL_MODE_NOT_UNDERSTOOD =
  "Estoy en modo local y no entendí eso. Prueba con «qué hora es», «qué tengo hoy» o «cuánto espacio libre tengo».";

/* ------------------------------------------------------------------------------------------------------------------ */
/* Open an application                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------ */

const OPEN_VERBS = ["abre", "abrir", "abreme", "inicia", "iniciar", "ejecuta", "lanza"];
const OPEN_FILLER_WORDS = new Set(["por", "favor", "la", "el", "mi", "una", "un", "aplicacion", "app", "programa", "de", "del"]);

const matchesVerb = (token: string, verbs: readonly string[]): boolean => {
  if (verbs.includes(token)) return true;
  if (token.length < 4) return false;
  return verbs.some((verb) => verb.length >= 4 && fuzzyDistance(token, verb, 1) !== undefined);
};

const interpretOpenApplication = (core: string, context: LocalContext): LocalMatch => {
  const space = core.indexOf(" ");
  if (space < 0 || !matchesVerb(core.slice(0, space), OPEN_VERBS)) return NONE;
  const rest = core.slice(space + 1).trim();
  if (rest.length === 0 || rest.length > MAX_FUZZY_LENGTH) return NONE;
  const words = rest.split(" ");
  let skip = 0;
  while (skip < words.length - 1 && OPEN_FILLER_WORDS.has(words[skip]!)) skip += 1;
  const stripped = words.slice(skip).join(" ");
  const targets = [...new Set([rest, stripped])];

  type Candidate = { name: string; distance: number };
  const byFolded = new Map<string, Candidate>();
  for (const alias of context.registeredAliases) {
    const folded = foldForAlias(alias);
    if (folded.length === 0 || byFolded.has(folded)) continue;
    const limit = allowedAliasEdits(folded.length);
    let distance: number | undefined;
    for (const target of targets) {
      const found = target === folded ? 0 : limit === 0 ? undefined : fuzzyDistance(target, folded, limit);
      if (found !== undefined && (distance === undefined || found < distance)) distance = found;
    }
    if (distance !== undefined) byFolded.set(folded, { name: alias.trim(), distance });
  }
  const candidates = [...byFolded.values()];
  if (candidates.length === 0) return NONE;
  const exact = candidates.filter((candidate) => candidate.distance === 0);
  if (exact.length === 1) return openDraft(exact[0]!.name);
  if (candidates.length === 1) return openDraft(candidates[0]!.name);
  const names = (exact.length > 1 ? exact : candidates).slice(0, 4).map((candidate) => candidate.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} o ${names[names.length - 1]}` : names[0]!;
  return { kind: "clarify", intent: "open-app", question: `¿Cuál quieres abrir: ${list}?` };
};

const openDraft = (alias: string): LocalMatch => ({
  kind: "draft",
  intent: "open-app",
  draft: { action: "OPEN_APPLICATION", input: JSON.stringify({ alias }) }
});

/* ------------------------------------------------------------------------------------------------------------------ */
/* Search files                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------ */

const SEARCH_VERBS = ["busca", "buscar", "buscame", "encuentra", "encontrar", "encuentrame", "localiza"];
const DETERMINER = /^(?:me\s+)?(?:(?:el|la|los|las|mi|mis|un|una|unos|unas)\s+)?/u;
const FILE_NOUN = /^(archivos?|documentos?|carpetas?|ficheros?|fotos?|imagenes|imagen|pdfs?)(?:\s+(?:(?:de|del|llamad[oa]s?|que se llame|con nombre)\s+)?|$)/u;
const ROOT_TAIL = /\s+en\s+(?:(?:mis|mi|la|el|los|las)\s+)?(?:carpeta\s+de\s+)?(documentos|escritorio|descargas|imagenes|fotos|musica|videos)$/u;
const ROOT_BY_NAME: Record<string, string> = {
  documentos: "DOCUMENTS", escritorio: "DESKTOP", descargas: "DOWNLOADS", imagenes: "PICTURES", fotos: "PICTURES", musica: "MUSIC", videos: "VIDEOS"
};
const MAX_QUERY_WORDS = 6;
const MAX_QUERY_LENGTH = 60;

const interpretSearchFiles = (original: string, mode: LocalMode): LocalMatch => {
  // The one-to-one fold keeps every index valid in the original text, so the query keeps its own accents and case.
  const text = original.trim();
  const folded = foldAccentsOneToOne(text).toLocaleLowerCase("es");
  const verbMatch = /^([a-zñ]+)\s+/u.exec(folded);
  if (!verbMatch || !matchesVerb(verbMatch[1]!, SEARCH_VERBS)) return NONE;
  let offset = verbMatch[0].length;
  const advance = (pattern: RegExp): RegExpExecArray | null => {
    const found = pattern.exec(folded.slice(offset));
    if (found) offset += found[0].length;
    return found;
  };
  advance(DETERMINER);
  const noun = advance(FILE_NOUN);
  let end = folded.length;
  const tail = ROOT_TAIL.exec(folded.slice(offset));
  if (tail) end = offset + tail.index;
  const root = tail ? ROOT_BY_NAME[tail[1]!] ?? null : null;
  if (mode === "strict" && !noun && !root) return NONE;
  const query = trimQuotesAndTrailingPunctuation(text.slice(offset, end));
  if (query.length === 0) return { kind: "clarify", intent: "search-files", question: "¿Qué archivo quieres buscar?" };
  if (query.length > MAX_QUERY_LENGTH || query.split(/\s+/u).length > MAX_QUERY_WORDS) return NONE;
  const nounWord = noun?.[1] ?? "";
  const kind = /^carpetas?$/u.test(nounWord) ? "FOLDER" : /^(?:fotos?|imagenes?)$/u.test(nounWord) ? "IMAGE" : null;
  return { kind: "draft", intent: "search-files", draft: { action: "SEARCH_FILES", input: null, filesAction: { query, root, kind } } };
};

/* ------------------------------------------------------------------------------------------------------------------ */
/* Entry point                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------------ */

const safeKeyAvailable = (context: LocalContext): boolean => {
  try { return context.isKeyAvailable(); } catch { return false; }
};

const helpText = (context: LocalContext): string => (context.pick ?? firstVariant)(safeKeyAvailable(context) ? HELP_ONLINE : HELP_LOCAL);

const fromEntry = (entry: PhraseEntry, context: LocalContext): LocalMatch => {
  const pick = context.pick ?? firstVariant;
  if (entry.draft) return { kind: "draft", intent: entry.intent, draft: entry.draft };
  if (entry.intent === "help") return { kind: "reply", intent: "help", text: helpText(context) };
  const key = entry.intent as keyof typeof SMALL_TALK;
  return { kind: "reply", intent: entry.intent, text: pick(SMALL_TALK[key]) };
};

/** Matches one user turn. Never throws; anything it does not recognize with high confidence is `none`. */
export const matchLocalIntent = (text: string, context: LocalContext, mode: LocalMode = "strict"): LocalMatch => {
  try {
    if (typeof text !== "string") return NONE;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_LOCAL_INPUT_LENGTH) return NONE;
    const { folded, core } = normalize(trimmed);
    if (core.length === 0 || core.length > MAX_LOCAL_INPUT_LENGTH) return NONE;
    // The text without its polite words first; the whole folded text next, for phrases that start or end with such a word.
    const phrase = matchPhrase(core) ?? (folded === core ? undefined : matchPhrase(folded));
    if (phrase) return fromEntry(phrase, context);
    const opened = interpretOpenApplication(core, context);
    if (opened.kind !== "none") return opened;
    return interpretSearchFiles(stripLeadingFillers(trimmed), mode);
  } catch {
    return NONE;
  }
};

/** Removes the same leading polite words as `normalize`, on the original text, so the search query keeps its own spelling. */
const stripLeadingFillers = (original: string): string => {
  let text = original.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of ["por favor", "oye", "ares", "disculpa", "hola", "ok", "hey", "ey"]) {
      const match = new RegExp(`^${filler}[\\s,.;:!¡¿?]+(?=\\S)`, "iu").exec(foldAccentsOneToOne(text));
      if (match) { text = text.slice(match[0].length); changed = true; }
    }
  }
  return text;
};

/* ------------------------------------------------------------------------------------------------------------------ */
/* Provider-shaped output                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------ */

const EMPTY_DRAFT_FIELDS = {
  approvedWeb: null, catalogApplication: null, filesAction: null, messagingAction: null, weatherQuery: null, systemInfo: null, spotifySearch: null, spotifyControl: null
} as const;

/**
 * The exact JSON text the cloud provider would have returned for the same request, so the same parser and validators run on
 * it. Replies become CONVERSATIONAL results and drafts become READY results; a clarification is answered directly.
 */
export const toProviderOutput = (match: Extract<LocalMatch, { kind: "reply" | "draft" }>): string =>
  JSON.stringify(
    match.kind === "reply"
      ? { state: "CONVERSATIONAL", summary: "Respuesta local.", responseText: match.text, drafts: [], clarifications: [] }
      : {
          state: "READY",
          summary: "Preparado en modo local.",
          responseText: "",
          drafts: [{ ...EMPTY_DRAFT_FIELDS, action: match.draft.action, input: match.draft.input, ...(match.draft.filesAction ? { filesAction: match.draft.filesAction } : {}), ...(match.draft.systemInfo ? { systemInfo: match.draft.systemInfo } : {}) }],
          clarifications: []
        }
  );
