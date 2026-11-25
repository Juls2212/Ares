export type RuntimeLocations = { isPackaged: boolean; resourcesPath: string; appPath: string };

export declare const PGLITE_WASM_FILE: "pglite.wasm";
export declare const PGLITE_INITDB_WASM_FILE: "initdb.wasm";
export declare const PGLITE_DATA_FILE: "pglite.data";
export declare const PGLITE_ASSET_FILES: readonly string[];
export declare const MIGRATIONS_FOLDER_NAME: "drizzle";
export declare const DATABASE_FOLDER_NAME: "database";

export declare const resolvePgliteAssetDirectory: (locations: RuntimeLocations) => string;
export declare const resolveMigrationsDirectory: (locations: RuntimeLocations) => string;
export declare const resolvePgliteDataDirectory: (userDataPath: string) => string;
export declare const readPgliteAssets: (assetDirectory: string) => {
  pgliteWasmModule: WebAssembly.Module;
  initdbWasmModule: WebAssembly.Module;
  fsBundle: Blob;
};
export declare const createPgliteInstance: <T>(
  PGlite: new (dataDirectory: string, options: ReturnType<typeof readPgliteAssets>) => T,
  locations: { dataDirectory: string; assetDirectory: string }
) => T;
