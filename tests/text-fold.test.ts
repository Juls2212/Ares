import { describe, expect, it } from "vitest";

import {
  POLITE_PREFIX,
  POLITE_PREFIX_ANCHORED,
  POLITE_PREFIX_FOLDED,
  createPhraseMatcher,
  createPhraseSet,
  escapeRegExp
} from "../src/shared/phrase-kit";
import {
  collapseAndTrim,
  collapseWhitespace,
  foldAccentsOneToOne,
  foldCaseAndDiacritics,
  foldEventTitle,
  foldForAlias,
  foldLooseText,
  foldSpanishWord,
  lowerTrim,
  stripCombiningMarks,
  stripCompatibilityMarks,
  stripDiacritics,
  trimNameFragment,
  trimQuotesAndTrailingPunctuation,
  unwrapQuotedText
} from "../src/shared/text-fold";
import { listSourceFiles, readSource } from "./helpers/read-source";
import { FOLD_INPUTS, LONG_INPUT, UTTERANCES } from "./helpers/text-corpus";

/**
 * Frozen copies of the implementations that existed before the shared kit (Refactor 4.1). They are the oracle: the kit must
 * give the same result for every corpus input. They live only here, so the old behavior stays pinned after the old code is gone.
 */
const LEGACY = {
  // known-application-catalog.ts: normalizeApplicationAlias
  alias: (value: string): string =>
    value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").trim(),
  // supervised-file-validation.ts normalizeForMatching and assistant-safety.ts normalizeForSafetyCheck (identical bodies)
  caseAndDiacritics: (value: string): string => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US"),
  // planner-temporal-resolution.ts: normalizeSpanish
  spanishWord: (value: string): string => value.trim().toLocaleLowerCase("es").normalize("NFD").replace(/\p{Diacritic}/gu, ""),
  // assistant-interpreter.ts: foldForMatch
  looseText: (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-CO"),
  // found-file-mutations.ts: foldAccents
  accentsOneToOne: (value: string): string =>
    value.replace(/[áàä]/gu, "a").replace(/[éèë]/gu, "e").replace(/[íìï]/gu, "i").replace(/[óòö]/gu, "o").replace(/[úùü]/gu, "u")
      .replace(/[ÁÀÄ]/gu, "A").replace(/[ÉÈË]/gu, "E").replace(/[ÍÌÏ]/gu, "I").replace(/[ÓÒÖ]/gu, "O").replace(/[ÚÙÜ]/gu, "U"),
  // catalog-application-registration.ts and custom-application-registration-service.ts: normalize
  lowerTrim: (value: string): string => value.trim().toLocaleLowerCase("en-US"),
  // assistant-event-reference.ts: normalizeEventTitle
  eventTitle: (title: string): string => title.normalize("NFC").trim().toLocaleLowerCase("es"),
  // custom-application-registration-service.ts: first two steps of deriveAlias
  compatibilityMarks: (value: string): string => value.normalize("NFKD").replace(/\p{M}/gu, ""),
  // event-delivery-service, reminder-delivery-service: title.replace(/\s+/gu, " ").trim()
  collapseAndTrim: (value: string): string => value.replace(/\s+/gu, " ").trim(),
  // weather-validation.ts: value.trim().replace(/\s+/gu, " ")
  weatherCollapse: (value: string): string => value.trim().replace(/\s+/gu, " "),
  // speech-text-normalizer.ts: .replace(/\s+/g, " ").trim()
  speechCollapse: (value: string): string => value.replace(/\s+/g, " ").trim(),
  // messaging-phrases.ts stripTrailingPunctuation and streaming-phrases.ts cleanQuery (identical bodies)
  quotesAndPunctuation: (value: string): string => value.trim().replace(/^[«"“'‘]+/u, "").replace(/[»"”'’.,;:!?¡¿]+$/u, "").trim(),
  // found-file-mutations.ts: tidyName
  nameFragment: (value: string): string =>
    value.trim().replace(/[.,;!?]+$/u, "").replace(/^[«"'“”‘’]+|[«"'“”‘’»]+$/gu, "").replace(/[.,;!?]+$/u, "").trim(),
  // messaging-phrases.ts: stripBodyQuotes
  unwrapQuoted: (value: string): string => {
    const trimmed = value.trim();
    const quoted = trimmed.match(/^[«"“](.+)[»"”]$/su);
    return (quoted ? quoted[1] : trimmed).trim();
  },
  // found-file-mutations.ts: the original ALL_SELECTION regex
  allSelection: /^(?:todo|todos|todas|todo esto|todos estos|todos esos|todos los (?:archivos|resultados|elementos|items)|estos(?: archivos| elementos| resultados)?|estas|esos(?: archivos| elementos| resultados)?|esas|los (?:archivos|resultados|elementos))$/u
};

const CORPUS = [...FOLD_INPUTS, ...UTTERANCES, LONG_INPUT, "a".repeat(10_000), " ".repeat(10_000) + "x", "ñ".repeat(5000), "«".repeat(5000) + "x" + ".".repeat(5000)];

const PAIRS: Array<[string, (value: string) => string, (value: string) => string]> = [
  ["foldForAlias", foldForAlias, LEGACY.alias],
  ["foldCaseAndDiacritics", foldCaseAndDiacritics, LEGACY.caseAndDiacritics],
  ["foldSpanishWord", foldSpanishWord, LEGACY.spanishWord],
  ["foldLooseText", foldLooseText, LEGACY.looseText],
  ["foldAccentsOneToOne", foldAccentsOneToOne, LEGACY.accentsOneToOne],
  ["lowerTrim", lowerTrim, LEGACY.lowerTrim],
  ["foldEventTitle", foldEventTitle, LEGACY.eventTitle],
  ["stripCompatibilityMarks", stripCompatibilityMarks, LEGACY.compatibilityMarks],
  ["collapseAndTrim (delivery bodies)", collapseAndTrim, LEGACY.collapseAndTrim],
  ["collapseAndTrim (weather place)", collapseAndTrim, LEGACY.weatherCollapse],
  ["collapseAndTrim (speech text)", collapseAndTrim, LEGACY.speechCollapse],
  ["trimQuotesAndTrailingPunctuation", trimQuotesAndTrailingPunctuation, LEGACY.quotesAndPunctuation],
  ["trimNameFragment", trimNameFragment, LEGACY.nameFragment],
  ["unwrapQuotedText", unwrapQuotedText, LEGACY.unwrapQuoted]
];

describe("text kit reproduces every folding that existed before", () => {
  for (const [name, kit, legacy] of PAIRS) {
    it(`${name} equals the frozen legacy implementation over the whole corpus`, () => {
      for (const input of CORPUS) expect(kit(input), `${name}: ${JSON.stringify(input.slice(0, 30))}`).toBe(legacy(input));
    });
  }
});

describe("variants that differ keep their differences", () => {
  /** The exact inputs where two variants diverge, with what each returns. These are the reasons they are separate functions. */
  const DIVERGENCE: Array<{ input: string; results: Record<string, string> }> = [
    {
      input: "  Núñez, José!  ",
      results: {
        foldForAlias: "nunez jose",
        foldCaseAndDiacritics: "  nunez, jose!  ",
        foldSpanishWord: "nunez, jose!",
        foldLooseText: "núñez, josé!".normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        foldEventTitle: "núñez, josé!",
        foldAccentsOneToOne: "  Nuñez, Jose!  "
      }
    },
    {
      input: "a^b`c´d¨e",
      results: {
        foldForAlias: "abcde",
        foldCaseAndDiacritics: "abcde",
        foldSpanishWord: "abcde",
        foldLooseText: "a^b`c´d¨e",
        foldEventTitle: "a^b`c´d¨e",
        foldAccentsOneToOne: "a^b`c´d¨e"
      }
    },
    {
      input: "Ñandú  PINGÜINO",
      results: {
        foldForAlias: "nandu pinguino",
        foldCaseAndDiacritics: "nandu  pinguino",
        foldSpanishWord: "nandu  pinguino",
        foldLooseText: "nandu pinguino",
        foldEventTitle: "ñandú  pingüino",
        foldAccentsOneToOne: "Ñandu  PINGUINO"
      }
    }
  ];

  const FOLDERS: Record<string, (value: string) => string> = {
    foldForAlias, foldCaseAndDiacritics, foldSpanishWord, foldLooseText, foldEventTitle, foldAccentsOneToOne
  };

  for (const { input, results } of DIVERGENCE) {
    it(`gives each variant its own result for ${JSON.stringify(input)}`, () => {
      for (const [name, expected] of Object.entries(results)) expect(FOLDERS[name]!(input), name).toBe(expected);
    });
  }

  it("keeps ñ only in foldAccentsOneToOne and foldEventTitle; every decomposing fold turns ñ into n and ü into u", () => {
    for (const fold of [foldForAlias, foldCaseAndDiacritics, foldSpanishWord, foldLooseText]) {
      expect(fold("ñü")).toBe("nu");
      expect(fold("ÑÜ")).toBe("nu");
    }
    expect(foldAccentsOneToOne("ñÑüÜ")).toBe("ñÑuU");
    expect(foldEventTitle("ñÑüÜ")).toBe("ññüü");
  });

  it("separates the two diacritic strippers: only the Diacritic property removes ^ ` ´ ¨", () => {
    expect(stripDiacritics("a^b`c´d¨e")).toBe("abcde");
    expect(stripCombiningMarks("a^b`c´d¨e")).toBe("a^b`c´d¨e");
    expect(stripCombiningMarks("ñü")).toBe("nu");
    expect(stripCompatibilityMarks("ﬁ ñ")).toBe("fi n");
    expect(stripDiacritics("ﬁ")).toBe("ﬁ");
  });

  it("separates the quote trimmers on the inputs where they differ", () => {
    expect(trimQuotesAndTrailingPunctuation("«Hola»!?")).toBe("Hola");
    expect(trimNameFragment("«Hola»!?")).toBe("Hola");
    expect(trimQuotesAndTrailingPunctuation("¡Hola!")).toBe("¡Hola");
    expect(trimNameFragment("¡Hola!")).toBe("¡Hola");
    expect(trimQuotesAndTrailingPunctuation("Hola:")).toBe("Hola");
    expect(trimNameFragment("Hola:")).toBe("Hola:");
    expect(trimQuotesAndTrailingPunctuation("'.Hola")).toBe(".Hola");
    expect(trimNameFragment("Hola.»")).toBe("Hola");
    expect(unwrapQuotedText("«a «b» c»")).toBe("a «b» c");
    expect(unwrapQuotedText("«abierto")).toBe("«abierto");
    expect(trimQuotesAndTrailingPunctuation("«abierto")).toBe("abierto");
  });
});

describe("text kit properties", () => {
  it("handles empty, blank and very long input", () => {
    for (const [name, kit] of PAIRS) {
      expect(typeof kit(""), name).toBe("string");
      expect(kit(LONG_INPUT).length, name).toBeGreaterThan(0);
    }
    expect(foldForAlias("")).toBe("");
    expect(foldForAlias("   ")).toBe("");
    expect(collapseWhitespace("a \t\n b")).toBe("a b");
  });

  it("is idempotent over the whole corpus for every fold, with a place to document any exception", () => {
    const FOLDERS: Record<string, (value: string) => string> = {
      foldForAlias, foldCaseAndDiacritics, foldSpanishWord, foldLooseText, foldAccentsOneToOne, lowerTrim, collapseAndTrim,
      stripDiacritics, stripCombiningMarks, stripCompatibilityMarks
    };
    const offenders = (fold: (value: string) => string): string[] => CORPUS.filter((input) => input.length < 100 && fold(fold(input)) !== fold(input));
    // Every fold is idempotent over the corpus, including «İ» (whose lowercase form is «i» plus a combining dot). The map is kept
    // so that an input where a fold is not idempotent has to be documented here instead of passing silently.
    const EXPECTED_NON_IDEMPOTENT: Record<string, string[]> = {};
    for (const [name, fold] of Object.entries(FOLDERS)) expect(offenders(fold), name).toEqual(EXPECTED_NON_IDEMPOTENT[name] ?? []);
  });

  it("does not backtrack catastrophically on 10,000-character adversarial input", () => {
    const adversarial = ["a".repeat(10_000), " ".repeat(10_000) + "x", "«".repeat(5000) + "x" + ".".repeat(5000), "\"".repeat(10_000), LONG_INPUT];
    const started = performance.now();
    for (const input of adversarial) for (const [, kit] of PAIRS) kit(input);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("phrase kit", () => {
  const SELECTION_PHRASES = [
    "todo", "todos", "todas", "todo esto", "todos estos", "todos esos",
    "todos los archivos", "todos los resultados", "todos los elementos", "todos los items",
    "estos", "estos archivos", "estos elementos", "estos resultados", "estas",
    "esos", "esos archivos", "esos elementos", "esos resultados", "esas",
    "los archivos", "los resultados", "los elementos"
  ];

  it("builds a whole-string matcher that accepts exactly what the old ALL_SELECTION regex accepted", () => {
    const matcher = createPhraseMatcher(SELECTION_PHRASES);
    const probes = [
      ...SELECTION_PHRASES,
      ...SELECTION_PHRASES.flatMap((phrase) => [` ${phrase}`, `${phrase} `, `${phrase}s`, `x${phrase}`, phrase.toUpperCase(), `${phrase} y mas`]),
      "todos los", "estos archivo", "los", "todo  esto", "esos elementos resultados", "", "todos los items ", ...FOLD_INPUTS, ...UTTERANCES
    ];
    for (const probe of probes) expect(matcher.test(probe), JSON.stringify(probe)).toBe(LEGACY.allSelection.test(probe));
  });

  it("matches literally, prefers longer phrases, and stays linear on long input", () => {
    const matcher = createPhraseMatcher(["a.b", "a", "a b"]);
    expect(matcher.test("a.b")).toBe(true);
    expect(matcher.test("axb")).toBe(false);
    expect(matcher.test("a b")).toBe(true);
    expect(matcher.test("a bc")).toBe(false);
    expect(escapeRegExp("a+b(c)")).toBe("a\\+b\\(c\\)");
    const started = performance.now();
    expect(createPhraseMatcher(SELECTION_PHRASES).test("todos los ".repeat(1000))).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(() => createPhraseMatcher([])).toThrow();
  });

  it("builds a membership set where both sides go through the same fold", () => {
    const set = createPhraseSet(["muestra", "enséñame", "Ábreme"], foldForAlias);
    expect(set.has("muestra")).toBe(true);
    expect(set.has("ensename")).toBe(true);
    expect(set.has("abreme")).toBe(true);
    expect(set.has("ABRÉME")).toBe(true);
    expect(set.has("abre")).toBe(false);
  });

  it("keeps the polite prefixes as the exact fragments the matchers used", () => {
    expect(POLITE_PREFIX).toBe("(?:por\\s+favor,?\\s+)?");
    expect(POLITE_PREFIX_FOLDED).toBe("(?:por favor )?");
    expect(POLITE_PREFIX_ANCHORED).toBe("^\\s*(?:por favor[, ]+)?");
  });

  it("makes the folded polite prefix accept exactly what the general one accepts on folded text, and never on unfolded text where they differ", () => {
    const general = new RegExp(`^${POLITE_PREFIX}pausa$`, "u");
    const folded = new RegExp(`^${POLITE_PREFIX_FOLDED}pausa$`, "u");
    for (const utterance of [...UTTERANCES, "por favor pausa", "por favor, pausa", "Por favor   pausa", "pausa"]) {
      const text = foldForAlias(utterance);
      expect(folded.test(text), JSON.stringify(utterance)).toBe(general.test(text));
    }
    // On unfolded text they differ, which is why the folded fragment is a separate, explicitly named constant.
    expect(general.test("por favor, pausa")).toBe(true);
    expect(folded.test("por favor, pausa")).toBe(false);
  });
});

describe("no ad-hoc folding outside the kit", () => {
  /**
   * Any new diacritic or Unicode-form folding must live in src/shared/text-fold.ts. The patterns look for the ways code folds
   * text: normalize("NF…"), the combining-mark range, and \p{Diacritic} or \p{M} used inside replace(). Character classes such
   * as [\p{L}\p{M}\p{N}] in validators are not folding and are not flagged; path.win32.normalize is a filesystem call.
   */
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["String.prototype.normalize with a Unicode form", /(?<![.\w])(?:[\w\])"'`]+)\.normalize\(\s*["'`]NF/u],
    ["combining-mark range", /\\u0300/u],
    ["\\p{Diacritic}", /\\p\{Diacritic\}/u],
    ["\\p{M} stripped with replace", /replace\(\s*\/\\p\{M\}/u],
    ["hand-written accent fold", /replace\(\s*\/\[á/u]
  ];
  const ALLOWED = new Set(["src/shared/text-fold.ts"]);

  it("finds no folding outside the kit (the kit itself is the only allowed file)", () => {
    const offenders: string[] = [];
    for (const file of ["src/main", "src/shared", "src/renderer", "src/preload"].flatMap(listSourceFiles)) {
      if (ALLOWED.has(file)) continue;
      const text = readSource(file);
      for (const [name, pattern] of FORBIDDEN) if (pattern.test(text)) offenders.push(`${file}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });

  it("still detects folding when it appears (the guard patterns are not vacuous)", () => {
    expect(FORBIDDEN[0]![1].test('const x = value.normalize("NFD");')).toBe(true);
    expect(FORBIDDEN[0]![1].test("path.win32.normalize(x)")).toBe(false);
    expect(FORBIDDEN[1]![1].test("replace(/[\\u0300-\\u036f]/g, '')")).toBe(true);
    expect(FORBIDDEN[2]![1].test("replace(/\\p{Diacritic}/gu, '')")).toBe(true);
    expect(FORBIDDEN[3]![1].test("text.replace(/\\p{M}/gu, '')")).toBe(true);
    expect(FORBIDDEN[3]![1].test("/^[\\p{L}\\p{M}\\p{N}]+$/u")).toBe(false);
    expect(FORBIDDEN[4]![1].test('value.replace(/[áàä]/gu, "a")')).toBe(true);
  });

  it("keeps the kit as the only module that defines these folds", () => {
    const kit = readSource("src/shared/text-fold.ts");
    for (const [, pattern] of FORBIDDEN.slice(0, 3)) expect(pattern.test(kit)).toBe(true);
  });
});
