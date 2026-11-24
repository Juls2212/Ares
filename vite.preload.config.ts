import { defineConfig } from "vite";

import { ARES_EXTERNALS } from "./vite.externals";

export default defineConfig({
  build: {
    rollupOptions: {
      external: ARES_EXTERNALS
    }
  }
});
