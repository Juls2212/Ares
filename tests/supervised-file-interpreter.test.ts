import { describe, expect, it, vi } from "vitest";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { OPENAI_INTERPRETATION_OUTPUT_SCHEMA } from "../src/main/assistant/openai-structured-provider";

const now = "2026-09-20T15:00:00.000Z";

type Draft = Record<string, unknown>;

const fileDraft = (action: string, filesAction: unknown): Draft => ({
  action,
  input: null,
  weeklyRoutine: null,
  habitAction: null,
  approvedWeb: null,
  catalogApplication: null,
  filesAction
});

const ready = (drafts: Draft[]) => JSON.stringify({
  state: "READY",
  summary: "Preparé las acciones solicitadas.",
  responseText: "",
  drafts,
  clarifications: []
});

const createInterpreter = (output: string) => {
  const interpret = vi.fn(async () => output);
  return {
    interpret,
    interpreter: createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret }),
      now: () => new Date(now),
      timeZone: () => "America/Bogota"
    })
  };
};

const draftsOf = async (output: string, instruction: string) => {
  const result = await createInterpreter(output).interpreter.interpret({ instruction });
  return result;
};

describe("strict structured-output schema for file actions", () => {
  type SchemaNode = { type?: string; properties?: Record<string, SchemaNode>; required?: string[]; additionalProperties?: boolean; anyOf?: SchemaNode[]; items?: SchemaNode };

  const collectObjects = (node: SchemaNode, found: SchemaNode[] = []): SchemaNode[] => {
    if (node.type === "object") found.push(node);
    for (const property of Object.values(node.properties ?? {})) collectObjects(property, found);
    for (const variant of node.anyOf ?? []) collectObjects(variant, found);
    if (node.items) collectObjects(node.items, found);
    return found;
  };

  it("keeps every nested object closed with all properties required", () => {
    const objects = collectObjects(OPENAI_INTERPRETATION_OUTPUT_SCHEMA as unknown as SchemaNode);
    expect(objects.length).toBeGreaterThan(8);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required ?? [])].sort()).toEqual(Object.keys(object.properties ?? {}).sort());
    }
  });

  it("offers closed search, ordinal and folder variants and never a path field", () => {
    const items = (OPENAI_INTERPRETATION_OUTPUT_SCHEMA.properties.drafts as unknown as SchemaNode).items as SchemaNode;
    const nonCatalog = (items.anyOf ?? []).find((variant) => variant.properties?.filesAction?.anyOf);
    const variants = nonCatalog?.properties?.filesAction?.anyOf ?? [];
    expect(variants.map((variant) => variant.type)).toEqual(["null", ...Array(7).fill("object")]);
    expect(variants.slice(1).map((variant) => [...(variant.required ?? [])].sort())).toEqual([
      ["kind", "query", "root"],
      ["ordinal"],
      ["fileName"],
      ["newName", "ordinal"],
      ["all", "destinationName", "destinationOrdinal", "destinationRoot", "ordinals"],
      ["all", "folderName", "ordinals", "root"],
      ["folderName", "parentOrdinal", "root"]
    ]);
    expect(JSON.stringify(variants)).not.toMatch(/path|url|command|wildcard/i);
  });
});

describe("file requests map to the four typed actions", () => {
  it("maps «busca mi CV» to a search with no root and no kind", async () => {
    const result = await draftsOf(ready([fileDraft("SEARCH_FILES", { query: "CV", root: null, kind: null })]), "busca mi CV");
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "SEARCH_FILES", input: { query: "CV" } }] } });
  });

  it("keeps an explicit root and kind as enum values", async () => {
    const result = await draftsOf(
      ready([fileDraft("SEARCH_FILES", { query: "foto", root: "PICTURES", kind: "IMAGE" })]),
      "busca fotos en imágenes"
    );
    expect(result).toMatchObject({ ok: true, data: { drafts: [{ action: "SEARCH_FILES", input: { query: "foto", root: "PICTURES", kind: "IMAGE" } }] } });
  });

  it("maps «muéstrame el primero» and «abre el segundo» to ordinals", async () => {
    await expect(draftsOf(ready([fileDraft("REVEAL_FOUND_FILE", { ordinal: 1 })]), "quiero ver el primero")).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "REVEAL_FOUND_FILE", input: { ordinal: 1 } }] }
    });
    await expect(draftsOf(ready([fileDraft("OPEN_FOUND_FILE", { ordinal: 2 })]), "necesito abrir el segundo")).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "OPEN_FOUND_FILE", input: { ordinal: 2 } }] }
    });
  });

  it("maps «crea una carpeta llamada Fotos en Documentos» to a folder in an approved root", async () => {
    const result = await draftsOf(
      ready([fileDraft("CREATE_FOLDER", { folderName: "Fotos", root: "DOCUMENTS", parentOrdinal: null })]),
      "crea una carpeta llamada Fotos en Documentos"
    );
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "CREATE_FOLDER", input: { folderName: "Fotos", root: "DOCUMENTS" } }] } });
  });

  it("accepts a folder ordinal as the only parent reference", async () => {
    const result = await draftsOf(
      ready([fileDraft("CREATE_FOLDER", { folderName: "Nueva", root: null, parentOrdinal: 2 })]),
      "crea una carpeta llamada Nueva dentro de la segunda"
    );
    expect(result).toMatchObject({ ok: true, data: { drafts: [{ action: "CREATE_FOLDER", input: { folderName: "Nueva", parentOrdinal: 2 } }] } });
  });
});

describe("model-supplied values are bounded and never become paths", () => {
  it.each(["..\\Windows", "C:\\Users", "a/b", "*.pdf", "http://example.com", "x".repeat(65), "buscar; powershell"])(
    "turns the unsafe query %j into a clarification with no action",
    async (query) => {
      const result = await draftsOf(ready([fileDraft("SEARCH_FILES", { query, root: null, kind: null })]), "busca algo");
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    }
  );

  it.each([0, 11, -1, 1.5])("does not accept the ordinal %s", async (ordinal) => {
    const result = await draftsOf(ready([fileDraft("OPEN_FOUND_FILE", { ordinal })]), "abre ese");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
  });

  it("rejects extra fields, unknown roots, and the legacy path-based shapes", async () => {
    const outputs = [
      ready([fileDraft("SEARCH_FILES", { query: "CV", root: null, kind: null, path: "C:\\x" })]),
      ready([fileDraft("SEARCH_FILES", { query: "CV", root: "SYSTEM", kind: null })]),
      ready([fileDraft("OPEN_FOUND_FILE", { ordinal: 1, path: "C:\\x.exe" })]),
      ready([{ action: "SEARCH_FILES", input: JSON.stringify({ rootId: "DOCUMENTS", query: "x" }), weeklyRoutine: null, habitAction: null, approvedWeb: null }]),
      ready([{ action: "CREATE_FOLDER", input: JSON.stringify({ parentDirectory: { rootId: "DOCUMENTS", relativePath: "a" }, name: "b" }), weeklyRoutine: null, habitAction: null, approvedWeb: null }])
    ];
    for (const output of outputs) {
      const result = await draftsOf(output, "solicitud segura");
      expect(result).toMatchObject({ ok: true, data: { drafts: [] } });
      expect(result.ok && ["REJECTED", "NEEDS_CLARIFICATION"].includes(result.data.state)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("C:");
    }
  });

  it("does not accept file arguments on a non-file draft", async () => {
    const result = await draftsOf(
      ready([{ ...fileDraft("GET_TODAY_SCHEDULE", { ordinal: 1 }), input: "{}" }]),
      "qué tengo hoy"
    );
    expect(result).toMatchObject({ ok: true, data: { state: "REJECTED", drafts: [] } });
  });

  it("asks for a location when a folder has neither a root nor a parent entry", async () => {
    const result = await draftsOf(
      ready([fileDraft("CREATE_FOLDER", { folderName: "Fotos", root: null, parentOrdinal: null })]),
      "crea una carpeta llamada Fotos"
    );
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toContain("ubicación");
  });

  it.each(["CON", "a/b", "fin.", "x".repeat(65)])("asks for a valid name instead of passing %j", async (folderName) => {
    const result = await draftsOf(
      ready([fileDraft("CREATE_FOLDER", { folderName, root: "DOCUMENTS", parentOrdinal: null })]),
      "crea una carpeta"
    );
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
  });
});

describe("planner requests and retired legacy file actions", () => {
  it("does not block planner requests that use the same verbs", async () => {
    for (const instruction of ["borra la tarea de hoy", "elimina el evento de mañana", "organiza mi día de mañana"]) {
      const { interpret, interpreter } = createInterpreter(ready([{ action: "GET_TODAY_SCHEDULE", input: "{}", weeklyRoutine: null, habitAction: null, approvedWeb: null }]));
      await interpreter.interpret({ instruction });
      expect(interpret).toHaveBeenCalledOnce();
    }
  });

  it("never reaches a model-proposed rename, move or delete draft", async () => {
    for (const action of ["RENAME_FILE", "MOVE_FILE", "DELETE_FILE", "ORGANIZE_FILES"]) {
      const result = await draftsOf(
        ready([{ action, input: "{}", weeklyRoutine: null, habitAction: null, approvedWeb: null }]),
        "solicitud segura"
      );
      expect(result).toMatchObject({ ok: true, data: { state: "REJECTED", drafts: [] } });
    }
  });
});
