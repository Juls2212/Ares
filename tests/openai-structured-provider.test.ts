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

  it("has a bounded conversational response variant alongside the typed action states", () => {
    expect(OPENAI_INTERPRETATION_OUTPUT_SCHEMA.required).toContain("responseText");
    expect(OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.responseText).toEqual({ type: "string", maxLength: 400 });
    expect(OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.state.enum).toContain("CONVERSATIONAL");
  });

  it("uses explicit strict weekly-routine and habit objects while retaining bounded JSON input strings for other actions", () => {
    const drafts = OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.drafts;
    if (!drafts || !("items" in drafts)) throw new Error("Expected draft schema.");
    const input = drafts.items.properties.input;
    const weeklyRoutine = drafts.items.properties.weeklyRoutine;
    const habitAction = drafts.items.properties.habitAction;

    expect(input).toEqual({ anyOf: [{ type: "string", maxLength: 6_000 }, { type: "null" }] });
    expect(weeklyRoutine.anyOf).toContainEqual({ type: "null" });
    const variants = weeklyRoutine.anyOf;
    const weeklyRoutineObject = variants.find((variant) => variant.type === "object");
    if (!weeklyRoutineObject) throw new Error("Expected weekly-routine object schema.");
    expect(weeklyRoutineObject).toMatchObject({
      additionalProperties: false,
      required: ["scheduleTitle", "title", "weekdays", "startTime", "endTime", "location", "categoryName"]
    });
    expect(weeklyRoutineObject.properties.weekdays).toMatchObject({ type: "array", minItems: 1, maxItems: 7 });
    expect(weeklyRoutineObject.properties.weekdays.items.enum).toEqual([
      "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
    ]);
    const habitObject = habitAction.anyOf.find((variant) => variant.type === "object");
    if (!habitObject) throw new Error("Expected habit action object schema.");
    expect(habitObject).toMatchObject({
      additionalProperties: false,
      required: ["habitTitle", "title", "description", "frequency", "targetCount", "categoryName", "icon", "scope"]
    });
    expect(habitObject.properties.icon.anyOf[0].enum).toContain("DUMBBELL");
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
    expect(action.enum).toHaveLength(30);
    expect(action.enum).toContain("DELETE_EVENT");
    expect(action.enum).toContain("GET_WEEKLY_SCHEDULE_DETAILS");
    expect(action.enum).toContain("ANALYZE_WEEKLY_SCHEDULE");
    expect(action.enum).toContain("GET_TODAY_AVAILABILITY");
    expect(action.enum).toContain("GET_CURRENT_DATE_TIME");
    expect(action.enum).toContain("GET_WEATHER");
    expect(action.enum).toContain("CREATE_WEEKLY_SCHEDULE");
    expect(action.enum).toContain("UPDATE_WEEKLY_SCHEDULE");
    expect(action.enum).toContain("CREATE_WEEKLY_ROUTINE");
    expect(action.enum).toContain("UPDATE_WEEKLY_ROUTINE");
    expect(action.enum).toContain("GET_HABIT_PROGRESS");
    expect(action.enum).toContain("CREATE_HABIT");
    expect(action.enum).toContain("UPDATE_HABIT");
    expect(action.enum).toContain("COMPLETE_HABIT");
    expect(drafts.maxItems).toBe(8);
  });
});
