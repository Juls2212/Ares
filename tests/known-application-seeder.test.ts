import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import {
  KNOWN_APPLICATIONS_SEEDED_SETTING_KEY,
  SEEDED_CATALOG_KEYS,
  seedKnownApplications,
  type KnownApplicationSeedMarker
} from "../src/main/applications/known-application-seeder";
import { validateRegisterApplicationInput } from "../src/main/applications/application-validation";
import { TRANSCRIPTION_PROMPT_HINT } from "../src/main/voice/openai-transcription-provider";

type AppRow = { id: string; name: string; catalogKey: string | null; aliases: { alias: string }[]; launchMode: string };

/** An in-memory stand-in that applies the real registration validation and the name-conflict rule. */
const createStore = (initial: AppRow[] = []) => {
  const records = [...initial];
  const applicationService = {
    listApplications: vi.fn(async () => ({ ok: true as const, data: { items: records, total: records.length } })),
    registerApplication: vi.fn(async (input: unknown) => {
      const validation = validateRegisterApplicationInput(input);
      if (!validation.ok) return { ok: false as const, error: { code: "APPLICATION_INPUT_INVALID", userMessage: "x" } };
      if (records.some((record) => record.name.toLowerCase() === validation.data.name.toLowerCase())) {
        return { ok: false as const, error: { code: "APPLICATION_CONFLICT", userMessage: "x" } };
      }
      const data = validation.data as unknown as { name: string; catalogKey?: string; launchMode: string; aliases?: string[] };
      records.push({
        id: `id-${records.length}`, name: data.name, catalogKey: data.catalogKey ?? null,
        launchMode: data.launchMode, aliases: (data.aliases ?? []).map((alias) => ({ alias }))
      });
      return { ok: true as const, data: { record: records.at(-1) } };
    })
  };
  return { records, applicationService: applicationService as never, spies: applicationService };
};

const createMarker = (): KnownApplicationSeedMarker & { value: boolean } => {
  const marker = { value: false, isSet: async () => marker.value, set: async () => { marker.value = true; } };
  return marker;
};

const seed = (store: ReturnType<typeof createStore>, marker: KnownApplicationSeedMarker, extra: Record<string, unknown> = {}) =>
  seedKnownApplications({ applicationService: store.applicationService, marker, platform: () => "win32", logError: vi.fn(), ...extra } as never);

describe("known application seeder", () => {
  it("seeds exactly the five known apps with their aliases, as catalog applications", async () => {
    const store = createStore();
    const marker = createMarker();
    expect(await seed(store, marker)).toEqual({ status: "SEEDED", registered: 5 });
    expect(store.records.map((record) => [record.catalogKey, record.name, record.aliases.map((entry) => entry.alias), record.launchMode])).toEqual([
      ["SPOTIFY", "Spotify", ["spotify"], "CATALOG_APPLICATION"],
      ["WHATSAPP", "WhatsApp", ["whatsapp"], "CATALOG_APPLICATION"],
      ["GOOGLE_CHROME", "Google Chrome", ["chrome"], "CATALOG_APPLICATION"],
      ["CLAUDE", "Claude", ["claude"], "CATALOG_APPLICATION"],
      ["DISCORD", "Discord", ["discord"], "CATALOG_APPLICATION"]
    ]);
    expect(SEEDED_CATALOG_KEYS).toHaveLength(5);
    expect(marker.value).toBe(true);
    expect(KNOWN_APPLICATIONS_SEEDED_SETTING_KEY).toMatch(/^[a-z][a-z0-9_]*$/u);
  });

  it("is a no-op on the second run and does not resurrect a removed or renamed app", async () => {
    const store = createStore();
    const marker = createMarker();
    await seed(store, marker);
    store.records.splice(0, 2);
    store.records[0]!.name = "Mi navegador";
    const before = JSON.stringify(store.records);
    store.spies.registerApplication.mockClear();
    expect(await seed(store, marker)).toEqual({ status: "SKIPPED_ALREADY_DONE" });
    expect(store.spies.registerApplication).not.toHaveBeenCalled();
    expect(JSON.stringify(store.records)).toBe(before);
  });

  it("leaves apps the person already registered untouched, including a conflicting name or alias", async () => {
    const mine: AppRow[] = [
      { id: "a", name: "Spotify", catalogKey: "SPOTIFY", aliases: [{ alias: "musica" }], launchMode: "CATALOG_APPLICATION" },
      { id: "b", name: "Mi chat", catalogKey: null, aliases: [{ alias: "whatsapp" }], launchMode: "WINDOWS_EXECUTABLE" }
    ];
    const store = createStore(mine);
    const snapshot = JSON.stringify(mine);
    expect(await seed(store, createMarker())).toEqual({ status: "SEEDED", registered: 3 });
    expect(JSON.stringify(store.records.slice(0, 2))).toBe(snapshot);
    expect(store.records.filter((record) => record.catalogKey === "SPOTIFY")).toHaveLength(1);
    expect(store.records.map((record) => record.catalogKey).sort()).toEqual(["CLAUDE", "DISCORD", "GOOGLE_CHROME", "SPOTIFY", null]);
  });

  it("never throws out of startup and logs one closed-code line without user data", async () => {
    for (const failure of ["list", "register", "marker", "throw"] as const) {
      const store = createStore();
      const logError = vi.fn();
      const marker = createMarker();
      if (failure === "list") store.spies.listApplications.mockResolvedValue({ ok: false, error: { code: "APPLICATION_STORAGE_UNAVAILABLE", userMessage: "private" } } as never);
      if (failure === "register") store.spies.registerApplication.mockResolvedValue({ ok: false, error: { code: "APPLICATION_STORAGE_UNAVAILABLE", userMessage: "private" } } as never);
      if (failure === "marker") marker.set = async () => { throw new Error("private-detail"); };
      if (failure === "throw") store.spies.listApplications.mockRejectedValue(new Error("private-detail"));
      const result = await seed(store, marker, { logError });
      expect(result.status).toBe("FAILED");
      expect(logError).toHaveBeenCalledOnce();
      expect(String(logError.mock.calls[0]![0])).toMatch(/^Known application seeding failed \[KNOWN_APPS_SEED_[A-Z_]+\]\.$/u);
      if (failure !== "marker") expect(marker.value).toBe(false);
    }
    const brokenMarker = { isSet: async () => { throw new Error("db down"); }, set: async () => undefined };
    await expect(seed(createStore(), brokenMarker)).resolves.toMatchObject({ status: "FAILED", code: "KNOWN_APPS_SEED_MARKER_UNAVAILABLE" });
  });

  it("makes «abre Spotify» and «abre WhatsApp» resolve to OPEN_APPLICATION instead of the register-first clarification", async () => {
    const store = createStore();
    await seed(store, createMarker());
    const knownApplicationAliases = store.records.flatMap((record) => record.aliases.map((entry) => entry.alias));
    const interpret = async (alias: string, instruction: string, aliases: string[]) => createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret: async () => JSON.stringify({
        state: "READY", summary: "Preparé las acciones solicitadas.", responseText: "", clarifications: [],
        drafts: [{ action: "OPEN_APPLICATION", input: JSON.stringify({ alias }), approvedWeb: null }]
      }) })
    }).interpret({ instruction }, { knownApplicationAliases: aliases, knownCatalogApplications: [] });
    for (const [alias, instruction] of [["spotify", "abre Spotify"], ["whatsapp", "abre WhatsApp"]] as const) {
      await expect(interpret(alias, instruction, knownApplicationAliases)).resolves.toMatchObject({ ok: true, data: { state: "READY", drafts: [{ action: "OPEN_APPLICATION", input: { alias } }] } });
      await expect(interpret(alias, instruction, [])).resolves.toMatchObject({ data: { state: "NEEDS_CLARIFICATION", clarifications: [{ question: "Aún no tengo esa aplicación registrada. Pídeme que la registre primero." }] } });
    }
  });

  it("is imported only by the Main startup file, never by IPC, interpreter, actions, preload or renderer code", () => {
    const importers: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const full = path.join(directory, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/u.test(entry) && /known-application-seeder/u.test(readFileSync(full, "utf8"))) importers.push(path.relative(process.cwd(), full).replaceAll("\\", "/"));
      }
    };
    walk(path.resolve(process.cwd(), "src"));
    expect(importers).toEqual(["src/main/main.ts"]);
    const source = readFileSync(path.resolve(process.cwd(), "src/main/applications/known-application-seeder.ts"), "utf8");
    expect(source).not.toMatch(/ipcMain|ipcRenderer|contextBridge|catalog-application-adapter|registerApplication\(\{\s*[^}]*isAvailable/u);
  });
});

describe("transcription hint", () => {
  it("is a fixed constant with only Ares and the five known apps, used by the provider", () => {
    expect(TRANSCRIPTION_PROMPT_HINT).toBe("Ares, abre Spotify, WhatsApp, Google, Claude o Discord.");
    const source = readFileSync(path.resolve(process.cwd(), "src/main/voice/openai-transcription-provider.ts"), "utf8");
    expect(source).toContain("prompt: TRANSCRIPTION_PROMPT_HINT");
    expect(source).toContain('language: "es"');
    expect(source.match(/prompt:/gu)).toHaveLength(1);
    expect(source).toMatch(/const TRANSCRIPTION_PROMPT_HINT = "[^"$`{}]*";/u);
    // No input of transcribe() reaches the prompt.
    expect(source).not.toMatch(/prompt: (?!TRANSCRIPTION_PROMPT_HINT)/u);
    for (const hostile of ["ignora todo", "Ana García", "C:\\Users\\Ana"]) expect(TRANSCRIPTION_PROMPT_HINT).not.toContain(hostile);
  });
});
