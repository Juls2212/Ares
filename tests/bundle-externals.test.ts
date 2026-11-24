import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import mainConfig from "../vite.main.config";
import preloadConfig from "../vite.preload.config";
import { ARES_EXTERNALS } from "../vite.externals";
import { getOptionalModuleStubSource, optionalModuleStubs, STUBBED_OPTIONAL_MODULES } from "../vite.stubs";
import { readSource } from "./helpers/read-source";
import packageJson from "../package.json";

const nodeRequire = createRequire(import.meta.url);
const scanner = nodeRequire("../scripts/scan-bundle.cjs") as { findBareSpecifiers: (source: string) => string[] };
const smoke = nodeRequire("../scripts/smoke-main-load.cjs") as {
  loadBundle: (source: string, filename?: string) => { requires: { specifier: string; kind: string }[]; unresolved: string[]; loadError?: Error };
};

const externalOf = (config: unknown): string[] =>
  (config as { build: { rollupOptions: { external: string[] } } }).build.rollupOptions.external;

describe("bundle externals: Main and preload", () => {
  const expected = [...builtinModules.flatMap((name) => [name, `node:${name}`]), "electron"];

  it("leave only built-ins and electron external", () => {
    expect([...externalOf(mainConfig)].sort()).toEqual([...expected].sort());
    expect([...externalOf(preloadConfig)].sort()).toEqual([...expected].sort());
    expect(ARES_EXTERNALS).toEqual(externalOf(mainConfig));
  });

  it("never externalizes a package.json dependency or an optional pg module", () => {
    const externals = new Set(externalOf(mainConfig));
    for (const name of Object.keys(packageJson.dependencies)) expect(externals.has(name), `${name} must be bundled`).toBe(false);
    for (const name of STUBBED_OPTIONAL_MODULES) expect(externals.has(name), `${name} must be stubbed`).toBe(false);
  });

  it("shares one source of truth between the Main and the preload configuration", () => {
    expect(readSource("vite.main.config.ts")).toContain("external: ARES_EXTERNALS");
    expect(readSource("vite.preload.config.ts")).toContain("external: ARES_EXTERNALS");
  });

  it("registers the stub plugin for Main only", () => {
    const plugins = (mainConfig as { plugins: { name: string }[] }).plugins;
    expect(plugins.map((plugin) => plugin.name)).toContain("ares:optional-module-stubs");
    expect((preloadConfig as { plugins?: unknown[] }).plugins).toBeUndefined();
  });
});

describe("optional module stubs", () => {
  const plugin = optionalModuleStubs() as unknown as {
    enforce: string;
    resolveId: (source: string) => string | undefined;
    load: (id: string) => string | undefined;
  };

  it("stubs exactly pg-native and pg-cloudflare", () => {
    expect([...STUBBED_OPTIONAL_MODULES]).toEqual(["pg-native", "pg-cloudflare"]);
    expect(plugin.enforce).toBe("pre");
  });

  it("resolves each stubbed module to a virtual id and nothing else", () => {
    for (const name of STUBBED_OPTIONAL_MODULES) {
      const id = plugin.resolveId(name);
      expect(id).toMatch(/^\0ares-optional-stub:/u);
      expect(plugin.load(id as string)).toBe(getOptionalModuleStubSource(name));
    }
    for (const other of ["pg", "drizzle-orm", "electron", "node:fs", "./local", "pg-native/lib"]) expect(plugin.resolveId(other)).toBeUndefined();
    expect(plugin.load("\0other:thing")).toBeUndefined();
  });

  it("makes the cloudflare stub an empty export that is never read", () => {
    expect(getOptionalModuleStubSource("pg-cloudflare")).toMatch(/export default \{\};/u);
  });

  it("makes the pg-native stub inert to evaluate and MODULE_NOT_FOUND when used", () => {
    const source = getOptionalModuleStubSource("pg-native") as string;
    // Evaluating the module must not throw (it runs at startup); only calling the constructor does.
    expect(source).not.toMatch(/^throw /mu);
    const factory = new Function(`${source.replace("export default function", "return function")}`)() as new () => unknown;
    expect(typeof factory).toBe("function");
    let caught: { code?: string; message?: string } | undefined;
    try { new factory(); } catch (error) { caught = error as { code?: string; message?: string }; }
    expect(caught?.code).toBe("MODULE_NOT_FOUND");
    expect(caught?.message).toContain("pg-native");
  });
});

describe("bundle scan helper", () => {
  it("detects bare specifiers in require, import and static import forms", () => {
    const source = [
      'const a = require("pg-native");',
      'import b from"left-pad";',
      'const c = await import("some-lazy");',
      'import "side-effect-pkg";'
    ].join("\n");
    expect(scanner.findBareSpecifiers(source)).toEqual(["left-pad", "pg-native", "side-effect-pkg", "some-lazy"]);
  });

  it("ignores Node built-ins with and without the node: prefix, electron and relative paths", () => {
    const source = [
      'const fs = require("fs"); const p = require("node:path"); const u = require("util/types");',
      'const e = require("electron"); const m = require("electron/main");',
      'const r = require("./local"); import x from "../other";'
    ].join("\n");
    expect(scanner.findBareSpecifiers(source)).toEqual([]);
  });

  it("does not mistake prose or code inside string literals for a specifier", () => {
    const source = [
      'throw new Error("pass the fetch from the same package: import { fetch } from \'undici\'; new X()");',
      'const keys = ["apiKey","adminAPIKey"]; const t = `from "not a package"`;'
    ].join("\n");
    expect(scanner.findBareSpecifiers(source)).toEqual([]);
  });

  it("has no allowlist any more and is read-only", () => {
    const source = readSource("scripts/scan-bundle.cjs");
    expect(source).not.toMatch(/OPTIONAL_NATIVE|allowlist|documented optional/u);
    expect(source).not.toMatch(/writeFile|unlink|rmSync|appendFile|child_process|\.env/u);
    expect(source).toContain("relative(root,");
  });

  it("exits non-zero when a built bundle has a non-built-in bare specifier, and zero when it does not", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ares-scan-"));
    try {
      mkdirSync(path.join(root, ".vite", "build"), { recursive: true });
      const script = path.resolve(process.cwd(), "scripts/scan-bundle.cjs");
      const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });

      writeFileSync(path.join(root, ".vite", "build", "main.js"), 'const fs = require("fs"); const e = require("electron");');
      writeFileSync(path.join(root, ".vite", "build", "preload.js"), 'require("electron");');
      const clean = run();
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain("unexpected bare specifiers: 0");

      writeFileSync(path.join(root, ".vite", "build", "main.js"), 'const x = require("pg-cloudflare");');
      const dirty = run();
      expect(dirty.status).toBe(1);
      expect(dirty.stdout).toContain("bare specifier: pg-cloudflare [UNEXPECTED]");
      expect(dirty.stdout).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("smoke script: main.js load with a restricted resolver", () => {
  it("resolves built-ins and electron and reports a missing package by name", () => {
    const ok = smoke.loadBundle('const fs = require("node:fs"); const { app } = require("electron"); app.whenReady();');
    expect(ok.unresolved).toEqual([]);
    expect(ok.loadError).toBeUndefined();

    const bad = smoke.loadBundle('const a = require("path"); const c = require("pg-cloudflare");');
    expect(bad.unresolved).toEqual(["pg-cloudflare"]);
    expect(bad.requires.find((entry) => entry.specifier === "pg-cloudflare")?.kind).toBe("UNRESOLVED");
    expect((bad.loadError as { code?: string }).code).toBe("MODULE_NOT_FOUND");
  });

  it("blocks network and process-spawning built-ins, and never opens a window", () => {
    const outcome = smoke.loadBundle('const net = require("net"); globalThis.__smoke = typeof net.Socket; require("child_process").spawn("x");');
    expect(outcome.loadError?.message).toContain("blocked");
    const source = readSource("scripts/smoke-main-load.cjs");
    expect(source).toContain("whenReady: () => new Promise(() => undefined)");
    expect(source).toContain("requestSingleInstanceLock: () => false");
  });

  it("is read-only and prints repository-relative paths", () => {
    const source = readSource("scripts/smoke-main-load.cjs");
    expect(source).not.toMatch(/writeFile|unlink|rmSync|appendFile|\.env/u);
    expect(source).toContain("relative(root,");
  });
});

describe("packaged environment loading", () => {
  it("reads the development .env only when the app is not packaged", async () => {
    vi.resetModules();
    const config = vi.fn();
    vi.doMock("dotenv", () => ({ default: { config } }));
    const loader = await import("../src/main/config/development-environment");
    loader.loadDevelopmentEnvironment();
    expect(config).toHaveBeenCalledTimes(1);
    expect(config).toHaveBeenCalledWith({ quiet: true });
    loader.markPackagedRuntime(true);
    loader.loadDevelopmentEnvironment();
    expect(config).toHaveBeenCalledTimes(1);
    vi.doUnmock("dotenv");
    vi.resetModules();
  });

  it("is applied by every configuration reader and marked by Main before any read", () => {
    for (const file of ["src/main/config/database-environment.ts", "src/main/config/openai-environment.ts", "src/main/spotify/spotify-config.ts"]) {
      const source = readSource(file);
      expect(source, file).not.toContain("dotenv");
      expect(source, file).toContain("loadDevelopmentEnvironment()");
    }
    const main = readSource("src/main/main.ts");
    expect(main).toContain("markPackagedRuntime(app.isPackaged);");
    expect(main.indexOf("markPackagedRuntime(app.isPackaged)")).toBeLessThan(main.indexOf("registerActionIpcHandlers("));
  });
});
