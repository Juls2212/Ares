import { describe, expect, it, vi } from "vitest";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { parseFileMutationCommand } from "../src/main/assistant/found-file-mutations";
import type { FoundFileNameResolution } from "../src/main/files/supervised-file-service";

const conversational = JSON.stringify({ state: "CONVERSATIONAL", summary: "Conversación", responseText: "Hola", drafts: [], clarifications: [] });

const createInterpreter = (options: {
  activeFileSearch?: { resultCount: number };
  folder?: FoundFileNameResolution;
  providerResult?: string;
} = {}) => {
  const interpret = vi.fn(async () => options.providerResult ?? conversational);
  const resolveFolder = vi.fn((_name: string) => options.folder ?? ({ state: "NONE" } as const));
  const interpreter = createAssistantInterpreter({
    getConfiguration: () => ({ apiKey: "", model: "" }),
    createProvider: () => ({ interpret }),
    now: () => new Date("2026-09-20T15:00:00.000Z"),
    timeZone: () => "America/Bogota",
    getActiveFileSearch: () => options.activeFileSearch,
    resolveFoundFileName: () => ({ state: "NONE" }),
    resolveFoundFolderName: resolveFolder
  });
  return { run: (instruction: string) => interpreter.interpret({ instruction }), interpret, resolveFolder };
};

const withSearch = (resultCount = 4, extra: Parameters<typeof createInterpreter>[0] = {}) =>
  createInterpreter({ activeFileSearch: { resultCount }, ...extra });

describe("the supported utterances map to typed actions without a provider call", () => {
  it("«renombra el primero a Informe final» keeps the spoken name as typed", async () => {
    const { run, interpret } = withSearch();
    await expect(run("renombra el primero a Informe final")).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "RENAME_FOUND_ITEM", input: { ordinal: 1, newName: "Informe final" } }], clarifications: [] }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("«mueve el segundo a Documentos» moves one result to an approved root", async () => {
    const { run, interpret } = withSearch();
    await expect(run("mueve el segundo a Documentos")).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "MOVE_FOUND_ITEMS", input: { ordinals: [2], destinationRoot: "DOCUMENTS" } }] }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("«mueve todo a la carpeta Facturas» uses the closed all flag and a folder from the last search", async () => {
    const { run, resolveFolder, interpret } = withSearch(4, { folder: { state: "RESOLVED", ordinal: 3 } });
    await expect(run("mueve todo a la carpeta Facturas")).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "MOVE_FOUND_ITEMS", input: { all: true, destinationOrdinal: 3 } }] }
    });
    expect(resolveFolder).toHaveBeenCalledWith("Facturas");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("«organiza estos archivos en una carpeta llamada Facturas en Documentos» names the folder and the root", async () => {
    const { run, interpret } = withSearch();
    await expect(run("organiza estos archivos en una carpeta llamada Facturas en Documentos")).resolves.toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "ORGANIZE_FOUND_ITEMS", input: { all: true, folderName: "Facturas", root: "DOCUMENTS" } }] }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it.each([["elimina el tercero", 3], ["borra el primero", 1], ["elimina el último", 4], ["borra el número 2", 2], ["manda el segundo a la papelera", 2]])(
    "«%s» deletes exactly one result by ordinal %d",
    async (instruction, ordinal) => {
      const { run, interpret } = withSearch();
      await expect(run(instruction)).resolves.toMatchObject({
        ok: true,
        data: { state: "READY", drafts: [{ action: "DELETE_FOUND_ITEM", input: { ordinal } }] }
      });
      expect(interpret).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["mueve el primero y el segundo a Descargas", { ordinals: [1, 2], destinationRoot: "DOWNLOADS" }],
    ["mueve el último al escritorio", { ordinals: [4], destinationRoot: "DESKTOP" }],
    ["muévelo todo a mis documentos", { all: true, destinationRoot: "DOCUMENTS" }],
    ["mueve los resultados a imágenes", { all: true, destinationRoot: "PICTURES" }],
    ["por favor mueve el tercero a música", { ordinals: [3], destinationRoot: "MUSIC" }]
  ])("understands the move phrasing %j", async (instruction, input) => {
    const { run } = withSearch();
    await expect(run(instruction)).resolves.toMatchObject({ ok: true, data: { drafts: [{ action: "MOVE_FOUND_ITEMS", input }] } });
  });

  it("understands other rename phrasings and keeps accents and case in the new name", async () => {
    const { run } = withSearch();
    await expect(run("Renombra el segundo como Currículum Vitae")).resolves.toMatchObject({
      ok: true, data: { drafts: [{ action: "RENAME_FOUND_ITEM", input: { ordinal: 2, newName: "Currículum Vitae" } }] }
    });
    await expect(run("cámbiale el nombre al primero a «Plan 2026».")).resolves.toMatchObject({
      ok: true, data: { drafts: [{ action: "RENAME_FOUND_ITEM", input: { ordinal: 1, newName: "Plan 2026" } }] }
    });
  });

  it("organizes a list of ordinals", async () => {
    const { run } = withSearch();
    await expect(run("organiza el primero y el tercero en una carpeta llamada Cuentas en Descargas")).resolves.toMatchObject({
      ok: true, data: { drafts: [{ action: "ORGANIZE_FOUND_ITEMS", input: { ordinals: [1, 3], folderName: "Cuentas", root: "DOWNLOADS" } }] }
    });
  });
});

describe("unsupported variants produce a clarification with no action and no dialog", () => {
  it.each([
    "elimina todos",
    "borra todo",
    "elimina todos los archivos",
    "borra el primero y el segundo",
    "elimina el primero, el segundo y el tercero",
    "elimina el primero para siempre",
    "borra permanentemente el tercero",
    "borra el primero sin pasar por la papelera",
    "elimina C:\\Users\\Juli\\Documents\\viejo.txt",
    "borra ..\\Documents\\viejo.txt",
    "elimina *.pdf"
  ])("answers %j with the fixed delete limits", async (instruction) => {
    const { run, interpret } = withSearch();
    const result = await run(instruction);
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toContain("Papelera");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("asks for a number instead of deleting by name", async () => {
    const { run, interpret } = withSearch();
    const result = await run("elimina el archivo informe");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toContain("número");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("asks for a number when it is out of range, for every action", async () => {
    const { run } = withSearch(3);
    for (const instruction of ["elimina el décimo", "renombra el quinto a X", "mueve el cuarto a Documentos", "organiza el octavo en una carpeta llamada X en Documentos"]) {
      const result = await run(instruction);
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
      expect(result.ok && result.data.summary).toContain("3 resultados");
    }
  });

  it("asks for a valid name, a destination, or a selection when something is missing", async () => {
    const { run, interpret } = withSearch();
    const cases: Array<[string, string]> = [
      ["renombra el primero a CON", "nombre válido"],
      ["renombra el primero a a/b", "nombre válido"],
      ["organiza estos archivos en una carpeta llamada Facturas", "destino"],
      ["organiza estos archivos en una carpeta llamada Facturas en Marte", "destino"],
      ["mueve el pdf al escritorio", "qué resultados"],
      ["renombra informe a Final", "número"]
    ];
    for (const [instruction, fragment] of cases) {
      const result = await run(instruction);
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
      expect(result.ok && result.data.summary).toContain(fragment);
    }
    expect(interpret).not.toHaveBeenCalled();
  });

  it("asks which folder when the named destination folder is ambiguous or not in the results", async () => {
    const ambiguous = withSearch(4, { folder: { state: "AMBIGUOUS" } });
    const none = withSearch(4, { folder: { state: "NONE" } });
    const first = await ambiguous.run("mueve todo a la carpeta Facturas");
    const second = await none.run("mueve todo a la carpeta Facturas");
    expect(first.ok && first.data).toMatchObject({ state: "NEEDS_CLARIFICATION", drafts: [] });
    expect(first.ok && first.data.summary).toContain("varias carpetas");
    expect(second.ok && second.data).toMatchObject({ state: "NEEDS_CLARIFICATION", drafts: [] });
    expect(second.ok && second.data.summary).toContain("No encontré esa carpeta");
  });

  it("never echoes the spoken name or a path back in a clarification", async () => {
    const { run } = withSearch();
    const result = await run("renombra el primero a CON");
    expect(JSON.stringify(result)).not.toMatch(/CON\b|C:\\/);
  });
});

describe("context handling", () => {
  it("asks for a search first when a file noun is present and there is no recent search", async () => {
    const { run, interpret } = createInterpreter();
    const result = await run("mueve el pdf al escritorio");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toBe("Primero haz una búsqueda de archivos para poder elegir un resultado.");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("leaves a bare «elimina el tercero» to the provider when there is no recent file search", async () => {
    const { run, interpret } = createInterpreter();
    await run("elimina el tercero");
    expect(interpret).toHaveBeenCalledOnce();
  });

  it.each(["borra la tarea de hoy", "elimina el evento de mañana", "organiza mi día de mañana", "mueve el recordatorio a las 5", "renombra la rutina de gimnasio a Pesas"])(
    "does not take over the planner request %j even with a recent file search",
    async (instruction) => {
      const { run, interpret } = withSearch();
      await run(instruction);
      expect(interpret).toHaveBeenCalledOnce();
    }
  );

  it("does not change the open and reveal behavior", async () => {
    const { run } = withSearch();
    await expect(run("abre el segundo")).resolves.toMatchObject({ ok: true, data: { drafts: [{ action: "OPEN_FOUND_FILE", input: { ordinal: 2 } }] } });
    await expect(run("muéstrame el primero")).resolves.toMatchObject({ ok: true, data: { drafts: [{ action: "REVEAL_FOUND_FILE", input: { ordinal: 1 } }] } });
  });
});

describe("drafts proposed by the model", () => {
  const draft = (action: string, filesAction: unknown) => ({
    action, input: null, weeklyRoutine: null, habitAction: null, approvedWeb: null, catalogApplication: null, filesAction
  });
  const provided = (drafts: unknown[]) => JSON.stringify({ state: "READY", summary: "Preparé las acciones solicitadas.", responseText: "", drafts, clarifications: [] });

  it("accepts the closed shapes for the four actions", async () => {
    const outputs: Array<[unknown, string, unknown]> = [
      [draft("RENAME_FOUND_ITEM", { ordinal: 1, newName: "Final" }), "RENAME_FOUND_ITEM", { ordinal: 1, newName: "Final" }],
      [draft("MOVE_FOUND_ITEMS", { ordinals: [1, 2], all: null, destinationRoot: "DOWNLOADS", destinationOrdinal: null, destinationName: null }), "MOVE_FOUND_ITEMS", { ordinals: [1, 2], destinationRoot: "DOWNLOADS" }],
      [draft("MOVE_FOUND_ITEMS", { ordinals: null, all: true, destinationRoot: null, destinationOrdinal: 2, destinationName: null }), "MOVE_FOUND_ITEMS", { all: true, destinationOrdinal: 2 }],
      [draft("ORGANIZE_FOUND_ITEMS", { ordinals: null, all: true, folderName: "Cuentas", root: "DOCUMENTS" }), "ORGANIZE_FOUND_ITEMS", { all: true, folderName: "Cuentas", root: "DOCUMENTS" }],
      [draft("DELETE_FOUND_ITEM", { ordinal: 3 }), "DELETE_FOUND_ITEM", { ordinal: 3 }]
    ];
    for (const [item, action, input] of outputs) {
      const { run } = createInterpreter({ providerResult: provided([item]) });
      await expect(run("quiero hacer algo con los resultados")).resolves.toMatchObject({
        ok: true, data: { state: "READY", drafts: [{ action, input }] }
      });
    }
  });

  it("resolves a destination folder name in Main and never forwards the name", async () => {
    const { run, resolveFolder } = createInterpreter({
      providerResult: provided([draft("MOVE_FOUND_ITEMS", { ordinals: null, all: true, destinationRoot: null, destinationOrdinal: null, destinationName: "Facturas" })]),
      folder: { state: "RESOLVED", ordinal: 2 }
    });
    const result = await run("quiero guardar todo en esa carpeta");
    expect(result).toMatchObject({ ok: true, data: { drafts: [{ input: { all: true, destinationOrdinal: 2 } }] } });
    expect(resolveFolder).toHaveBeenCalledWith("Facturas");
    expect(JSON.stringify(result)).not.toContain("destinationName");
  });

  it.each([{ state: "AMBIGUOUS" }, { state: "NONE" }] as const)("asks which folder for the %o outcome", async (folder) => {
    const { run } = createInterpreter({
      providerResult: provided([draft("MOVE_FOUND_ITEMS", { ordinals: [1], all: null, destinationRoot: null, destinationOrdinal: null, destinationName: "Facturas" })]),
      folder
    });
    await expect(run("quiero guardar eso en esa carpeta")).resolves.toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
  });

  it("never turns a deletion by name, by list, or with extra fields into an action", async () => {
    for (const filesAction of [
      { fileName: "viejo" },
      { ordinals: [1, 2] },
      { ordinal: 1, all: true },
      { ordinal: 1, path: "C:\\x" }
    ]) {
      const { run } = createInterpreter({ providerResult: provided([draft("DELETE_FOUND_ITEM", filesAction)]) });
      const result = await run("quiero deshacerme de eso");
      expect(result.ok && result.data.drafts).toEqual([]);
      expect(result.ok && result.data.state).not.toBe("READY");
    }
  });

  it("rejects extra fields, a typed destination, and unsafe names on the other actions", async () => {
    const cases = [
      draft("RENAME_FOUND_ITEM", { ordinal: 1, newName: "CON" }),
      draft("RENAME_FOUND_ITEM", { ordinal: 1, newName: "a; powershell" }),
      draft("MOVE_FOUND_ITEMS", { ordinals: [1], all: null, destinationRoot: "C:\\Windows", destinationOrdinal: null, destinationName: null }),
      draft("MOVE_FOUND_ITEMS", { ordinals: [1], all: null, destinationRoot: null, destinationOrdinal: null, destinationName: null }),
      draft("MOVE_FOUND_ITEMS", { ordinals: [1], all: true, destinationRoot: "DESKTOP", destinationOrdinal: null, destinationName: null }),
      draft("ORGANIZE_FOUND_ITEMS", { ordinals: null, all: true, folderName: "a/b", root: "DOCUMENTS" }),
      draft("ORGANIZE_FOUND_ITEMS", { ordinals: [1], all: false, folderName: "X", root: "DOCUMENTS", classify: true })
    ];
    for (const item of cases) {
      const { run } = createInterpreter({ providerResult: provided([item]) });
      const result = await run("quiero organizar algo");
      expect(result.ok && result.data.drafts).toEqual([]);
      expect(result.ok && result.data.state).not.toBe("READY");
      expect(JSON.stringify(result)).not.toMatch(/Windows|powershell/);
    }
  });

  it("treats all:false as not given", async () => {
    const { run } = createInterpreter({
      providerResult: provided([draft("MOVE_FOUND_ITEMS", { ordinals: [2], all: false, destinationRoot: "MUSIC", destinationOrdinal: null, destinationName: null })])
    });
    await expect(run("quiero guardar eso en la música")).resolves.toMatchObject({
      ok: true, data: { drafts: [{ action: "MOVE_FOUND_ITEMS", input: { ordinals: [2], destinationRoot: "MUSIC" } }] }
    });
  });
});

describe("phrase parser", () => {
  it("never produces a path and keeps names out of structural fields", () => {
    const command = parseFileMutationCommand("renombra el primero a Informe final");
    expect(command).toEqual({ kind: "RENAME", ordinal: 1, newName: "Informe final" });
    expect(parseFileMutationCommand("hola, ¿qué tal?")).toBeUndefined();
    expect(parseFileMutationCommand("abre el segundo")).toBeUndefined();
  });
});
