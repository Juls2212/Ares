"use strict";
/*
 * Opens PGlite WITHOUT Electron and without any network, applies every shipped migration, inserts and reads one
 * row of a harmless table, then deletes its temporary directory.
 *
 * The assets are loaded by the very helper that Main uses (src/main/database/pglite-assets.mjs).
 *
 *   node scripts/smoke-pglite.cjs                       development layout (node_modules + ./drizzle)
 *   node scripts/smoke-pglite.cjs --resources <folder>  packaged layout: <folder> holds drizzle/ and the PGlite files
 *
 * The temporary directory is created outside the repository. Output uses repository-relative names only.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const run = async () => {
  const root = process.cwd();
  const flag = process.argv.indexOf("--resources");
  const resources = flag > 0 ? path.resolve(root, process.argv[flag + 1] ?? "") : undefined;
  const label = resources ? `packaged layout (${path.relative(root, resources).split(path.sep).join("/")})` : "development layout";
  console.log(`pglite smoke: ${label}`);

  let step = "load helper";
  let temporary;
  let client;
  try {
    const helper = await import(pathToFileURL(path.join(root, "src", "main", "database", "pglite-assets.mjs")).href);
    const locations = resources
      ? { isPackaged: true, resourcesPath: resources, appPath: root }
      : { isPackaged: false, resourcesPath: root, appPath: root };

    step = "create temporary directory";
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ares-pglite-smoke-"));
    if (path.resolve(temporary).startsWith(path.resolve(root))) throw new Error("temporary directory is inside the repository");

    step = "open PGlite with explicit assets";
    const { PGlite } = require("@electric-sql/pglite");
    client = helper.createPgliteInstance(PGlite, {
      dataDirectory: helper.resolvePgliteDataDirectory(temporary),
      assetDirectory: helper.resolvePgliteAssetDirectory(locations)
    });
    await client.waitReady;

    step = "run migrations";
    const { drizzle } = require("drizzle-orm/pglite");
    const { migrate } = require("drizzle-orm/pglite/migrator");
    await migrate(drizzle({ client }), { migrationsFolder: helper.resolveMigrationsDirectory(locations) });

    step = "insert and select";
    await client.query("INSERT INTO categories (name) VALUES ($1)", ["smoke"]);
    const result = await client.query("SELECT name FROM categories WHERE name = $1", ["smoke"]);
    if (result.rows.length !== 1 || result.rows[0].name !== "smoke") throw new Error("unexpected select result");

    step = "close";
    await client.close();
    client = undefined;
    console.log("pglite smoke: ok");
    return 0;
  } catch (error) {
    console.log(`pglite smoke: FAILED at step "${step}": ${String(error && error.message).split("\n")[0].replace(/[A-Za-z]:[\\/][^\s'"]*/gu, "<path>").slice(0, 200)}`);
    return 1;
  } finally {
    try { if (client) await client.close(); } catch { /* already failing */ }
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
};

run().then((code) => process.exit(code));
