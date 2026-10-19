import { normalizeApplicationAlias } from "../applications/known-application-catalog";

/**
 * Deterministic parsing of «abre/muestra el segundo archivo» and «abre <nombre>» phrases. It only
 * classifies text; it never reads the last-search store and never produces a path.
 */
export type OrdinalReference = number | "LAST";

export type FoundFileCommandAction = "OPEN_FOUND_FILE" | "REVEAL_FOUND_FILE";

export type FoundFileCommand = {
  action: FoundFileCommandAction;
  target:
    | { kind: "ORDINAL"; ordinal: number | "LAST" }
    | { kind: "NAME"; name: string };
};

const OPEN_VERBS = ["abre", "abrir", "abreme", "abrelo", "abrela"];
const REVEAL_VERBS = ["muestra", "muestrame", "mostrar", "ensename", "ensena", "enseñame"];

const ORDINAL_WORDS: Readonly<Record<string, number | "LAST">> = {
  primero: 1, primer: 1, primera: 1,
  segundo: 2, segunda: 2,
  tercero: 3, tercer: 3, tercera: 3,
  cuarto: 4, cuarta: 4,
  quinto: 5, quinta: 5,
  sexto: 6, sexta: 6,
  septimo: 7, septima: 7,
  octavo: 8, octava: 8,
  noveno: 9, novena: 9,
  decimo: 10, decima: 10,
  ultimo: "LAST", ultima: "LAST"
};

const CARDINAL_WORDS: Readonly<Record<string, number>> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10
};

const RESULT_NOUNS = new Set(["archivo", "documento", "carpeta", "resultado", "elemento", "fichero"]);
const ARTICLES = new Set(["el", "la", "lo", "los", "las", "un", "una"]);

const dropLeading = (tokens: string[], words: ReadonlySet<string>): string[] =>
  tokens.length > 1 && words.has(tokens[0] as string) ? tokens.slice(1) : tokens;

const parseOrdinalTokens = (tokens: string[]): number | "LAST" | undefined => {
  // «el segundo», «segundo archivo», «el numero 3», «numero tres archivo», «el 2»
  let rest = tokens;
  if (rest.length > 1 && RESULT_NOUNS.has(rest[rest.length - 1] as string)) rest = rest.slice(0, -1);
  if (rest.length === 1) {
    const word = rest[0] as string;
    if (word in ORDINAL_WORDS) return ORDINAL_WORDS[word];
    if (/^\d{1,2}$/u.test(word)) return Number(word);
    return undefined;
  }
  if (rest.length === 2 && (rest[0] === "numero" || rest[0] === "n")) {
    const word = rest[1] as string;
    if (/^\d{1,2}$/u.test(word)) return Number(word);
    if (word in CARDINAL_WORDS) return CARDINAL_WORDS[word];
  }
  return undefined;
};

/** Reads one ordinal phrase such as «el segundo archivo», «el último» or «el número 3». */
export const parseOrdinalPhrase = (phrase: string): OrdinalReference | undefined => {
  const tokens = normalizeApplicationAlias(phrase).split(" ").filter((token) => token.length > 0);
  return tokens.length === 0 ? undefined : parseOrdinalTokens(dropLeading(tokens, ARTICLES));
};

export const parseFoundFileCommand = (instruction: string): FoundFileCommand | undefined => {
  let tokens = normalizeApplicationAlias(instruction).split(" ").filter((token) => token.length > 0);
  if (tokens[0] === "por" && tokens[1] === "favor") tokens = tokens.slice(2);
  if (tokens.length < 2) return undefined;
  const verb = tokens[0] as string;
  const action: FoundFileCommandAction | undefined = OPEN_VERBS.includes(verb)
    ? "OPEN_FOUND_FILE"
    : REVEAL_VERBS.map((candidate) => normalizeApplicationAlias(candidate)).includes(verb)
      ? "REVEAL_FOUND_FILE"
      : undefined;
  if (!action) return undefined;

  const afterVerb = dropLeading(tokens.slice(1), ARTICLES);
  const ordinal = parseOrdinalTokens(afterVerb);
  if (ordinal !== undefined) return { action, target: { kind: "ORDINAL", ordinal } };

  // «abre el archivo informe» / «abre informe»: the remaining words are a candidate display name.
  const nameTokens = dropLeading(dropLeading(afterVerb, RESULT_NOUNS), ARTICLES);
  if (nameTokens.every((token) => RESULT_NOUNS.has(token) || ARTICLES.has(token))) return undefined;
  const name = nameTokens.join(" ").trim();
  return name.length >= 2 ? { action, target: { kind: "NAME", name } } : undefined;
};
