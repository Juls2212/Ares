import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiStructuredProvider,
  OPENAI_INTERPRETATION_OUTPUT_SCHEMA
} from "../src/main/assistant/openai-structured-provider";

type SchemaNode = Record<string, unknown>;

const isRecord = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectObjectSchemas = (value: unknown): SchemaNode[] => {
  if (Array.isArray(value)) return value.flatMap(collectObjectSchemas);
  if (!isRecord(value)) return [];

  return [
    ...(value.type === "object" || "properties" in value ? [value] : []),
    ...Object.values(value).flatMap(collectObjectSchemas)
  ];
};

const draftVariants = (): readonly SchemaNode[] => {
  const drafts = OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.drafts as SchemaNode;
  const items = drafts.items as SchemaNode;
  return items.anyOf as readonly SchemaNode[];
};

const propertiesOf = (schema: SchemaNode): SchemaNode => schema.properties as SchemaNode;

describe("OpenAI structured interpretation provider", () => {
  it("uses a strict schema whose every object constraint rejects additional properties", () => {
    const objectSchemas = collectObjectSchemas(OPENAI_INTERPRETATION_OUTPUT_SCHEMA);

    expect(objectSchemas.length).toBeGreaterThan(0);
    expect(objectSchemas.every((schema) => schema.additionalProperties === false)).toBe(true);
  });

  it("submits the same closed schema to the SDK request", async () => {
    const create = vi.fn(async () => ({ output_text: "{}" }));
    const provider = createOpenAiStructuredProvider(
      { apiKey: "test-only", model: "test-only" },
      { responses: { create } } as never
    );
    const controller = new AbortController();

    await provider.interpret({
      instruction: "hola",
      reference: { now: "2026-10-12T12:00:00.000Z", timeZone: "America/Bogota" },
      signal: controller.signal
    });

    expect(create).toHaveBeenCalledOnce();
    const [request, options] = create.mock.calls[0] as unknown as [{ text: { format: { schema: unknown } } }, { signal: AbortSignal }];
    expect(request.text.format.schema).toBe(OPENAI_INTERPRETATION_OUTPUT_SCHEMA);
    expect(options.signal).toBe(controller.signal);
  });

  it("has a bounded conversational response variant alongside the typed action states", () => {
    expect(OPENAI_INTERPRETATION_OUTPUT_SCHEMA.required).toContain("responseText");
    expect(OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.responseText).toEqual({ type: "string", maxLength: 400 });
    expect(OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.state.enum).toContain("CONVERSATIONAL");
  });

  it("uses complete closed draft variants with no weekly-routine or habit fields", () => {
    const variants = draftVariants();
    expect(variants).toHaveLength(2);
    for (const variant of variants) {
      expect(variant).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["action", "input", "approvedWeb", "catalogApplication", "filesAction", "messagingAction", "weatherQuery", "spotifySearch", "spotifyControl"]
      });
      expect(Object.keys(propertiesOf(variant)).sort()).toEqual(
        ["action", "approvedWeb", "catalogApplication", "filesAction", "input", "messagingAction", "spotifyControl", "spotifySearch", "weatherQuery"]
      );
    }
    expect(JSON.stringify(OPENAI_INTERPRETATION_OUTPUT_SCHEMA)).not.toMatch(/weekly|habit|routine|weekday/iu);
  });

  it("keeps the weather query closed: a bounded place and day offset, nothing else", () => {
    const nonCatalog = draftVariants().find((variant) => {
      const action = propertiesOf(variant).action as SchemaNode;
      return Array.isArray(action.enum) && action.enum.includes("GET_WEATHER");
    });
    if (!nonCatalog) throw new Error("Expected the draft variant that lists GET_WEATHER.");
    const weather = propertiesOf(nonCatalog).weatherQuery as SchemaNode;
    const weatherObject = (weather.anyOf as readonly SchemaNode[]).find((variant) => variant.type === "object");
    expect(weatherObject).toMatchObject({ additionalProperties: false, required: ["location", "dayOffset"] });
    expect(propertiesOf(weatherObject as SchemaNode)).toEqual({
      location: { anyOf: [{ type: "string", minLength: 1, maxLength: 80 }, { type: "null" }] },
      dayOffset: { anyOf: [{ type: "integer", minimum: 0, maximum: 6 }, { type: "null" }] }
    });
    const catalog = draftVariants().find((variant) => (propertiesOf(variant).action as SchemaNode).enum?.toString() === "REGISTER_CATALOG_APPLICATION");
    expect((propertiesOf(catalog as SchemaNode).weatherQuery as SchemaNode)).toEqual({ type: "null" });
    for (const schema of collectObjectSchemas(OPENAI_INTERPRETATION_OUTPUT_SCHEMA)) expect(schema.additionalProperties, JSON.stringify(schema).slice(0, 60)).toBe(false);
  });

  it("keeps approved-site and catalog fields closed without accepting launch targets", () => {
    const variants = draftVariants();
    const nonCatalog = variants.find((variant) => {
      const action = propertiesOf(variant).action as SchemaNode;
      return Array.isArray(action.enum) && !action.enum.includes("REGISTER_CATALOG_APPLICATION");
    });
    const registration = variants.find((variant) => {
      const action = propertiesOf(variant).action as SchemaNode;
      return Array.isArray(action.enum) && action.enum.includes("REGISTER_CATALOG_APPLICATION");
    });
    if (!nonCatalog || !registration) throw new Error("Expected draft schema variants.");

    const approvedWeb = propertiesOf(nonCatalog).approvedWeb as SchemaNode;
    const approvedWebObject = (approvedWeb.anyOf as readonly SchemaNode[]).find((variant) => variant.type === "object");
    const catalogApplication = propertiesOf(registration).catalogApplication as SchemaNode;
    expect(approvedWebObject).toMatchObject({ additionalProperties: false, required: ["site", "query"] });
    expect(catalogApplication).toMatchObject({ additionalProperties: false, required: ["catalogKey", "alias"] });
    expect(JSON.stringify(OPENAI_INTERPRETATION_OUTPUT_SCHEMA)).not.toMatch(/path|command|protocol|argument|url/i);
  });

  it("uses a closed enum and bounded ordered array for every action draft", () => {
    const actions = draftVariants().flatMap((variant) => {
      const action = propertiesOf(variant).action as SchemaNode;
      return action.enum as readonly string[];
    });
    const drafts = OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.drafts as SchemaNode;

    expect(actions).toEqual(expect.arrayContaining([
      "CREATE_TASK",
      "CREATE_EVENT",
      "CREATE_REMINDER",
      "OPEN_APPLICATION",
      "REGISTER_CATALOG_APPLICATION",
      "GET_TODAY_SCHEDULE",
      "GET_WEEK_SCHEDULE"
    ]));
    expect(actions).toHaveLength(43);
    for (const removed of [
      "GET_WEEKLY_SCHEDULE_DETAILS", "ANALYZE_WEEKLY_SCHEDULE", "GET_TODAY_AVAILABILITY", "CREATE_WEEKLY_SCHEDULE",
      "UPDATE_WEEKLY_SCHEDULE", "CREATE_WEEKLY_ROUTINE", "UPDATE_WEEKLY_ROUTINE",
      "GET_HABIT_PROGRESS", "CREATE_HABIT", "UPDATE_HABIT", "COMPLETE_HABIT"
    ]) expect(actions).not.toContain(removed);
    for (const action of [
      "SEARCH_FILES", "REVEAL_FOUND_FILE", "OPEN_FOUND_FILE", "CREATE_FOLDER",
      "RENAME_FOUND_ITEM", "MOVE_FOUND_ITEMS", "ORGANIZE_FOUND_ITEMS", "DELETE_FOUND_ITEM"
    ]) expect(actions).toContain(action);
    for (const action of ["RENAME_FILE", "RENAME_FOLDER", "MOVE_FILE", "ORGANIZE_FILES", "DELETE_FILE", "DELETE_FOLDER"]) expect(actions).not.toContain(action);
    expect(actions).toContain("REQUEST_CUSTOM_APPLICATION_REGISTRATION");
    expect(actions).toContain("OPEN_APPROVED_PAGE");
    expect(actions).toContain("SEARCH_APPROVED_SITE");
    expect(actions).toContain("DELETE_EVENT");
    expect(actions).not.toContain("OPEN_WEB_PAGE");
    expect(actions).toContain("GET_WEATHER");
    expect(drafts.maxItems).toBe(8);
  });
});
