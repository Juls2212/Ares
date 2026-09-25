import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  path.resolve(process.cwd(), "src/renderer/App.tsx"),
  "utf8"
);

describe("temporary renderer messaging", () => {
  it("uses only the closed catalog registration flow and never renders an executable-path field", () => {
    expect(appSource).toContain("window.ares.applications.registerCatalogApplication({");
    expect(appSource).toContain('application: selectedCatalogApplication');
    expect(appSource).not.toContain("window.ares.applications.register({");
    expect(appSource).not.toContain("executablePath");
    expect(appSource).not.toContain("registerChrome");
    expect(appSource).toContain("window.ares.applications.registerCustomApplication({");
    expect(appSource).toContain("displayName: customDisplayName");
  });

  it("uses Spanish loading, success, and controlled error messages", () => {
    expect(appSource).toContain("Consultando estado técnico...");
    expect(appSource).toContain("La comunicación segura está en funcionamiento.");
    expect(appSource).toContain("No se pudo consultar el estado técnico de Ares.");
    expect(appSource).toContain('"disponible"');
  });

  it("keeps interpretation, proposal, and confirmation as separate explicit technical steps", () => {
    expect(appSource).toContain('window.ares.assistant.interpret({ text: instruction })');
    expect(appSource).toContain('onClick={() => void propose(index, draft)}');
    expect(appSource).toContain('resolveConfirmation(index, state.confirmation!, "CONFIRM")');
    expect(appSource).toContain('resolveConfirmation(index, state.confirmation!, "CANCEL")');
    expect(appSource).not.toContain("window.ares.assistant.execute");
    expect(appSource).not.toContain("window.ares.browser");
    expect(appSource).not.toContain("window.ares.web");
    const interpretationFlow = appSource.slice(
      appSource.indexOf("const interpret ="),
      appSource.indexOf("const propose =")
    );
    expect(interpretationFlow).not.toContain("window.ares.actions.propose");
    expect(appSource).toContain("interpretation.drafts.map((draft, index)");
    expect(appSource).not.toContain("interpretation.drafts.sort(");
    expect(appSource).toContain("result.error.userMessage");
    expect(appSource).toContain("interpretation.clarifications.map");
  });
});
