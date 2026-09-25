import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rendererSource = [
  "src/renderer/app/App.tsx",
  "src/renderer/app/app-state.ts",
  "src/renderer/views/ares-view.tsx",
  "src/renderer/views/calendar-view.tsx",
  "src/renderer/features/calendar/calendar-data.ts",
  "src/renderer/features/calendar/calendar-grid.tsx",
  "src/renderer/features/assistant/interpretation-result.tsx",
  "src/renderer/features/voice/voice-command-controls.tsx",
  "src/renderer/features/settings/utility-panel.tsx",
  "src/renderer/features/settings/theme-preference.ts",
  "src/renderer/features/settings/use-theme-preference.ts"
].map((sourcePath) => readFileSync(path.resolve(process.cwd(), sourcePath), "utf8")).join("\n");

describe("temporary renderer messaging", () => {
  it("keeps the command surface mounted when an optional voice subscription is unavailable", () => {
    expect(rendererSource).toContain("if (!window.ares?.voice?.onGlobalShortcut) return;");
    expect(rendererSource).toContain("<AresView");
    expect(rendererSource).toContain("<CalendarView />");
  });

  it("keeps exactly Ares and Calendario in primary navigation", () => {
    expect(rendererSource).toContain('aria-label="Navegación principal"');
    expect(rendererSource).toContain('>Ares</button>');
    expect(rendererSource).toContain('>Calendario</button>');
    expect(rendererSource).not.toContain('>Archivos</button>');
    expect(rendererSource).not.toContain('>Aplicaciones</button>');
    expect(rendererSource).not.toContain('>Configuración</button>');
    expect(rendererSource).not.toContain('>Historial</button>');
  });

  it("uses only the closed catalog registration flow and never renders an executable-path field", () => {
    expect(rendererSource).toContain("window.ares.applications.registerCatalogApplication({");
    expect(rendererSource).toContain('application: selectedCatalogApplication');
    expect(rendererSource).not.toContain("window.ares.applications.register({");
    expect(rendererSource).not.toContain("executablePath");
    expect(rendererSource).not.toContain("registerChrome");
    expect(rendererSource).toContain("window.ares.applications.registerCustomApplication({");
    expect(rendererSource).toContain("displayName: customDisplayName");
  });

  it("uses Spanish loading, success, and controlled error messages", () => {
    expect(rendererSource).toContain("Comprobando la conexión segura.");
    expect(rendererSource).toContain("Ares está listo para preparar acciones supervisadas.");
    expect(rendererSource).toContain("No se pudo consultar el estado técnico de Ares.");
    expect(rendererSource).toContain("Atajo activo");
  });

  it("keeps interpretation, proposal, and confirmation as separate explicit technical steps", () => {
    expect(rendererSource).toContain('window.ares.assistant.interpret({ text: instruction })');
    expect(rendererSource).toContain("onPropose(index, draft)");
    expect(rendererSource).toContain('onResolveConfirmation(index, state.confirmation!, "CONFIRM")');
    expect(rendererSource).toContain('onResolveConfirmation(index, state.confirmation!, "CANCEL")');
    expect(rendererSource).not.toContain("window.ares.assistant.execute");
    expect(rendererSource).not.toContain("window.ares.browser");
    expect(rendererSource).not.toContain("window.ares.web");
    const interpretationFlow = rendererSource.slice(
      rendererSource.indexOf("const interpret ="),
      rendererSource.indexOf("const propose =")
    );
    expect(interpretationFlow).not.toContain("window.ares.actions.propose");
    expect(rendererSource).toContain("interpretation.drafts.map((draft, index)");
    expect(rendererSource).not.toContain("interpretation.drafts.sort(");
    expect(rendererSource).toContain("result.error.userMessage");
    expect(rendererSource).toContain("interpretation.clarifications.map");
  });

  it("keeps manual recording and transcription separate from interpretation", () => {
    expect(rendererSource).toContain("Iniciar grabación");
    expect(rendererSource).toContain("Detener grabación");
    expect(rendererSource).toContain("Cancelar grabación");
    expect(rendererSource).toContain("window.ares.voice.transcribe");
    const transcriptionFlow = rendererSource.slice(
      rendererSource.indexOf("const transcribeAudio ="),
      rendererSource.indexOf("const startRecording =")
    );
    expect(transcriptionFlow).not.toContain("window.ares.assistant.interpret");
    expect(transcriptionFlow).not.toContain("window.ares.actions.propose");
  });

  it("subscribes to the fixed voice signal without auto-interpreting or executing", () => {
    expect(rendererSource).toContain("window.ares.voice.onGlobalShortcut(controller.activate)");
    expect(rendererSource).toContain("startRecording: () => { void startRecording(true); }");
    expect(rendererSource).toContain('reason === "USER_GESTURE_REQUIRED"');
    const shortcutFlow = rendererSource.slice(
      rendererSource.indexOf("const controller = createGlobalVoiceShortcutController"),
      rendererSource.indexOf("const interpret =")
    );
    expect(shortcutFlow).not.toContain("window.ares.assistant.interpret");
    expect(shortcutFlow).not.toContain("window.ares.actions.propose");
  });

  it("renders only the approved Spanish voice preference controls", () => {
    expect(rendererSource).toContain("Configuración de voz");
    expect(rendererSource).toContain("Activar atajo global de voz");
    expect(rendererSource).toContain("Guardar configuración");
    expect(rendererSource).toContain("window.ares.settings.voice.get()");
    expect(rendererSource).toContain("window.ares.settings.voice.update({");
    expect(rendererSource).toContain("VOICE_SHORTCUTS.map");
    expect(rendererSource).not.toContain("microphoneDevice");
    expect(rendererSource).not.toContain("window.ares.settings.get");
    expect(rendererSource).not.toContain("window.ares.settings.update");
  });

  it("keeps the appearance control local to the renderer", () => {
    expect(rendererSource).toContain("Activar modo oscuro");
    expect(rendererSource).toContain("Activar modo claro");
    expect(rendererSource).toContain('setAttribute("data-theme", theme)');
    expect(rendererSource).toContain('"ares-theme-preference"');
    expect(rendererSource).not.toContain("window.ares.settings.appearance");
    expect(rendererSource).not.toContain("window.ares.theme");
  });

  it("keeps Spanish command controls and the renderer-only particle orb", () => {
    expect(rendererSource).toContain("Centro de mando personal");
    expect(rendererSource).toContain("Iniciar grabación");
    expect(rendererSource).toContain("Proponer acción");
    expect(rendererSource).toContain("Confirmar");
    expect(rendererSource).toContain("Cancelar");
    expect(rendererSource).toContain("<ParticleOrb");
    expect(rendererSource).not.toContain("window.ares.files");
    expect(rendererSource).not.toContain("window.ares.assistant.execute");
  });

  it("uses truthful Spanish guidance for the current session and supervised sequence", () => {
    expect(rendererSource).toContain("Sesión actual");
    expect(rendererSource).toContain("Texto");
    expect(rendererSource).toContain("Confirmación");
    expect(rendererSource).toContain("Secuencia supervisada");
    expect(rendererSource).toContain("Describe o dicta una intención.");
    expect(rendererSource).toContain("Revisa el borrador preparado.");
    expect(rendererSource).toContain("Confirma solo cuando se requiera.");
    expect(rendererSource).not.toContain("Agenda");
  });

  it("keeps calendar today, selected, hover, and keyboard states in the renderer only", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(rendererSource).toContain('aria-current={day.isoDate === todayDate ? "date" : undefined}');
    expect(rendererSource).toContain('" is-today"');
    expect(styles).toContain(".calendar-day:hover");
    expect(styles).toContain(".calendar-day:focus-visible");
    expect(styles).toContain(".calendar-day.is-selected");
    expect(styles).toContain(".calendar-day.is-today");
  });

  it("uses the local Franklin Gothic stack across the renderer visual system", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");

    expect(styles).toContain('"Franklin Gothic Medium", "Franklin Gothic"');
    expect(styles).toContain("font-family: var(--font-display)");
  });

  it("uses only read-only planner list methods for the calendar", () => {
    expect(rendererSource).toContain("planner.tasks.list");
    expect(rendererSource).toContain("planner.events.list");
    expect(rendererSource).not.toContain("planner.tasks.create");
    expect(rendererSource).not.toContain("planner.tasks.update");
    expect(rendererSource).not.toContain("planner.tasks.complete");
    expect(rendererSource).not.toContain("planner.events.create");
    expect(rendererSource).not.toContain("planner.events.update");
  });
});
