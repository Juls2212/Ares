// Locates and loads the files PGlite needs, and opens it with them supplied explicitly.
//
// Plain ES module with no dependency except Node built-ins, so that the Main process (bundled by Vite) and
// scripts/smoke-pglite.cjs share exactly one implementation.
//
// Why: PGlite normally finds pglite.wasm, initdb.wasm and pglite.data relative to its own module path, which breaks
// once it is bundled into main.js. The constructor accepts them as pgliteWasmModule, initdbWasmModule and fsBundle,
// so they are read from a known directory instead:
//   - packaged app:  process.resourcesPath (Forge extraResource copies the three files there, next to "drizzle")
//   - development:   node_modules/@electric-sql/pglite/dist under the project folder
import fs from "node:fs";
import path from "node:path";

export const PGLITE_WASM_FILE = "pglite.wasm";
export const PGLITE_INITDB_WASM_FILE = "initdb.wasm";
export const PGLITE_DATA_FILE = "pglite.data";
export const PGLITE_ASSET_FILES = [PGLITE_WASM_FILE, PGLITE_INITDB_WASM_FILE, PGLITE_DATA_FILE];
export const MIGRATIONS_FOLDER_NAME = "drizzle";
export const DATABASE_FOLDER_NAME = "database";

/** Directory that holds the three PGlite files. */
export const resolvePgliteAssetDirectory = ({ isPackaged, resourcesPath, appPath }) =>
  isPackaged ? resourcesPath : path.join(appPath, "node_modules", "@electric-sql", "pglite", "dist");

/** Directory that holds the drizzle migrations shipped with the app. */
export const resolveMigrationsDirectory = ({ isPackaged, resourcesPath, appPath }) =>
  path.join(isPackaged ? resourcesPath : appPath, MIGRATIONS_FOLDER_NAME);

/** The PGlite data directory. It is always inside userData; anything else is rejected. */
export const resolvePgliteDataDirectory = (userDataPath) => {
  if (typeof userDataPath !== "string" || userDataPath.trim() === "") throw new Error("The user data directory is not available.");
  const base = path.resolve(userDataPath);
  const target = path.join(base, DATABASE_FOLDER_NAME, "pglite");
  const relation = path.relative(base, target);
  if (relation === "" || relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("The database directory must stay inside the user data directory.");
  return target;
};

/** Reads the three files. WebAssembly modules are compiled synchronously so that opening PGlite can stay synchronous. */
export const readPgliteAssets = (assetDirectory) => {
  const read = (name) => fs.readFileSync(path.join(assetDirectory, name));
  return {
    pgliteWasmModule: new WebAssembly.Module(read(PGLITE_WASM_FILE)),
    initdbWasmModule: new WebAssembly.Module(read(PGLITE_INITDB_WASM_FILE)),
    fsBundle: new Blob([read(PGLITE_DATA_FILE)])
  };
};

/** Opens PGlite persisted in dataDirectory, with its assets supplied explicitly. PGlite is passed in by the caller. */
export const createPgliteInstance = (PGlite, { dataDirectory, assetDirectory }) => {
  // PGlite's file system creates only the last folder level, so the whole path is created first.
  fs.mkdirSync(dataDirectory, { recursive: true });
  return new PGlite(dataDirectory, readPgliteAssets(assetDirectory));
};
