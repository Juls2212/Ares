import { describe, expect, it } from "vitest";

import { readSource } from "./helpers/read-source";

const main = readSource("src/main/main.ts");
const creation = main.slice(main.indexOf("const createMainWindow"), main.indexOf("createdWindow.setAspectRatio(1)"));
const webPreferences = creation.slice(creation.indexOf("webPreferences:"));

describe("BrowserWindow security options", () => {
  it("keeps the four baseline webPreferences", () => {
    expect(webPreferences).toMatch(/contextIsolation:\s*true/u);
    expect(webPreferences).toMatch(/nodeIntegration:\s*false/u);
    expect(webPreferences).toMatch(/sandbox:\s*true/u);
    expect(webPreferences).toMatch(/webSecurity:\s*true/u);
  });

  it("never enables a weakening option anywhere in the main process", () => {
    for (const forbidden of [
      /contextIsolation:\s*false/u,
      /nodeIntegration:\s*true/u,
      /nodeIntegrationInWorker:\s*true/u,
      /nodeIntegrationInSubFrames:\s*true/u,
      /sandbox:\s*false/u,
      /webSecurity:\s*false/u,
      /allowRunningInsecureContent:\s*true/u,
      /enableRemoteModule/u,
      /experimentalFeatures:\s*true/u
    ]) {
      expect(main).not.toMatch(forbidden);
    }
  });

  it("loads only the bundled preload script and denies new windows and foreign navigation", () => {
    expect(webPreferences).toContain('preload: path.join(__dirname, "preload.js")');
    expect(main).toContain('setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(main).toContain('webContents.on("will-navigate"');
    expect(main).toContain("setPermissionCheckHandler");
    expect(main).toContain("setPermissionRequestHandler");
  });

  it("creates exactly one window", () => {
    expect(main.match(/new BrowserWindow\(/gu)).toHaveLength(1);
  });
});
