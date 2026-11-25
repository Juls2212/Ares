import { defineConfig } from "vite";

import { ARES_EXTERNALS } from "./vite.externals";
import { optionalModuleStubs, pgliteCommonJsEntry } from "./vite.stubs";

// Forge merges this with its own defaults (built-ins, electron, electron/main). Every npm dependency is bundled,
// the optional pg modules are replaced by in-bundle stubs and PGlite uses its CommonJS build.
export default defineConfig({
  plugins: [optionalModuleStubs(), pgliteCommonJsEntry()],
  build: {
    rollupOptions: {
      external: ARES_EXTERNALS
    }
  }
});
