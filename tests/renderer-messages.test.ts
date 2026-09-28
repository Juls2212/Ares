import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  path.resolve(process.cwd(), "src/renderer/App.tsx"),
  "utf8"
);

describe("temporary renderer messaging", () => {
  it("uses only the input-free Chrome registration flow and never renders an executable-path field", () => {
    expect(appSource).toContain("window.ares.applications.registerChrome()");
    expect(appSource).not.toContain("window.ares.applications.register({");
    expect(appSource).not.toContain("executablePath");
  });

  it("renders the real planner rails with Spanish loading, empty, and controlled error states", () => {
    for (const text of [
      "Resumen de hoy",
      "Ares es tu centro personal de productividad para organizar lo importante.",
      "Cargando tu resumen de hoy…",
      "No se pudo cargar el resumen de hoy.",
      "Próximos eventos",
      "Cargando próximos eventos…",
      "No se pudieron cargar los eventos próximos.",
      "No tienes eventos próximos."
    ]) expect(appSource).toContain(text);
    expect(appSource).toContain("window.ares.planner.schedule.getToday({ includeCompletedTasks: true })");
    expect(appSource).toContain("window.ares.planner.events.list({ startAt: now.toISOString() })");
    expect(appSource).not.toContain("window.ares.dashboard.getTodaySummary");
  });

  it("renders a local clock that updates without a renderer API", () => {
    expect(appSource).toContain('aria-label="Hora local"');
    expect(appSource).toContain("window.setInterval(updateClock, 60_000)");
    expect(appSource).toContain("window.clearInterval(intervalId)");
    expect(appSource).not.toContain("window.ares.system.getTime");
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
