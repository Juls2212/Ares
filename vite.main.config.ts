import { defineConfig } from "vite";

import { ARES_EXTERNALS } from "./vite.externals";
import { optionalModuleStubs } from "./vite.stubs";

// Forge merges this with its own defaults (built-ins, electron, electron/main). Every npm dependency is bundled,
// and the optional pg modules are replaced by in-bundle stubs.
export default defineConfig({
  plugins: [optionalModuleStubs()],
  build: {
    rollupOptions: {
      external: ARES_EXTERNALS
    }
  }
});
