import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
  dialog: {},
  shell: { openExternal: vi.fn(async (_url: string) => undefined) }
}));

import { shell } from "electron";
import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { createApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { parseStreamingCommand } from "../src/main/assistant/streaming-phrases";
import { OPENAI_INTERPRETATION_OUTPUT_SCHEMA } from "../src/main/assistant/openai-structured-provider";
import { createApplicationLauncher } from "../src/main/applications/application-launcher";
import { createCatalogApplicationAdapter } from "../src/main/applications/catalog-application-adapter";
import { CATALOG_LAUNCH_FAILURE } from "../src/main/applications/catalog-registration-failures";
import { MAX_SPOTIFY_SEARCH_QUERY_LENGTH, validateSpotifySearchQuery } from "../src/main/applications/spotify-search";
import { attachSpokenActionResponse } from "../src/main/ipc/register-action-ipc";
import { APPLICATION_CATALOG_KEYS, type ApplicationRecord } from "../src/shared/application-contracts";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Spotify search query validation", () => {
  it.each([
    ["Despacito", "Despacito"],
    ["  Natalia   Lafourcade ", "Natalia Lafourcade"],
    ["Beyoncé", "Beyoncé"],
    ["Guns N' Roses", "Guns N' Roses"],
    ["P!nk", "P!nk"],
    ["Mr. Brightside", "Mr. Brightside"],
    ["Rock & Roll (en vivo)", "Rock & Roll (en vivo)"],
    ["\"Hello\" Adele", "\"Hello\" Adele"],
    ["U2", "U2"],
    ["Canción\u0000 con\u200b control\n", "Canción con control"],
    ["a".repeat(MAX_SPOTIFY_SEARCH_QUERY_LENGTH), "a".repeat(MAX_SPOTIFY_SEARCH_QUERY_LENGTH)]
  ])("accepts %j", (input, expected) => {
    expect(validateSpotifySearchQuery(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "\u0000\u200b",
    "a".repeat(MAX_SPOTIFY_SEARCH_QUERY_LENGTH + 1),
    "https://example.com",
    "spotify:track:123",
    "javascript:alert(1)",
    "file:///C:/Windows",
    "www.example.com",
    "example.com",
    "evil.example/path",
    "../../etc",
    "a..b",
    "AC/DC",
    "C:\\Users\\Juli",
    "canción; rm -rf",
    "<script>",
    "-inicio",
    "mail@example.org"
  ])("rejects %j", (input) => {
    expect(validateSpotifySearchQuery(input)).toBeUndefined();
  });

  it.each([undefined, null, 5, {}, ["a"]])("rejects the non-string value %j", (input) => {
    expect(validateSpotifySearchQuery(input)).toBeUndefined();
  });
});

describe("catalog adapter Spotify search", () => {
  const createAdapter = (overrides: Parameters<typeof createCatalogApplicationAdapter>[0] = {}) => {
    const logError = vi.fn();
    return { logError, adapter: createCatalogApplicationAdapter({ platform: () => "win32", logError, ...overrides }) };
  };

  it("hands the operating system exactly spotify:search: plus the encoded query", async () => {
    const open = vi.mocked(shell.openExternal);
    open.mockClear();
    const { adapter } = createAdapter();
    const query = "Beyoncé & Jay-Z #1 ¿qué? \"quote\"";

    await expect(adapter.openSearch("SPOTIFY", query)).resolves.toEqual({ ok: true, data: { applicationName: "Spotify" } });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(`spotify:search:${encodeURIComponent(query)}`);
    const uri = open.mock.calls[0][0];
    expect(uri).toContain("%C3%A9");
    expect(uri).toContain("%26");
    expect(uri).toContain("%23");
    expect(uri).toContain("%3F");
    expect(uri).toContain("%22");
    expect(uri).toContain("%20");
    expect(uri.slice("spotify:search:".length)).not.toMatch(/[ &#?"]/u);
  });

  it("is reachable only for the SPOTIFY key", async () => {
    const openSpotifySearch = vi.fn(async (_query: string) => undefined);
    const openFixedProtocol = vi.fn(async () => undefined);
    const { adapter } = createAdapter({ openSpotifySearch, openFixedProtocol });
    for (const key of [...APPLICATION_CATALOG_KEYS.filter((entry) => entry !== "SPOTIFY"), "spotify", "SPOTIFY ", "", undefined, null, 4, {}]) {
      await expect(adapter.openSearch(key, "Despacito")).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });
    }
    expect(openSpotifySearch).not.toHaveBeenCalled();
    expect(openFixedProtocol).not.toHaveBeenCalled();
    await expect(adapter.openSearch("SPOTIFY", "Despacito")).resolves.toMatchObject({ ok: true });
    expect(openSpotifySearch).toHaveBeenCalledWith("Despacito");
  });

  it("is unavailable off Windows and validates the query again before opening anything", async () => {
    const openSpotifySearch = vi.fn(async (_query: string) => undefined);
    const mac = createAdapter({ platform: () => "darwin", openSpotifySearch });
    await expect(mac.adapter.openSearch("SPOTIFY", "Despacito")).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });

    const { adapter } = createAdapter({ openSpotifySearch });
    for (const query of ["https://example.com", "spotify:track:1", "../x", "", undefined]) {
      await expect(adapter.openSearch("SPOTIFY", query)).resolves.toMatchObject({
        ok: false,
        error: { code: "APPLICATION_SPOTIFY_QUERY_INVALID", userMessage: "Indica qué canción, artista o álbum quieres buscar en Spotify." }
      });
    }
    expect(openSpotifySearch).not.toHaveBeenCalled();
  });

  it("reports a launch failure with the existing could-not-open category, never «No encontré»", async () => {
    const { adapter, logError } = createAdapter({ openSpotifySearch: async () => { throw new Error("spotify:search:secreto"); } });
    const result = await adapter.openSearch("SPOTIFY", "secreto");
    expect(result).toEqual({ ok: false, error: { ...CATALOG_LAUNCH_FAILURE } });
    expect(JSON.stringify(result)).not.toContain("No encontré");
    expect(logError.mock.calls).toEqual([["Catalog application launch failed."]]);
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(/secreto|spotify:/u);
  });

  it("keeps the bare spotify: strategy for opening and the other keys untouched", async () => {
    const open = vi.mocked(shell.openExternal);
    open.mockClear();
    const { adapter } = createAdapter({ getWindowsUserDirectories: () => ({ localApplicationData: "x", roamingApplicationData: "y" }), realpath: async () => { throw new Error("none"); } });
    await adapter.launch("SPOTIFY");
    await adapter.launch("WHATSAPP");
    expect(open.mock.calls.map(([url]) => url)).toEqual(["spotify:", "whatsapp:"]);
  });
});

const spotifyRecord = (overrides: Partial<ApplicationRecord> = {}): ApplicationRecord => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Spotify",
  platform: "WINDOWS",
  launchMode: "CATALOG_APPLICATION",
  catalogKey: "SPOTIFY",
  isFavorite: false,
  isEnabled: true,
  lastLaunchedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  aliases: [{ id: "a", applicationId: "11111111-1111-4111-8111-111111111111", alias: "spotify", createdAt: "2026-01-01T00:00:00.000Z" }],
  ...overrides
} as ApplicationRecord);

const createLauncher = (records: ApplicationRecord[], openSearch = vi.fn(async (_key: unknown, _query: unknown) => ({ ok: true as const, data: { applicationName: "Spotify" } }))) => {
  const applicationService = { listApplications: vi.fn(async () => ({ ok: true as const, data: { items: records, total: records.length } })) };
  const catalogAdapter = { getCurrentPlatform: () => "WINDOWS" as const, isAvailable: vi.fn(), launch: vi.fn(), openSearch };
  return {
    openSearch,
    applicationService,
    launcher: createApplicationLauncher({ applicationService: applicationService as never, catalogAdapter: catalogAdapter as never, logError: vi.fn() })
  };
};

describe("launcher precondition", () => {
  it("opens the search only for a registered, enabled Spotify catalog entry", async () => {
    const { launcher, openSearch } = createLauncher([spotifyRecord()]);
    await expect(launcher.searchSpotifyApp("Despacito")).resolves.toEqual({ ok: true, data: { applicationName: "Spotify" } });
    expect(openSearch).toHaveBeenCalledWith("SPOTIFY", "Despacito");
  });

  it.each([
    ["not registered", []],
    ["disabled", [spotifyRecord({ isEnabled: false })]],
    ["another catalog application", [spotifyRecord({ catalogKey: "WHATSAPP" })]],
    ["an executable named Spotify", [spotifyRecord({ launchMode: "WINDOWS_EXECUTABLE", catalogKey: null })]],
    ["another platform", [spotifyRecord({ platform: "MACOS" })]]
  ])("tells the person to register first when Spotify is %s and never auto-registers", async (_label, records) => {
    const { launcher, openSearch } = createLauncher(records as ApplicationRecord[]);
    await expect(launcher.searchSpotifyApp("Despacito")).resolves.toEqual({
      ok: false,
      error: { code: "APPLICATION_SPOTIFY_NOT_REGISTERED", userMessage: "Primero debes registrar esa aplicación para poder abrirla." }
    });
    expect(openSearch).not.toHaveBeenCalled();
  });

  it("maps a launch failure to the could-not-open message and a bad query to its own", async () => {
    const failing = createLauncher([spotifyRecord()], vi.fn(async () => ({ ok: false as const, error: { ...CATALOG_LAUNCH_FAILURE } })) as never);
    const failed = await failing.launcher.searchSpotifyApp("Despacito");
    expect(failed).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_LAUNCH_FAILED", userMessage: CATALOG_LAUNCH_FAILURE.userMessage } });
    expect(JSON.stringify(failed)).not.toContain("No encontré");

    const invalid = createLauncher([spotifyRecord()], vi.fn(async () => ({ ok: false as const, error: { code: "APPLICATION_SPOTIFY_QUERY_INVALID", userMessage: "x" } })) as never);
    await expect(invalid.launcher.searchSpotifyApp("../")).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_SPOTIFY_QUERY_INVALID" } });
  });
});

describe("action execution, history and speech", () => {
  const createFlow = (records: ApplicationRecord[], openSearch?: Parameters<typeof createLauncher>[1]) => {
    const { launcher, openSearch: search } = createLauncher(records, openSearch);
    const executorLog = vi.fn();
    const unused = { execute: vi.fn() } as never;
    const executor = createActionExecutor({
      plannerExecutor: unused,
      approvedWebExecutor: unused,
      filesExecutor: unused,
      messagingExecutor: unused,
      applicationExecutor: createApplicationActionExecutor({ launcher, logError: executorLog })
    });
    const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
    let counter = 0;
    const orchestratorLog = vi.fn();
    const orchestrator = createActionOrchestrator({
      executor,
      historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
      generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
      now: () => new Date("2026-09-17T10:00:00.000Z"),
      logError: orchestratorLog
    });
    return { orchestrator, recordTerminal, search, executorLog, orchestratorLog };
  };

  it("is a direct, level-1 action with no confirmation", () => {
    expect(getActionPolicy("SEARCH_SPOTIFY_APP")).toMatchObject({ approval: "DIRECT", riskLevel: 1, availability: "IMPLEMENTED" });
  });

  it("searches and says so generically, never that it is playing", async () => {
    const flow = createFlow([spotifyRecord()]);
    const result = await flow.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Despacito" } });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "SUCCEEDED", riskLevel: 1, userSummary: "Busqué «Despacito» en Spotify. Pulsa reproducir cuando quieras.", data: { applicationName: "Spotify" } }
    });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/spotify:|reproduciendo|Reproduje|ya suena|conexión/u);
  });

  it.each([
    ["TRACK", "Busqué la canción «Despacito» en Spotify."],
    ["ARTIST", "Busqué al artista «Despacito» en Spotify."],
    ["ALBUM", "Busqué el álbum «Despacito» en Spotify."],
    ["PLAYLIST", "Busqué la playlist «Despacito» en Spotify."],
    ["ANY", "Busqué «Despacito» en Spotify."]
  ])("refines only the spoken text for kind %s", async (kind, start) => {
    const flow = createFlow([spotifyRecord()]);
    const result = await flow.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Despacito", kind } });
    expect(result.ok && "userSummary" in result.data && result.data.userSummary).toBe(`${start} Pulsa reproducir cuando quieras.`);
    expect(flow.search).toHaveBeenCalledWith("SPOTIFY", "Despacito");
  });

  it("adds the next-phase hint, without claiming playback, when playing was requested", async () => {
    const flow = createFlow([spotifyRecord()]);
    const result = await flow.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Despacito", playRequested: true } });
    expect(result.ok && "userSummary" in result.data && result.data.userSummary).toBe(
      "Busqué «Despacito» en Spotify. Pulsa reproducir cuando quieras. Para reproducir directamente necesitaré la conexión con Spotify prevista para la próxima fase."
    );
  });

  it("asks to register first when Spotify is missing, and uses the could-not-open message when the launch fails", async () => {
    const missing = createFlow([]);
    await expect(missing.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Despacito" } })).resolves.toMatchObject({
      ok: true,
      data: { status: "VALIDATION_FAILED", errorCode: "APPLICATION_SPOTIFY_NOT_REGISTERED", userSummary: "Primero debes registrar esa aplicación para poder abrirla." }
    });
    const failing = createFlow([spotifyRecord()], vi.fn(async () => ({ ok: false as const, error: { ...CATALOG_LAUNCH_FAILURE } })) as never);
    const failed = await failing.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Despacito" } });
    expect(failed).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", userSummary: CATALOG_LAUNCH_FAILURE.userMessage } });
    expect(JSON.stringify(failed)).not.toContain("No encontré");
  });

  it("accepts only a plain query, a closed kind and a boolean", async () => {
    const flow = createFlow([spotifyRecord()]);
    for (const input of [
      { query: "https://open.spotify.com/track/1" },
      { query: "spotify:track:1" },
      { query: "../x" },
      { query: "" },
      { query: "a".repeat(101) },
      { query: "Despacito", kind: "SONG" },
      { query: "Despacito", playRequested: "yes" },
      { query: "Despacito", uri: "spotify:search:x" },
      { query: "Despacito", url: "https://x.example" },
      { kind: "TRACK" },
      "Despacito"
    ]) {
      await expect(flow.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input })).resolves.toMatchObject({
        ok: false, error: { code: "ACTION_PROPOSAL_INVALID" }
      });
    }
    expect(flow.search).not.toHaveBeenCalled();
  });

  it("keeps the query and any URI out of history, logs and errors", async () => {
    const ok = createFlow([spotifyRecord()]);
    await ok.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Canción Privada 77", kind: "TRACK" } });
    const failing = createFlow([spotifyRecord()], vi.fn(async () => { throw new Error("spotify:search:Canción%20Privada"); }) as never);
    const failed = await failing.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Canción Privada 77" } });

    for (const flow of [ok, failing]) {
      expect(JSON.stringify([flow.recordTerminal.mock.calls, flow.executorLog.mock.calls, flow.orchestratorLog.mock.calls])).not.toMatch(/Privada|77|spotify:/u);
    }
    expect(JSON.stringify(failed)).not.toMatch(/Privada|spotify:/u);
    expect(ok.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      action: "SEARCH_SPOTIFY_APP",
      userSummary: "La búsqueda en Spotify se completó.",
      metadata: expect.objectContaining({ scopeKind: "APPLICATION", resultKind: "SUCCEEDED" })
    }));
  });

  it("speaks the generic sentence with the query and nothing else", async () => {
    const flow = createFlow([spotifyRecord()]);
    const remembered: string[] = [];
    const result = await flow.orchestrator.propose({ action: "SEARCH_SPOTIFY_APP", input: { query: "Despacito" } });
    attachSpokenActionResponse(1, result, { clear: vi.fn(), remember: (_id: number, text: string) => { remembered.push(text); return {} as never; } } as never);
    expect(remembered).toEqual(["Busqué «Despacito» en Spotify. Pulsa reproducir cuando quieras."]);
  });
});

describe("voice routing matrix", () => {
  const conversational = JSON.stringify({ state: "CONVERSATIONAL", summary: "Conversación", responseText: "Hola", drafts: [], clarifications: [] });
  const interpret = async (instruction: string, options: { registered?: boolean; aliases?: string[]; output?: string } = {}) => {
    const provider = vi.fn(async () => options.output ?? conversational);
    const interpreter = createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret: provider }),
      now: () => new Date("2026-09-20T15:00:00.000Z"),
      timeZone: () => "America/Bogota",
      isSpotifyAppRegistered: async () => options.registered ?? false
    });
    const result = await interpreter.interpret({ instruction }, { knownApplicationAliases: options.aliases ?? [] });
    return { result, provider };
  };
  const drafts = (result: Awaited<ReturnType<typeof interpret>>["result"]) => (result.ok ? result.data.drafts : []);

  it.each([
    ["busca Despacito en Spotify", { query: "Despacito" }],
    ["Busca Despacito en Spotify.", { query: "Despacito" }],
    ["busca el álbum Un Verano Sin Ti en Spotify", { query: "Un Verano Sin Ti", kind: "ALBUM" }],
    ["busca al artista Natalia Lafourcade en Spotify", { query: "Natalia Lafourcade", kind: "ARTIST" }],
    ["en Spotify busca Bad Bunny", { query: "Bad Bunny" }],
  ])("with Spotify registered, «%s» opens the app search", async (utterance, input) => {
    const { result, provider } = await interpret(utterance, { registered: true });
    expect(result).toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "SEARCH_SPOTIFY_APP", input }] } });
    expect(drafts(result)).toHaveLength(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ["busca Despacito en Spotify", "Despacito"],
  ])("without the app, «%s» uses exactly the Spotify web search and never both routes", async (utterance, query) => {
    const { result, provider } = await interpret(utterance, { registered: false });
    expect(drafts(result)).toEqual([{ action: "SEARCH_APPROVED_SITE", input: { site: "SPOTIFY", query } }]);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ["busca recetas de arepas en Google", { action: "SEARCH_APPROVED_SITE", input: { site: "GOOGLE", query: "recetas de arepas" } }],
    ["Busca el clima en Google.", { action: "SEARCH_APPROVED_SITE", input: { site: "GOOGLE", query: "el clima" } }],
    ["busca tutoriales de React en YouTube", { action: "SEARCH_APPROVED_SITE", input: { site: "YOUTUBE", query: "tutoriales de React" } }],
    ["busca en YouTube gatos graciosos", { action: "SEARCH_APPROVED_SITE", input: { site: "YOUTUBE", query: "gatos graciosos" } }],
    ["pon Despacito en YouTube", { action: "SEARCH_APPROVED_SITE", input: { site: "YOUTUBE", query: "Despacito" } }],
    ["pon música de Shakira en YouTube", { action: "SEARCH_APPROVED_SITE", input: { site: "YOUTUBE", query: "música de Shakira" } }],
    ["abre YouTube", { action: "OPEN_APPROVED_PAGE", input: { site: "YOUTUBE" } }],
    ["abre Google", { action: "OPEN_APPROVED_PAGE", input: { site: "GOOGLE" } }],
    ["ve a la página de YouTube", { action: "OPEN_APPROVED_PAGE", input: { site: "YOUTUBE" } }]
  ])("routes «%s» to the approved web action whether or not Spotify is registered", async (utterance, draft) => {
    for (const registered of [true, false]) {
      const { result, provider } = await interpret(utterance, { registered });
      expect(drafts(result)).toEqual([draft]);
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it("keeps the alias-only clarification for «Spotify» and routes nothing", async () => {
    for (const registered of [true, false]) {
      const { result, provider } = await interpret("Spotify", { registered });
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", summary: "¿Quieres que abra o que registre Spotify?", drafts: [] } });
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it("lets a registered application alias named like the site keep priority", async () => {
    const { provider } = await interpret("abre YouTube", { aliases: ["youtube"] });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("asks for a valid query instead of building a link", async () => {
    for (const utterance of ["busca https://evil.example en Spotify", "busca ../../x en Spotify", "busca www.malo.com en Google"]) {
      const { result, provider } = await interpret(utterance, { registered: true });
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it("does not intercept unrelated music, search or file requests", async () => {
    for (const utterance of ["busca mi CV", "busca fotos en imágenes", "pon una alarma", "abre Word", "qué música me recomiendas"]) {
      expect(parseStreamingCommand(utterance)).toBeUndefined();
    }
  });

  describe("provider drafts", () => {
    const providerDraft = (action: string, extra: Record<string, unknown>) => ({
      action,
      input: null,
      weeklyRoutine: null,
      habitAction: null,
      approvedWeb: null,
      catalogApplication: null,
      filesAction: null,
      messagingAction: null,
      spotifySearch: null,
      ...extra
    });
    const ready = (draft: unknown) => JSON.stringify({ state: "READY", summary: "ok", responseText: "", drafts: [draft], clarifications: [] });

    it("accepts the closed Spotify variant only with a query the person said", async () => {
      const said = await interpret("quiero oír algo de Natalia Lafourcade", {
        registered: true,
        output: ready(providerDraft("SEARCH_SPOTIFY_APP", { spotifySearch: { query: "Natalia Lafourcade", kind: "ARTIST", playRequested: null } }))
      });
      expect(drafts(said.result)).toEqual([{ action: "SEARCH_SPOTIFY_APP", input: { query: "Natalia Lafourcade", kind: "ARTIST" } }]);

      const invented = await interpret("quiero oír algo", {
        registered: true,
        output: ready(providerDraft("SEARCH_SPOTIFY_APP", { spotifySearch: { query: "Bad Bunny", kind: null, playRequested: null } }))
      });
      expect(invented.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });

      for (const spotifySearch of [
        { query: "https://open.spotify.com/x", kind: null, playRequested: null },
        { query: "Natalia", kind: "SONG", playRequested: null },
        { query: "Natalia", kind: null, playRequested: null, uri: "spotify:search:x" }
      ]) {
        const { result } = await interpret("quiero oír Natalia", { registered: true, output: ready(providerDraft("SEARCH_SPOTIFY_APP", { spotifySearch })) });
        expect(drafts(result)).toEqual([]);
      }
    });

    it("keeps the route consistent with whether the app is registered, as a single draft", async () => {
      const toWeb = await interpret("quiero oír algo de Natalia Lafourcade", {
        registered: false,
        output: ready(providerDraft("SEARCH_SPOTIFY_APP", { spotifySearch: { query: "Natalia Lafourcade", kind: null, playRequested: null } }))
      });
      expect(drafts(toWeb.result)).toEqual([{ action: "SEARCH_APPROVED_SITE", input: { site: "SPOTIFY", query: "Natalia Lafourcade" } }]);

      const toApp = await interpret("quiero oír algo de Natalia Lafourcade", {
        registered: true,
        output: ready(providerDraft("SEARCH_APPROVED_SITE", { approvedWeb: { site: "SPOTIFY", query: "Natalia Lafourcade" } }))
      });
      expect(drafts(toApp.result)).toEqual([{ action: "SEARCH_SPOTIFY_APP", input: { query: "Natalia Lafourcade" } }]);
    });
  });
});

describe("strict structured-output schema and source confinement", () => {
  type SchemaNode = { type?: string; properties?: Record<string, SchemaNode>; required?: string[]; additionalProperties?: boolean; anyOf?: SchemaNode[]; items?: SchemaNode };
  const collect = (node: SchemaNode, found: SchemaNode[] = []): SchemaNode[] => {
    if (node.type === "object") found.push(node);
    for (const property of Object.values(node.properties ?? {})) collect(property, found);
    for (const variant of node.anyOf ?? []) collect(variant, found);
    if (node.items) collect(node.items, found);
    return found;
  };
  const schema = OPENAI_INTERPRETATION_OUTPUT_SCHEMA as unknown as SchemaNode;

  it("keeps every nested object closed and offers no URI, URL or path field for Spotify", () => {
    for (const object of collect(schema)) {
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required ?? [])].sort()).toEqual(Object.keys(object.properties ?? {}).sort());
    }
    const variants = ((schema.properties?.drafts as SchemaNode).items as SchemaNode).anyOf ?? [];
    for (const variant of variants) expect(variant.required).toContain("spotifySearch");
    const spotify = variants[0].properties?.spotifySearch as SchemaNode;
    const object = (spotify.anyOf ?? []).find((entry) => entry.type === "object");
    expect(Object.keys(object?.properties ?? {}).sort()).toEqual(["kind", "playRequested", "query"]);
    expect(JSON.stringify(spotify)).not.toMatch(/uri|url|link|path|spotify:/iu);
    expect(variants[1].properties?.spotifySearch).toEqual({ type: "null" });
  });

  it("composes the Spotify search target only inside the catalog adapter", () => {
    const files = readdirSync(path.resolve(process.cwd(), "src"), { recursive: true, encoding: "utf8" })
      .filter((entry) => /\.tsx?$/u.test(entry))
      .map((entry) => path.join("src", entry));
    const withScheme = files.filter((file) => /["'`]spotify:/u.test(source(file)));
    expect(withScheme.map((file) => path.basename(file))).toEqual(["catalog-application-adapter.ts"]);
    expect(source("src/shared/action-contracts.ts")).not.toMatch(/spotify:|openExternal/u);
    expect(source("src/preload/preload.ts")).not.toMatch(/spotify|openExternal/iu);
    const adapter = source("src/main/applications/catalog-application-adapter.ts");
    expect(adapter.match(/shell\.openExternal\(/gu)).toHaveLength(2);
    expect(adapter).not.toMatch(/fetch\(|node:http|node:net/u);
  });
});
