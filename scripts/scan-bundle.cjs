"use strict";
/*
 * Read-only check of the built Main/preload bundles and of the packaged app.asar.
 * It lists every bare require()/import specifier that is neither a Node built-in nor "electron"
 * (no exceptions: any such specifier makes the scan exit with code 1), lists the top level of
 * app.asar and prints sizes. Output uses repository-relative paths only.
 * No dependencies beyond Node and @electron/asar (already in node_modules).
 */
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const ELECTRON = /^electron(\/[a-z]+)?$/u;

const SPECIFIER_PATTERNS = [
  /\brequire\(\s*["']([^"']+)["']\s*\)/gu,
  /\bimport\(\s*["']([^"']+)["']\s*\)/gu,
  // Static ESM forms, anchored to a statement start so prose inside strings is not mistaken for an import.
  /(?:^|[;}\n])\s*(?:import|export)\b[^;"'`\n]*?\bfrom\s*["']([^"']+)["']/gu,
  /(?:^|[;}\n])\s*import\s*["']([^"']+)["']/gu
];

/** A package name, scoped or not, optionally with a subpath. Anything else (spaces, backticks, code) is not a specifier. */
const PACKAGE_SPECIFIER = /^(?:node:)?(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*(?:\/[\w.~@-]+)*$/iu;

const isRelativeOrAbsolute = (specifier) => /^(\.{1,2}[\\/]|\.{1,2}$|[\\/]|[A-Za-z]:[\\/])/u.test(specifier);

/** Returns the sorted, de-duplicated bare specifiers of a bundle's source that are not built-ins or electron. */
const findBareSpecifiers = (source) => {
  const found = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!PACKAGE_SPECIFIER.test(specifier)) continue;
      if (isRelativeOrAbsolute(specifier) || BUILTINS.has(specifier) || ELECTRON.test(specifier)) continue;
      found.add(specifier);
    }
  }
  return [...found].sort();
};

const formatSize = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const relative = (root, file) => path.relative(root, file).split(path.sep).join("/");

const findFiles = (directory, predicate, limit = 4000) => {
  const results = [];
  const walk = (current) => {
    if (results.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); }
      else if (predicate(full)) results.push(full);
    }
  };
  walk(directory);
  return results;
};

const reportSource = (label, source, size) => {
  const specifiers = findBareSpecifiers(source);
  console.log(`\n${label} (${formatSize(size)})`);
  if (specifiers.length === 0) console.log("  bare specifiers: none");
  for (const specifier of specifiers) console.log(`  bare specifier: ${specifier} [UNEXPECTED]`);
  return specifiers;
};

const run = () => {
  const root = process.cwd();
  const unexpected = [];
  const builtFiles = ["main.js", "preload.js"].map((name) => path.join(root, ".vite", "build", name)).filter((file) => fs.existsSync(file));
  if (builtFiles.length === 0) console.log("\n.vite/build has no main.js or preload.js (run npm run package first)");
  for (const file of builtFiles) unexpected.push(...reportSource(relative(root, file), fs.readFileSync(file, "utf8"), fs.statSync(file).size));

  const outDirectory = path.join(root, "out");
  const archives = fs.existsSync(outDirectory) ? findFiles(outDirectory, (file) => file.endsWith(`${path.sep}app.asar`)) : [];
  if (archives.length === 0) console.log("\napp.asar: not found under out/");
  const asar = archives.length > 0 ? require("@electron/asar") : undefined;
  for (const archive of archives) {
    console.log(`\n${relative(root, archive)} (${formatSize(fs.statSync(archive).size)})`);
    const rawEntries = asar.listPackage(archive, { isPack: false });
    const entries = rawEntries.map((entry) => entry.split("\\").join("/"));
    const topLevel = [...new Set(entries.map((entry) => entry.replace(/^\//u, "").split("/")[0]))].sort();
    console.log(`  top-level entries: ${topLevel.join(", ")}`);
    console.log(`  total entries: ${entries.length}; entries under node_modules: ${entries.filter((entry) => entry.startsWith("/node_modules/")).length}`);
    for (const name of ["main.js", "preload.js"]) {
      const inside = `.vite/build/${name}`;
      const index = entries.indexOf(`/${inside}`);
      if (index < 0) continue;
      const text = asar.extractFile(archive, rawEntries[index].replace(/^[\\/]/u, "")).toString("utf8");
      unexpected.push(...reportSource(`  asar copy of ${inside}`, text, Buffer.byteLength(text)));
    }
  }

  console.log(`\nunexpected bare specifiers: ${unexpected.length}`);
  process.exitCode = unexpected.length === 0 ? 0 : 1;
};

module.exports = { findBareSpecifiers };

if (require.main === module) run();
