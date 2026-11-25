import type { RuntimeLocations } from "./pglite-assets.mjs";

export type ConfiguredRuntimeLocations = RuntimeLocations & { userDataPath: string };

let configured: ConfiguredRuntimeLocations | undefined;

/** Called once by Main at startup, before any database access. Nothing here comes from the renderer. */
export const configureRuntimeLocations = (locations: ConfiguredRuntimeLocations): void => {
  configured = locations;
};

export const getRuntimeLocations = (): ConfiguredRuntimeLocations => {
  if (!configured) throw new Error("Runtime locations are not configured.");
  return configured;
};
