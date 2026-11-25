import { createRequire } from "node:module";
import type { Plugin } from "vite";

/**
 * Optional modules that `pg` references but that must not exist in the packaged app.
 *
 * Marking them external does not work: the CommonJS interop hoists every require() of an external module to the
 * top of main.js, so the bundle would require them at startup and the asar (which has no node_modules) cannot
 * resolve them. Instead each one is replaced by a tiny in-bundle module.
 *
 * How pg uses them (pg 8.x, read from its own source):
 *   - "pg-cloudflare": required only inside getCloudflareStreamFuncs(), which runs only when isCloudflareRuntime()
 *     is true. That never holds in Electron (there is a real net.Socket and no Workers navigator/Response.cf), so
 *     the module is never read. An empty export is therefore exactly equivalent to the module being absent.
 *   - "pg-native": required by pg/lib/native/client.js, which pg loads only (a) from the lazy `pg.native` getter,
 *     inside a try/catch that treats MODULE_NOT_FOUND as "native not installed", or (b) when NODE_PG_FORCE_NATIVE
 *     is set. Ares uses neither, so the JavaScript client is always used. The stub is a constructor that throws a
 *     MODULE_NOT_FOUND error when it is instantiated, which is the same error an absent module would raise the
 *     moment native support is actually used. It must NOT throw while the bundle is being evaluated: the module
 *     body runs at startup, and pg only reaches for native later.
 */
export const STUBBED_OPTIONAL_MODULES = ["pg-native", "pg-cloudflare"] as const;

const STUB_PREFIX = "\0ares-optional-stub:";

const PG_NATIVE_STUB = `
// Stand-in for the optional "pg-native" package. Evaluating this module has no effect.
// Using it (the only way is explicit native support) fails like a missing module would.
export default function PgNativeUnavailable() {
  const error = new Error("Cannot find module 'pg-native': native PostgreSQL support is not included in the packaged app.");
  error.code = "MODULE_NOT_FOUND";
  throw error;
}
`;

const EMPTY_STUB = `
// Stand-in for an optional package that is never reached at runtime in Electron.
export default {};
`;

export const getOptionalModuleStubSource = (name: string): string | undefined => {
  if (name === "pg-native") return PG_NATIVE_STUB;
  if (name === "pg-cloudflare") return EMPTY_STUB;
  return undefined;
};

/** Vite/Rollup plugin: resolves the optional modules above to virtual in-bundle stubs. */
export const optionalModuleStubs = (): Plugin => ({
  name: "ares:optional-module-stubs",
  enforce: "pre",
  resolveId(source) {
    return (STUBBED_OPTIONAL_MODULES as readonly string[]).includes(source) ? `${STUB_PREFIX}${source}` : undefined;
  },
  load(id) {
    if (!id.startsWith(STUB_PREFIX)) return undefined;
    return getOptionalModuleStubSource(id.slice(STUB_PREFIX.length));
  }
});

const nodeRequire = createRequire(import.meta.url);

/**
 * Resolves "@electric-sql/pglite" (also when drizzle-orm imports it) to the package's CommonJS build.
 *
 * Main is bundled as CommonJS. The package's CommonJS entry is the one it ships for Node CommonJS consumers, so it
 * cannot contain top-level await or an ESM-only construct that a CommonJS bundle would reject. Its three data files
 * (pglite.wasm, initdb.wasm, pglite.data) are not bundled: they are supplied explicitly at runtime, see
 * src/main/database/pglite-assets.mjs.
 */
export const pgliteCommonJsEntry = (): Plugin => ({
  name: "ares:pglite-commonjs-entry",
  enforce: "pre",
  resolveId(source) {
    return source === "@electric-sql/pglite" ? nodeRequire.resolve("@electric-sql/pglite") : undefined;
  }
});
