import { describe, expect, it } from "vitest";

import { OPENAI_INTERPRETATION_OUTPUT_SCHEMA } from "../src/main/assistant/openai-structured-provider";

type SchemaNode = Record<string, unknown>;

const isRecord = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectObjectSchemas = (value: unknown): SchemaNode[] => {
  if (Array.isArray(value)) return value.flatMap(collectObjectSchemas);
  if (!isRecord(value)) return [];

  return [
    ...(value.type === "object" ? [value] : []),
    ...Object.values(value).flatMap(collectObjectSchemas)
  ];
};

describe("OpenAI structured interpretation provider", () => {
  it("uses a strict schema whose every object rejects additional properties", () => {
    const objectSchemas = collectObjectSchemas(OPENAI_INTERPRETATION_OUTPUT_SCHEMA);

    expect(objectSchemas.length).toBeGreaterThan(0);
    expect(objectSchemas.every((schema) => schema.additionalProperties === false)).toBe(true);
  });

  it("uses a bounded JSON input string that the Main interpreter validates before draft creation", () => {
    const drafts = OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.drafts;
    if (!drafts || !("items" in drafts)) throw new Error("Expected draft schema.");
    const input = drafts.items.properties.input;

    expect(input).toEqual({ type: "string", maxLength: 6_000 });
  });

  it("uses an explicit closed enum and bounded ordered array for every draft", () => {
    const drafts = OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.drafts;
    if (!drafts || !("items" in drafts)) throw new Error("Expected draft schema.");
    const action = drafts.items.properties.action;

    expect(action).toMatchObject({
      type: "string",
      enum: expect.arrayContaining([
        "CREATE_TASK",
        "CREATE_EVENT",
        "CREATE_REMINDER",
        "OPEN_APPLICATION",
        "OPEN_WEB_PAGE",
        "SEARCH_FILES",
        "CREATE_FOLDER",
        "RENAME_FILE",
        "RENAME_FOLDER",
        "MOVE_FILE",
        "ORGANIZE_FILES"
      ])
    });
    expect(action.enum).toHaveLength(16);
    expect(drafts.maxItems).toBe(8);
  });
});
