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

  it("uses complete closed draft variants while retaining the bounded weekly-routine object", () => {
    const variants = draftVariants();
    expect(variants).toHaveLength(2);
    for (const variant of variants) {
      expect(variant).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["action", "input", "weeklyRoutine", "habitAction", "approvedWeb", "catalogApplication", "filesAction"]
      });
    }

    const nonCatalog = variants.find((variant) => {
      const action = propertiesOf(variant).action as SchemaNode;
      return Array.isArray(action.enum) && !action.enum.includes("REGISTER_CATALOG_APPLICATION");
    });
    if (!nonCatalog) throw new Error("Expected non-catalog draft schema.");
    const weeklyRoutine = propertiesOf(nonCatalog).weeklyRoutine as SchemaNode;
    const weeklyRoutineObject = (weeklyRoutine.anyOf as readonly SchemaNode[]).find((variant) => variant.type === "object");
    if (!weeklyRoutineObject) throw new Error("Expected weekly-routine object schema.");
    expect(weeklyRoutineObject).toMatchObject({
      additionalProperties: false,
      required: ["scheduleTitle", "title", "weekdays", "startTime", "endTime", "location", "categoryName"]
    });
    expect(propertiesOf(weeklyRoutineObject).weekdays).toMatchObject({ type: "array", minItems: 1, maxItems: 7 });
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
      "GET_WEEKLY_SCHEDULE_DETAILS",
      "ANALYZE_WEEKLY_SCHEDULE",
      "GET_TODAY_AVAILABILITY"
    ]));
    expect(actions).toHaveLength(35);
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
    expect(actions).not.toContain("GET_WEATHER");
    expect(drafts.maxItems).toBe(8);
  });
});
