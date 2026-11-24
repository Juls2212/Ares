"use strict";
/*
 * Loads the built main.js (and the copy inside app.asar, when present) WITHOUT starting Electron.
 *
 * - `electron` is replaced by an inert stub: whenReady() never resolves, so no window is created and no
 *   startup handler runs; the single-instance lock is reported as taken by someone else.
 * - Node's resolver is replaced: only Node built-ins and the electron stub resolve. Any other require fails and
 *   is reported by name. This is what catches a bundle that still requires a package missing from the asar.
 * - Network, process-spawning and socket built-ins are replaced by blockers, so loading can never reach the
 *   network, a child process or the database.
 * Output uses repository-relative paths only.
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { builtinModules } = require("node:module");

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const BLOCKED = new Set(["net", "tls", "http", "https", "http2", "dgram", "dns", "child_process", "cluster", "worker_threads", "inspector"].flatMap((name) => [name, `node:${name}`]));

const createBlocker = (name) => {
  const blocked = function blocked() { throw new Error(`smoke: ${name} is blocked while loading`); };
  return new Proxy(blocked, {
    get: (_target, property) => (property === "prototype" ? blocked.prototype : property === "__esModule" ? false : blocked),
    apply: () => { throw new Error(`smoke: ${name} is blocked while loading`); }
  });
};

const OVERRIDES = {
  isPackaged: true,
  requestSingleInstanceLock: () => false,
  whenReady: () => new Promise(() => undefined),
  getPath: () => "smoke-user-data",
  getName: () => "ares-smoke",
  getVersion: () => "0.0.0"
};

/** An inert, deeply callable stand-in for the electron module. */
const createElectronStub = () => {
  const make = (overrides) => {
    const target = function inert() { return undefined; };
    return new Proxy(target, {
      get: (_target, property) => {
        if (typeof property === "symbol" || property === "then" || property === "__esModule") return undefined;
        if (overrides && property in overrides) return overrides[property];
        if (property === "shouldUseDarkColors") return false;
        if (property === "themeSource") return "system";
        return make(undefined);
      },
      set: () => true,
      apply: () => make(undefined),
      construct: () => make(undefined)
    });
  };
  return make({ app: make(OVERRIDES) });
};

/**
 * Runs a bundle's source with the restricted resolver. Returns every require that was attempted, the ones that
 * could not be resolved, and any other error thrown while the module body ran.
 */
const loadBundle = (source, filename = "bundle.js") => {
  const requires = [];
  const unresolved = [];
  const electron = createElectronStub();
  const sandboxRequire = (specifier) => {
    if (specifier === "electron" || /^electron\/[a-z]+$/u.test(specifier)) { requires.push({ specifier, kind: "electron stub" }); return electron; }
    if (BLOCKED.has(specifier)) { requires.push({ specifier, kind: "built-in (blocked)" }); return createBlocker(specifier); }
    if (BUILTINS.has(specifier)) { requires.push({ specifier, kind: "built-in" }); return require(specifier); }
    requires.push({ specifier, kind: "UNRESOLVED" });
    unresolved.push(specifier);
    const error = new Error(`Cannot find module '${specifier}'`);
    error.code = "MODULE_NOT_FOUND";
    throw error;
  };
  const moduleObject = { exports: {} };
  let loadError;
  try {
    const wrapper = new vm.Script(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, { filename });
    wrapper.runInThisContext()(moduleObject.exports, sandboxRequire, moduleObject, filename, path.dirname(filename));
  } catch (error) {
    loadError = error;
  }
  return { requires, unresolved: [...new Set(unresolved)], loadError };
};

const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");

const report = (label, source) => {
  console.log(`\n${label}`);
  const outcome = loadBundle(source, "main.js");
  const counts = {};
  for (const entry of outcome.requires) counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  console.log(`  requires attempted: ${outcome.requires.length} (${Object.entries(counts).map(([kind, count]) => `${kind}: ${count}`).join(", ") || "none"})`);
  const resolved = [...new Set(outcome.requires.filter((entry) => entry.kind !== "UNRESOLVED").map((entry) => entry.specifier))].sort();
  console.log(`  resolved: ${resolved.join(", ")}`);
  console.log(`  unresolved: ${outcome.unresolved.length === 0 ? "none" : outcome.unresolved.join(", ")}`);
  if (outcome.loadError && outcome.unresolved.length === 0) {
    console.log(`  load stopped with a non-resolver error: ${String(outcome.loadError && outcome.loadError.message).slice(0, 160)}`);
  }
  return outcome;
};

const run = () => {
  const root = process.cwd();
  let failed = false;
  const built = path.join(root, ".vite", "build", "main.js");
  if (fs.existsSync(built)) {
    const outcome = report(relative(root, built), fs.readFileSync(built, "utf8"));
    failed = failed || outcome.unresolved.length > 0 || Boolean(outcome.loadError);
  } else {
    console.log("\n.vite/build/main.js not found (run npm run package first)");
    failed = true;
  }
  const outDirectory = path.join(root, "out");
  const findArchives = (directory, found = []) => {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return found; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") findArchives(full, found); }
      else if (entry.name === "app.asar") found.push(full);
    }
    return found;
  };
  for (const archive of fs.existsSync(outDirectory) ? findArchives(outDirectory) : []) {
    const asar = require("@electron/asar");
    const rawEntries = asar.listPackage(archive, { isPack: false });
    const found = rawEntries.find((entry) => entry.split("\\").join("/") === "/.vite/build/main.js");
    if (found === undefined) {
      console.log(`\nasar copy inside ${relative(root, archive)}\n  .vite/build/main.js is not inside this archive`);
      failed = true;
      continue;
    }
    const text = asar.extractFile(archive, found.replace(/^[\\/]/u, "")).toString("utf8");
    const outcome = report(`asar copy inside ${relative(root, archive)}`, text);
    failed = failed || outcome.unresolved.length > 0 || Boolean(outcome.loadError);
  }
  console.log(`\nsmoke result: ${failed ? "FAILED" : "ok"}`);
  process.exit(failed ? 1 : 0);
};

module.exports = { loadBundle, createElectronStub };

if (require.main === module) run();
