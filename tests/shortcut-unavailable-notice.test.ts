import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("global shortcut registration failure notice", () => {
  const app = readFileSync("src/renderer/app/App.tsx", "utf8");

  it("shows a controlled Spanish notice in the interface when the shortcut is unavailable", () => {
    expect(app).toContain('result.data.effectiveStatus === "UNAVAILABLE"');
    expect(app).toContain("El atajo global no está disponible. Puedes usar el orbe.");
  });

  it("emits the notice as one guarded message", () => {
    expect(app).toContain('if (result.data.effectiveStatus === "UNAVAILABLE") setVoiceMessage("El atajo global no está disponible. Puedes usar el orbe.");');
  });
});
