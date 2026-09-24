import { defineConfig } from "vitest/config";

/** This config is reachable only through the explicit live-assistant script. */
export default defineConfig({
  test: {
    include: ["manual-tests/assistant-live-diagnostic.live.ts"]
  }
});
