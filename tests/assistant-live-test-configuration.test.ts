import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readProjectFile = (fileName: string): string =>
  readFileSync(resolve(process.cwd(), fileName), "utf8");

describe("live assistant diagnostic isolation", () => {
  it("excludes the paid suite from normal discovery and requires an explicit flag", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts: Record<string, string>;
    };
    const liveConfig = readProjectFile("vitest.assistant-live.config.ts");

    expect(liveConfig).toContain('include: ["manual-tests/assistant-live-diagnostic.live.ts"]');
    expect(packageJson.scripts.test).toBe("vitest run --exclude manual-tests/**");
    expect(packageJson.scripts["test:assistant:live"]).toContain("ARES_LIVE_ASSISTANT_CHECK");
    expect(packageJson.scripts["test:assistant:live"]).toContain("vitest run --config vitest.assistant-live.config.ts");
  });
});
