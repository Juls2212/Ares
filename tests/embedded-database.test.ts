import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ARES_ENV_NAMES, parseAresEnv } from "../src/main/config/ares-env-file";
import { loadDevelopmentEnvironment, markPackagedRuntime } from "../src/main/config/development-environment";
import { createDatabaseClient } from "../src/main/database/database-client";
import { selectDatabaseDriver } from "../src/main/database/database-driver";
import {
  PGLITE_ASSET_FILES,
  resolveMigrationsDirectory,
  resolvePgliteAssetDirectory,
  resolvePgliteDataDirectory
} from "../src/main/database/pglite-assets.mjs";
import { readSource } from "./helpers/read-source";

describe("database driver selection", () => {
  it("uses PostgreSQL when DATABASE_URL is set and PGlite when it is unset or blank", () => {
    expect(selectDatabaseDriver({ DATABASE_URL: "postgresql://user:pass@host:5432/db" })).toBe("POSTGRES");
    expect(selectDatabaseDriver({})).toBe("PGLITE");
    expect(selectDatabaseDriver({ DATABASE_URL: "" })).toBe("PGLITE");
    expect(selectDatabaseDriver({ DATABASE_URL: "   " })).toBe("PGLITE");
  });

  const fakes = () => {
    const migratePglite = vi.fn(async () => undefined);
    const client = { waitReady: Promise.resolve(), query: vi.fn(async () => ({ rows: [] })), close: vi.fn(async () => undefined) };
    const pgliteDatabase = {};
    return {
      client,
      pgliteDatabase,
      migratePglite,
      dependencies: {
        createPglite: vi.fn(() => client as never),
        createPgliteDatabase: vi.fn(() => pgliteDatabase as never),
        migratePglite,
        createPool: vi.fn(() => ({ end: vi.fn(), connect: vi.fn() }) as never),
        createDatabase: vi.fn(() => ({}) as never),
        getDatabaseUrl: vi.fn(() => "postgresql://user:pass@host:5432/db"),
        logInfo: vi.fn(),
        logError: vi.fn()
      }
    };
  };

  it("opens PGlite lazily, migrates once and logs only the driver name", async () => {
    const { client, pgliteDatabase, migratePglite, dependencies } = fakes();
    const database = createDatabaseClient({ ...dependencies, selectDriver: () => "PGLITE" });
    expect(dependencies.createPglite).not.toHaveBeenCalled();

    expect(database.getDatabase()).toBe(pgliteDatabase);
    expect(database.getDatabase()).toBe(pgliteDatabase);
    expect(dependencies.createPglite).toHaveBeenCalledTimes(1);
    expect(dependencies.createPool).not.toHaveBeenCalled();

    await expect(database.prepare()).resolves.toEqual({ ok: true });
    await database.prepare();
    expect(migratePglite).toHaveBeenCalledTimes(1);

    await expect(database.verifyConnection()).resolves.toEqual({ ok: true });
    expect(client.query).toHaveBeenCalledWith("SELECT 1");
    await expect(database.close()).resolves.toEqual({ ok: true });
    expect(client.close).toHaveBeenCalledTimes(1);

    expect(dependencies.logInfo).toHaveBeenCalledTimes(1);
    expect(dependencies.logInfo).toHaveBeenCalledWith("Database driver [PGLITE]");
  });

  it("keeps using pg for PostgreSQL and never opens PGlite", async () => {
    const { dependencies } = fakes();
    const database = createDatabaseClient({ ...dependencies, selectDriver: () => "POSTGRES" });
    database.getDatabase();
    await expect(database.prepare()).resolves.toEqual({ ok: true });
    expect(dependencies.createPool).toHaveBeenCalledTimes(1);
    expect(dependencies.createPglite).not.toHaveBeenCalled();
    expect(dependencies.migratePglite).not.toHaveBeenCalled();
    expect(dependencies.logInfo).toHaveBeenCalledWith("Database driver [POSTGRES]");
  });

  it("reports a failed preparation without leaking details", async () => {
    const { dependencies } = fakes();
    dependencies.migratePglite.mockRejectedValueOnce(new Error("secret detail at C:\\Users\\someone\\x"));
    const database = createDatabaseClient({ ...dependencies, selectDriver: () => "PGLITE" });
    const result = await database.prepare();
    expect(result).toEqual({ ok: false, error: { code: "DATABASE_PREPARATION_FAILED", message: "Database preparation failed." } });
    expect(dependencies.logError).toHaveBeenCalledWith("Database preparation failed.");
    expect(JSON.stringify(dependencies.logError.mock.calls)).not.toContain("secret");
  });

  it("is selected in one place and is told about Main before the first query", () => {
    const client = readSource("src/main/database/database-client.ts");
    expect(client).toContain("selectDriver: () => selectDatabaseDriver()");
    const main = readSource("src/main/main.ts");
    expect(main).toContain("await prepareDatabase();");
    expect(main.indexOf("await prepareDatabase();")).toBeLessThan(main.indexOf("getReminderDeliveryScheduler().start()"));
  });
});

describe("PGlite asset and data paths", () => {
  const dev = { isPackaged: false, resourcesPath: path.join("C:", "res"), appPath: path.join("C:", "project") };
  const packaged = { ...dev, isPackaged: true };

  it("reads the files from the resources folder when packaged and from node_modules in development", () => {
    expect(resolvePgliteAssetDirectory(packaged)).toBe(packaged.resourcesPath);
    expect(resolvePgliteAssetDirectory(dev)).toBe(path.join(dev.appPath, "node_modules", "@electric-sql", "pglite", "dist"));
    expect(resolveMigrationsDirectory(packaged)).toBe(path.join(packaged.resourcesPath, "drizzle"));
    expect(resolveMigrationsDirectory(dev)).toBe(path.join(dev.appPath, "drizzle"));
  });

  it("keeps the data directory inside userData and rejects an empty one", () => {
    const userData = path.join("C:", "Users", "someone", "AppData", "Roaming", "Ares");
    const target = resolvePgliteDataDirectory(userData);
    expect(path.relative(path.resolve(userData), target).startsWith("..")).toBe(false);
    expect(target.startsWith(path.resolve(userData))).toBe(true);
    expect(() => resolvePgliteDataDirectory("")).toThrow();
  });

  it("ships the three PGlite files and the migrations through Forge extraResource", () => {
    const forge = readSource("forge.config.ts");
    for (const file of PGLITE_ASSET_FILES) expect(forge).toContain(`@electric-sql/pglite/dist/${file}`);
    expect(forge).toContain('"./drizzle"');
    expect(forge).toContain("asar: true");
  });

  it("never logs the data directory or the assets directory", () => {
    const client = readSource("src/main/database/database-client.ts");
    expect(client).not.toMatch(/logInfo\([^)]*(Directory|userData|Path)/u);
  });
});

describe("ares.env parser", () => {
  it("reads KEY=VALUE lines, skips comments and blank lines, and unquotes values", () => {
    const text = [
      "# my keys",
      "",
      "OPENAI_API_KEY=sk-example",
      'OPENAI_MODEL = "gpt example"  ',
      "ELEVENLABS_VOICE_ID='voice-1'",
      "SPOTIFY_CLIENT_ID=abc123 # trailing comment",
      "   # indented comment",
      "export OPENAI_TRANSCRIPTION_MODEL=whisper-x"
    ].join("\r\n");
    expect(parseAresEnv(text)).toEqual({
      OPENAI_API_KEY: "sk-example",
      OPENAI_MODEL: "gpt example",
      ELEVENLABS_VOICE_ID: "voice-1",
      SPOTIFY_CLIENT_ID: "abc123",
      OPENAI_TRANSCRIPTION_MODEL: "whisper-x"
    });
  });

  it("ignores unknown names, empty values and malformed lines, and strips a BOM", () => {
    const text = "\uFEFFOPENAI_API_KEY=k\nPATH=/bin\nNODE_OPTIONS=--inspect\nELEVENLABS_API_KEY=\nnot a line\n=nothing\nDATABASE_URL=postgresql://u:p@h/d";
    expect(parseAresEnv(text)).toEqual({ OPENAI_API_KEY: "k", DATABASE_URL: "postgresql://u:p@h/d" });
  });

  it("allows exactly the documented names", () => {
    expect([...ARES_ENV_NAMES]).toEqual([
      "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_TRANSCRIPTION_MODEL", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "SPOTIFY_CLIENT_ID", "DATABASE_URL"
    ]);
  });

  it("does not log, throw or touch the process environment", () => {
    const source = readSource("src/main/config/ares-env-file.ts");
    expect(source).not.toMatch(/console\.|process\.|fs\./u);
  });
});

describe("ares.env loading in a packaged app", () => {
  let directory: string;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "ares-env-"));
    for (const name of ARES_ENV_NAMES) { saved.set(name, process.env[name]); delete process.env[name]; }
  });

  afterEach(() => {
    markPackagedRuntime(false);
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("applies the file after the process environment, never over a value that is already set", () => {
    process.env.OPENAI_MODEL = "from-process-environment";
    writeFileSync(path.join(directory, "ares.env"), "OPENAI_API_KEY=from-file\nOPENAI_MODEL=from-file\nUNKNOWN_NAME=x\n");
    markPackagedRuntime(true, directory);
    loadDevelopmentEnvironment();
    expect(process.env.OPENAI_API_KEY).toBe("from-file");
    expect(process.env.OPENAI_MODEL).toBe("from-process-environment");
    expect(process.env.UNKNOWN_NAME).toBeUndefined();
  });

  it("picks up an edited file without a restart, and ignores a missing file", () => {
    markPackagedRuntime(true, directory);
    expect(() => loadDevelopmentEnvironment()).not.toThrow();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    writeFileSync(path.join(directory, "ares.env"), "OPENAI_API_KEY=first\n");
    loadDevelopmentEnvironment();
    expect(process.env.OPENAI_API_KEY).toBe("first");
    writeFileSync(path.join(directory, "ares.env"), "OPENAI_API_KEY=second\n");
    loadDevelopmentEnvironment();
    expect(process.env.OPENAI_API_KEY).toBe("second");
    writeFileSync(path.join(directory, "ares.env"), "# removed\n");
    loadDevelopmentEnvironment();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("lets DATABASE_URL in the file select PostgreSQL, and never logs values", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    writeFileSync(path.join(directory, "ares.env"), "DATABASE_URL=postgresql://user:very-secret@host:5432/db\nOPENAI_API_KEY=sk-very-secret\n");
    markPackagedRuntime(true, directory);
    expect(selectDatabaseDriver()).toBe("POSTGRES");
    expect(JSON.stringify([log.mock.calls, info.mock.calls, error.mock.calls])).not.toContain("very-secret");
  });

  it("is not read at all in development", () => {
    writeFileSync(path.join(directory, "ares.env"), "OPENAI_API_KEY=should-not-load\n");
    markPackagedRuntime(false, directory);
    loadDevelopmentEnvironment();
    expect(process.env.OPENAI_API_KEY).not.toBe("should-not-load");
  });
});
