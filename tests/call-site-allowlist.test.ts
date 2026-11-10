import { describe, expect, it } from "vitest";

import { listSourceFiles, readSource } from "./helpers/read-source";

/**
 * The exact set of source files allowed to use each dangerous capability. The current set is the allowlist: a new
 * file using any of them fails here and needs a deliberate edit (and a security review) in this test.
 */
type Entry = { file: string; purpose: string };

const ALLOWLIST: Record<string, { pattern: RegExp; allowed: Entry[] }> = {
  "shell.openExternal": {
    pattern: /shell\.openExternal\(/u,
    allowed: [
      { file: "src/main/actions/approved-web-action-executor.ts", purpose: "opens one closed-catalog approved site or search URL built in Main" },
      { file: "src/main/applications/catalog-application-adapter.ts", purpose: "fixed protocol strategies for catalog apps (and the spotify: search URI)" },
      { file: "src/main/messaging/whatsapp-chat-launcher.ts", purpose: "the only messaging launcher: whatsapp:// then wa.me after a confirmed review" },
      { file: "src/main/spotify/spotify-authorize-launcher.ts", purpose: "opens the Spotify authorization page for the PKCE connection" }
    ]
  },
  "shell.openPath": {
    pattern: /shell\.openPath\(/u,
    allowed: [
      { file: "src/main/files/supervised-file-composition.ts", purpose: "binds the shell for the supervised file service" },
      { file: "src/main/files/supervised-file-service.ts", purpose: "opens one confirmed found file" }
    ]
  },
  "shell.showItemInFolder": {
    pattern: /shell\.showItemInFolder\(/u,
    allowed: [
      { file: "src/main/files/supervised-file-composition.ts", purpose: "binds the shell for the supervised file service" },
      { file: "src/main/files/supervised-file-service.ts", purpose: "reveals one found file in its folder" }
    ]
  },
  "shell.trashItem": {
    pattern: /shell\.trashItem\(/u,
    allowed: [
      { file: "src/main/files/supervised-file-composition.ts", purpose: "binds the shell for the supervised file service" },
      { file: "src/main/files/supervised-file-service.ts", purpose: "sends one confirmed found item to the Recycle Bin (the only deletion path)" }
    ]
  },
  child_process: {
    pattern: /from "node:child_process"|require\("child_process"\)/u,
    allowed: [
      { file: "src/main/applications/application-launcher.ts", purpose: "launches a registered application executable without a shell" },
      { file: "src/main/applications/catalog-application-adapter.ts", purpose: "launches a catalog application target without a shell" }
    ]
  },
  "fetch(": {
    pattern: /\bfetch\(/u,
    allowed: [
      { file: "src/main/spotify/spotify-api-client.ts", purpose: "the only Spotify Web API client" },
      { file: "src/main/weather/weather-service.ts", purpose: "legacy weather lookup (unregistered; scheduled for removal)" }
    ]
  },
  "http server": {
    pattern: /createServer\(/u,
    allowed: [{ file: "src/main/spotify/spotify-loopback-server.ts", purpose: "loopback redirect receiver for the Spotify PKCE flow on 127.0.0.1" }]
  },
  safeStorage: {
    pattern: /safeStorage/u,
    allowed: [
      { file: "src/main/spotify/spotify-composition.ts", purpose: "wires safeStorage into the Spotify token store" },
      { file: "src/main/spotify/spotify-token-store.ts", purpose: "encrypts and decrypts the Spotify connection tokens" }
    ]
  },
  "fs deletion": {
    pattern: /\b(?:rm|unlink|rmdir|rmSync|unlinkSync|rmdirSync)\b\s*\(|\bfs\.(?:promises\.)?(?:rm|unlink|rmdir)\b/u,
    allowed: []
  },
  "process.env": {
    pattern: /process\.env/u,
    allowed: [
      { file: "src/main/assistant/assistant-interpreter.ts", purpose: "NODE_ENV check for a development-only diagnostic" },
      { file: "src/main/config/database-environment.ts", purpose: "reads the database settings in Main" },
      { file: "src/main/config/openai-environment.ts", purpose: "reads the OpenAI settings in Main" },
      { file: "src/main/spotify/spotify-config.ts", purpose: "reads the public Spotify client id in Main" }
    ]
  },
  "new BrowserWindow": {
    pattern: /new BrowserWindow\(/u,
    allowed: [{ file: "src/main/main.ts", purpose: "the one compact application window" }]
  }
};

const sourceFiles = listSourceFiles("src");

describe("call-site allowlist", () => {
  for (const [name, { pattern, allowed }] of Object.entries(ALLOWLIST)) {
    it(`${name} is used only by the allowed files`, () => {
      const actual = sourceFiles.filter((file) => pattern.test(readSource(file)));
      expect(actual).toEqual(allowed.map((entry) => entry.file).sort());
    });
  }

  it("keeps every allowlist entry documented with a purpose", () => {
    for (const { allowed } of Object.values(ALLOWLIST)) for (const entry of allowed) expect(entry.purpose.length).toBeGreaterThan(10);
  });

  it("never lets the renderer or the preload touch any of these capabilities", () => {
    for (const file of sourceFiles.filter((entry) => entry.startsWith("src/renderer/") || entry.startsWith("src/preload/"))) {
      const text = readSource(file);
      for (const [name, { pattern }] of Object.entries(ALLOWLIST)) {
        if (name === "fetch(" && file.startsWith("src/renderer/")) continue; // the renderer plays audio from Main-issued data, checked below
        expect(pattern.test(text), `${name} in ${file}`).toBe(false);
      }
    }
  });

  it("does not use fetch in the renderer", () => {
    for (const file of sourceFiles.filter((entry) => entry.startsWith("src/renderer/"))) {
      expect(readSource(file), file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket\(/u);
    }
  });
});
