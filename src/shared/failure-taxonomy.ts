/**
 * Factory for a closed failure taxonomy: one const table of code to bounded Spanish message is the single source of truth.
 * From that table it derives the code union type, a runtime guard, a message lookup and the failure and success result
 * shapes, so a code can never exist without its message (there is no second table to forget) and a message can never be
 * reached through an unchecked key.
 *
 * Every message in a table must be a fixed sentence: it may not interpolate or contain user data (names, queries, paths,
 * numbers typed by the person, provider text). tests/failure-taxonomy.test.ts walks every taxonomy and rejects digit runs,
 * path-like and URL-like fragments and interpolation placeholders.
 */

export type FailureMessageTable = Readonly<Record<string, string>>;

export type TaxonomyFailure<Code extends string> = { ok: false; error: { code: Code; userMessage: string } };
export type TaxonomyResult<Data, Code extends string> = { ok: true; data: Data } | TaxonomyFailure<Code>;

export type FailureTaxonomy<Table extends FailureMessageTable> = {
  /** The table itself, typed with literal keys and values. */
  readonly messages: Table;
  /** Every code, in table order. */
  readonly codes: ReadonlyArray<keyof Table & string>;
  /** True only for an own property of the table: prototype names such as "constructor" or "__proto__" are unknown codes. */
  readonly isCode: (value: unknown) => value is keyof Table & string;
  /** The fixed message of a known code. It never returns anything but the table's own text. */
  readonly messageFor: (code: keyof Table & string) => string;
  readonly failure: (code: keyof Table & string) => TaxonomyFailure<keyof Table & string>;
  readonly success: <Data>(data: Data) => TaxonomyResult<Data, keyof Table & string>;
};

export const defineFailureTaxonomy = <const Table extends FailureMessageTable>(messages: Table): FailureTaxonomy<Table> => {
  type Code = keyof Table & string;
  const codes = Object.keys(messages) as Code[];
  const messageFor = (code: Code): string => messages[code];
  return {
    messages,
    codes,
    isCode: (value): value is Code => typeof value === "string" && Object.hasOwn(messages, value),
    messageFor,
    failure: (code) => ({ ok: false, error: { code, userMessage: messageFor(code) } }),
    success: (data) => ({ ok: true, data })
  };
};
