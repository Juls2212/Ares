import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(
  path.resolve(process.cwd(), "src/main/main.ts"),
  "utf8"
);

const rendererConfigSource = readFileSync(
  path.resolve(process.cwd(), "vite.renderer.config.ts"),
  "utf8"
);

describe("Electron security baseline", () => {
  it("preserves renderer isolation and deny-by-default window protections", () => {
    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(mainSource).toContain("sandbox: true");
    expect(mainSource).toContain("webSecurity: true");
    expect(mainSource).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(mainSource).toContain('webContents.on("will-navigate"');
    expect(mainSource).toContain('webContents.on("will-redirect"');
    expect(mainSource).toContain("setPermissionCheckHandler");
    expect(mainSource).toContain("setPermissionRequestHandler");
    expect(mainSource).toContain('permission === "media"');
    expect(mainSource).toContain("isTrustedAudioMicrophoneRequest");
    expect(mainSource).toContain("voicePreferencesService.initialize()");
    expect(mainSource).toContain("globalVoiceShortcutLifecycle.stop()");
    expect(mainSource.indexOf("voicePreferencesService.initialize()")).toBeLessThan(
      mainSource.indexOf("await createMainWindow()")
    );
  });

  it("defines a restrictive environment-aware CSP without unsafe eval", () => {
    expect(rendererConfigSource).toContain("default-src 'self'");
    expect(rendererConfigSource).toContain("const scriptSources = isDevelopment");
    expect(rendererConfigSource).toContain("script-src ${scriptSources}");
    expect(rendererConfigSource).toContain("object-src 'none'");
    expect(rendererConfigSource).toContain("base-uri 'self'");
    expect(rendererConfigSource).toContain("frame-src 'none'");
    expect(rendererConfigSource).toContain('"Content-Security-Policy"');
    expect(rendererConfigSource).not.toContain("unsafe-eval");
    expect(rendererConfigSource).not.toContain("connect-src *");
  });
});
