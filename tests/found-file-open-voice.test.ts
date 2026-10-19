import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: vi.fn() }, shell: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import { createSupervisedFileActionExecutor } from "../src/main/actions/supervised-file-action-executor";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { createOpenAiStructuredProvider } from "../src/main/assistant/openai-structured-provider";
import { parseFoundFileCommand } from "../src/main/assistant/found-file-references";
import { createSupervisedFileService, type FoundFileNameResolution } from "../src/main/files/supervised-file-service";
import { filesSuccess } from "../src/main/files/supervised-file-failures";
import type { SupervisedFileService } from "../src/main/files/supervised-file-service";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";

const providerOutput = (drafts: unknown[]) => JSON.stringify({
  state: "READY", summary: "Preparé las acciones solicitadas.", responseText: "", drafts, clarifications: []
});

const createInterpreter = (options: {
  activeFileSearch?: { resultCount: number };
  resolve?: (name: string) => FoundFileNameResolution;
  providerResult?: string;
  knownApplicationAliases?: string[];
} = {}) => {
  const interpret = vi.fn(async () => options.providerResult ?? JSON.stringify({
    state: "CONVERSATIONAL", summary: "Conversación", responseText: "Hola", drafts: [], clarifications: []
  }));
  const resolve = vi.fn(options.resolve ?? (() => ({ state: "NONE" } as const)));
  const interpreter = createAssistantInterpreter({
    getConfiguration: () => ({ apiKey: "", model: "" }),
    createProvider: () => ({ interpret }),
    now: () => new Date("2026-09-20T15:00:00.000Z"),
    timeZone: () => "America/Bogota",
    getActiveFileSearch: () => options.activeFileSearch,
    resolveFoundFileName: resolve
  });
  const run = (instruction: string) =>
    interpreter.interpret({ instruction }, options.knownApplicationAliases ? { knownApplicationAliases: options.knownApplicationAliases } : undefined);
  return { run, interpret, resolve };
};

describe("found-file command parsing", () => {
  it.each([
    ["abre el segundo archivo", "OPEN_FOUND_FILE", 2],
    ["abre el segundo", "OPEN_FOUND_FILE", 2],
    ["Ábreme el tercero", "OPEN_FOUND_FILE", 3],
    ["abre la primera carpeta", "OPEN_FOUND_FILE", 1],
    ["abre el décimo resultado", "OPEN_FOUND_FILE", 10],
    ["abre el último", "OPEN_FOUND_FILE", "LAST"],
    ["abre el número 2", "OPEN_FOUND_FILE", 2],
    ["abre el número tres", "OPEN_FOUND_FILE", 3],
    ["abre el 4", "OPEN_FOUND_FILE", 4],
    ["por favor abre el quinto archivo", "OPEN_FOUND_FILE", 5],
    ["muéstrame el primero", "REVEAL_FOUND_FILE", 1],
    ["muestra el segundo archivo", "REVEAL_FOUND_FILE", 2]
  ])("reads %j as %s with ordinal %s", (instruction, action, ordinal) => {
    expect(parseFoundFileCommand(instruction)).toEqual({ action, target: { kind: "ORDINAL", ordinal } });
  });

  it.each([
    ["abre informe", "informe"],
    ["abre el archivo informe", "informe"],
    ["abre el documento informe final", "informe final"],
    ["muéstrame el informe", "informe"]
  ])("reads %j as the candidate name %j", (instruction, name) => {
    expect(parseFoundFileCommand(instruction)).toMatchObject({ target: { kind: "NAME", name } });
  });

  it.each(["abre", "abre el archivo", "hola", "busca mi CV", "crea una carpeta", "abre el"])("does not claim %j", (instruction) => {
    expect(parseFoundFileCommand(instruction)).toBeUndefined();
  });
});

describe("opening a found file by voice (the three real utterances)", () => {
  it.each(["abre el segundo archivo", "abre el segundo"])("turns %j into OPEN_FOUND_FILE ordinal 2 without a provider call", async (instruction) => {
    const { run, interpret } = createInterpreter({ activeFileSearch: { resultCount: 4 } });
    const result = await run(instruction);
    expect(result).toMatchObject({
      ok: true,
      data: { state: "READY", drafts: [{ action: "OPEN_FOUND_FILE", input: { ordinal: 2 } }], clarifications: [] }
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("turns «abre informe» into the ordinal of the unique matching result", async () => {
    const { run, resolve, interpret } = createInterpreter({
      activeFileSearch: { resultCount: 3 },
      resolve: () => ({ state: "RESOLVED", ordinal: 3 })
    });
    const result = await run("abre informe");
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "OPEN_FOUND_FILE", input: { ordinal: 3 } }] } });
    expect(resolve).toHaveBeenCalledWith("informe");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("resolves «el último» to the last result of the current search", async () => {
    const { run } = createInterpreter({ activeFileSearch: { resultCount: 4 } });
    await expect(run("abre el último")).resolves.toMatchObject({ ok: true, data: { drafts: [{ input: { ordinal: 4 } }] } });
  });

  it("maps «muéstrame el primero» to the reveal action", async () => {
    const { run } = createInterpreter({ activeFileSearch: { resultCount: 2 } });
    await expect(run("muéstrame el primero")).resolves.toMatchObject({ ok: true, data: { drafts: [{ action: "REVEAL_FOUND_FILE", input: { ordinal: 1 } }] } });
  });

  it("asks for a valid number when the ordinal exceeds the result count, with no action", async () => {
    const { run, interpret } = createInterpreter({ activeFileSearch: { resultCount: 3 } });
    const result = await run("abre el décimo");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toContain("3 resultados");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("asks for a search first when none exists, instead of asking to register an application", async () => {
    const { run, interpret } = createInterpreter();
    const result = await run("abre el segundo archivo");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toBe("Primero haz una búsqueda de archivos para poder elegir un resultado.");
    expect(JSON.stringify(result)).not.toContain("registrar");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("asks which result when several names match, with no action", async () => {
    const { run } = createInterpreter({ activeFileSearch: { resultCount: 3 }, resolve: () => ({ state: "AMBIGUOUS" }) });
    const result = await run("abre informe");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toContain("número");
  });

  it("falls through to the provider when the name matches no result, so applications keep working", async () => {
    const { run, interpret } = createInterpreter({ activeFileSearch: { resultCount: 3 }, resolve: () => ({ state: "NONE" }) });
    await run("abre notepad");
    expect(interpret).toHaveBeenCalledOnce();
  });

  it("falls through to the provider when there is no recent search for a name", async () => {
    const { run, interpret, resolve } = createInterpreter();
    await run("abre informe");
    expect(interpret).toHaveBeenCalledOnce();
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("application aliases still win over file names", () => {
  it.each(["abre chrome", "abre spotify", "abre whatsapp", "abre claude", "abre vscode"])(
    "sends %j to the provider even if a result name would match",
    async (instruction) => {
      const { run, interpret, resolve } = createInterpreter({
        activeFileSearch: { resultCount: 3 },
        resolve: () => ({ state: "RESOLVED", ordinal: 1 })
      });
      await run(instruction);
      expect(resolve).not.toHaveBeenCalled();
      expect(interpret).toHaveBeenCalledOnce();
    }
  );

  it("treats a registered custom alias the same way", async () => {
    const { run, interpret, resolve } = createInterpreter({
      activeFileSearch: { resultCount: 3 },
      resolve: () => ({ state: "RESOLVED", ordinal: 1 }),
      knownApplicationAliases: ["figma"]
    });
    await run("abre figma");
    expect(resolve).not.toHaveBeenCalled();
    expect(interpret).toHaveBeenCalledOnce();
  });

  it("keeps a bare alias as the open-or-register clarification", async () => {
    const { run } = createInterpreter({ activeFileSearch: { resultCount: 3 } });
    await expect(run("WhatsApp")).resolves.toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
  });
});

describe("a name returned by the model is resolved in Main", () => {
  const fileNameDraft = (action: string, fileName: unknown) => ({
    action, input: null, weeklyRoutine: null, habitAction: null, approvedWeb: null, catalogApplication: null, filesAction: { fileName }
  });

  it("converts a unique name into an ordinal before validation", async () => {
    const { run, resolve } = createInterpreter({
      providerResult: providerOutput([fileNameDraft("OPEN_FOUND_FILE", "informe de ventas")]),
      resolve: () => ({ state: "RESOLVED", ordinal: 2 })
    });
    const result = await run("quiero ver el reporte de ventas del trimestre");
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "OPEN_FOUND_FILE", input: { ordinal: 2 } }] } });
    expect(resolve).toHaveBeenCalledWith("informe de ventas");
  });

  it.each([{ state: "AMBIGUOUS" }, { state: "NONE" }] as const)("asks which result for the %o outcome, with no action", async (resolution) => {
    const { run } = createInterpreter({
      providerResult: providerOutput([fileNameDraft("OPEN_FOUND_FILE", "informe")]),
      resolve: () => resolution
    });
    const result = await run("quiero ver el reporte del trimestre");
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
    expect(result.ok && result.data.summary).toContain("número");
  });

  it("never lets the model supply a path or an unresolved name as an action", async () => {
    const withoutResolver = createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret: async () => providerOutput([fileNameDraft("OPEN_FOUND_FILE", "C:\\Windows\\cmd.exe")]) }),
      now: () => new Date("2026-09-20T15:00:00.000Z"),
      timeZone: () => "America/Bogota"
    });
    const result = await withoutResolver.interpret({ instruction: "quiero ver ese reporte" });
    expect(result.ok && result.data.drafts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("cmd.exe");
  });
});

describe("the provider only learns that a recent search exists", () => {
  const instructionsFor = async (activeFileSearch?: { resultCount: number }) => {
    const create = vi.fn(async (_request: unknown, _options: unknown) => ({ output_text: "{}" }));
    const provider = createOpenAiStructuredProvider({ apiKey: "test-only", model: "test-only" }, { responses: { create } } as never);
    await provider.interpret({
      instruction: "abre el segundo",
      reference: { now: "2026-10-12T12:00:00.000Z", timeZone: "America/Bogota", ...(activeFileSearch ? { activeFileSearch } : {}) },
      signal: new AbortController().signal
    });
    return (create.mock.calls[0]?.[0] as { instructions: string }).instructions;
  };

  it("states the result count and routes ordinals to OPEN_FOUND_FILE, never OPEN_APPLICATION", async () => {
    const text = await instructionsFor({ resultCount: 3 });
    expect(text).toContain("búsqueda de archivos reciente con 3 resultados");
    expect(text).toContain("OPEN_FOUND_FILE");
    expect(text).toContain("Nunca uses OPEN_APPLICATION para abrir un resultado de búsqueda");
  });

  it("tells the model when there is no recent search", async () => {
    const text = await instructionsFor();
    expect(text).toContain("No hay una búsqueda de archivos reciente");
  });
});

describe("last-search lookups in the file service", () => {
  const createFixtureService = (names: string[], now: () => number = () => 1_000) => {
    const home = "C:\\Users\\Juli";
    const entries = names.map((name) => ({ name, isDirectory: () => false, isSymbolicLink: () => false }));
    const service = createSupervisedFileService({
      filesystem: {
        readdir: vi.fn(async (directory: string) => (path.resolve(directory) === path.resolve(path.join(home, "Documents")) ? entries : [])),
        lstat: vi.fn(),
        realpath: vi.fn(async (target: string) => target),
        mkdir: vi.fn(),
        rename: vi.fn()
      },
      shell: { showItemInFolder: vi.fn(), openPath: vi.fn(), trashItem: vi.fn() },
      getKnownFolder: (root) => path.join(home, root === "DOCUMENTS" ? "Documents" : root),
      now,
      logError: vi.fn()
    });
    return service;
  };

  it("reports only a count, never names or paths", async () => {
    const service = createFixtureService(["Informe final.pdf", "Informe 2024.pdf"]);
    expect(service.getActiveSearchInfo()).toBeUndefined();
    await service.search({ query: "informe", root: "DOCUMENTS" });
    const info = service.getActiveSearchInfo();
    expect(info).toEqual({ resultCount: 2 });
    expect(JSON.stringify(info)).not.toMatch(/Informe|C:\\|Users/);
  });

  it("expires with the last search", async () => {
    let clock = 0;
    const service = createFixtureService(["Informe.pdf"], () => clock);
    await service.search({ query: "informe", root: "DOCUMENTS" });
    expect(service.getActiveSearchInfo()).toEqual({ resultCount: 1 });
    clock = 11 * 60 * 1000;
    expect(service.getActiveSearchInfo()).toBeUndefined();
    expect(service.resolveFoundFileByName("informe")).toEqual({ state: "NONE" });
  });

  it("matches by normalized exact name, then by unique substring", async () => {
    const service = createFixtureService(["Informe_Final.pdf", "Currículum Vitae.docx", "Notas de clase.txt"]);
    await service.search({ query: "", root: "DOCUMENTS" }).catch(() => undefined);
    await service.search({ query: "a", root: "DOCUMENTS" });
    expect(service.resolveFoundFileByName("informe final")).toEqual({ state: "RESOLVED", ordinal: 1 });
    expect(service.resolveFoundFileByName("INFORME FINAL PDF")).toEqual({ state: "RESOLVED", ordinal: 1 });
    expect(service.resolveFoundFileByName("curriculum")).toEqual({ state: "RESOLVED", ordinal: 2 });
    expect(service.resolveFoundFileByName("clase")).toEqual({ state: "RESOLVED", ordinal: 3 });
  });

  it("reports ambiguity and absence instead of guessing", async () => {
    const service = createFixtureService(["Informe 2023.pdf", "Informe 2024.pdf", "Plan.docx"]);
    await service.search({ query: "n", root: "DOCUMENTS" });
    expect(service.resolveFoundFileByName("informe")).toEqual({ state: "AMBIGUOUS" });
    expect(service.resolveFoundFileByName("contrato")).toEqual({ state: "NONE" });
    expect(service.resolveFoundFileByName("i")).toEqual({ state: "NONE" });
    expect(service.resolveFoundFileByName(undefined)).toEqual({ state: "NONE" });
  });

  it("prefers an exact name over a longer substring match", async () => {
    const service = createFixtureService(["Informe.pdf", "Informe largo.pdf"]);
    await service.search({ query: "informe", root: "DOCUMENTS" });
    expect(service.resolveFoundFileByName("informe")).toEqual({ state: "RESOLVED", ordinal: 1 });
  });
});

describe("the produced draft goes through the standard confirmation", () => {
  it("yields a Main-issued confirmation proposal for OPEN_FOUND_FILE ordinal 2", async () => {
    const service = {
      getActiveSearchInfo: vi.fn(),
      resolveFoundFileByName: vi.fn(),
      search: vi.fn(),
      revealFound: vi.fn(),
      prepareOpen: vi.fn(async () => filesSuccess({ preparedId: "prepared", displayName: "Informe.pdf", rootLabel: "Documentos" })),
      commitOpen: vi.fn(async () => filesSuccess({ opened: true as const })),
      prepareCreateFolder: vi.fn(),
      commitCreateFolder: vi.fn()
    };
    const unused = { execute: vi.fn() } as never;
    const executor = createActionExecutor({
      plannerExecutor: unused, applicationExecutor: unused, approvedWebExecutor: unused,
      filesExecutor: createSupervisedFileActionExecutor({ service: service as unknown as SupervisedFileService, logError: vi.fn() })
    });
    const orchestrator = createActionOrchestrator({
      executor,
      historyService: { recordTerminal: vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never })), list: vi.fn() } as unknown as ActionHistoryService,
      generateIdentifier: vi.fn()
        .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
        .mockReturnValueOnce("22222222-2222-4222-8222-222222222222"),
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      logError: vi.fn()
    });
    const { run } = createInterpreter({ activeFileSearch: { resultCount: 4 } });
    const interpreted = await run("abre el segundo archivo");
    if (!interpreted.ok) throw new Error("Expected an interpretation.");
    const draft = interpreted.data.drafts[0];

    const proposed = await orchestrator.propose(draft);

    expect(proposed).toMatchObject({
      ok: true,
      data: { lifecycleState: "AWAITING_CONFIRMATION", action: "OPEN_FOUND_FILE", confirmationId: "22222222-2222-4222-8222-222222222222" }
    });
    expect(service.commitOpen).not.toHaveBeenCalled();
    expect(service.prepareOpen).toHaveBeenCalledWith(2);
  });
});
