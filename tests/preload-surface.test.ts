import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/shared/contracts";

const preloadSource = readFileSync(
  path.resolve(process.cwd(), "src/preload/preload.ts"),
  "utf8"
);

describe("preload surface", () => {
  it("uses only explicit system channels", () => {
    expect(IPC_CHANNELS).toEqual({
      system: {
        getStatus: "system:get-status",
        getCapabilities: "system:get-capabilities"
      }
    });
  });

  it("does not expose generic IPC or Node capabilities", () => {
    expect(preloadSource).toContain('contextBridge.exposeInMainWorld("ares", aresApi)');
    expect(preloadSource).not.toMatch(/\b(?:send|invoke)\s*:/);
    expect(preloadSource).not.toMatch(/\b(?:fs|path|shell|child_process|process\.env)\b/);
    expect(preloadSource).not.toContain('exposeInMainWorld("ares", ipcRenderer)');
  });
});
