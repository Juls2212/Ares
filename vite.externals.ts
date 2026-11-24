import { builtinModules } from "node:module";

/**
 * Single source of truth for what the Main and preload bundles leave as a bare require at runtime.
 *
 * The packaged app (asar) contains no node_modules, so every package the process needs must be bundled.
 * Only two groups stay external:
 *   1. Node built-ins, with and without the "node:" prefix.
 *   2. "electron", which is provided by the runtime.
 *
 * Optional modules that a dependency references but that are absent on purpose (pg-native, pg-cloudflare) are NOT
 * external: they are replaced by in-bundle stubs, see vite.stubs.ts.
 */
export const NODE_BUILTIN_EXTERNALS: readonly string[] = builtinModules.flatMap((name) => [name, `node:${name}`]);

export const RUNTIME_EXTERNALS: readonly string[] = ["electron"];

export const ARES_EXTERNALS: string[] = [...NODE_BUILTIN_EXTERNALS, ...RUNTIME_EXTERNALS];
