import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(path.resolve(process.cwd(), "src/renderer/app/App.tsx"), "utf8");
const rendererSource = [
  "src/renderer/app/App.tsx",
  "src/renderer/app/app-state.ts",
  "src/renderer/views/ares-view.tsx",
  "src/renderer/features/assistant/interpretation-result.tsx",
  "src/renderer/orb/orb-canvas.tsx",
  "src/renderer/theme/themes.ts",
  "src/renderer/main.tsx"
].map((sourcePath) => readFileSync(path.resolve(process.cwd(), sourcePath), "utf8")).join("\n");

describe("temporary renderer messaging", () => {
  it("keeps the command surface mounted when an optional voice subscription is unavailable", () => {
    expect(rendererSource).toContain("if (!window.ares?.voice?.onGlobalShortcut) return;");
    expect(rendererSource).toContain("<AresView");
    expect(appSource).not.toContain("CalendarView");
  });

  it("mounts Ares as the sole primary surface without planner navigation", () => {
    expect(appSource).toContain("<AresView");
    expect(appSource).not.toContain('aria-label="Navegación principal"');
    expect(appSource).not.toContain("CalendarView");
    expect(appSource).not.toContain('>Calendario</button>');
    expect(appSource).not.toContain('>Hábitos</button>');
    expect(appSource).not.toContain('>Horario semanal</button>');
  });


  it("does not load planner or habit summaries during normal Ares startup", () => {
    const aresView = readFileSync(path.resolve(process.cwd(), "src/renderer/views/ares-view.tsx"), "utf8");
    expect(aresView).not.toContain("loadAresToday");
    expect(aresView).not.toContain("loadAresHabitSummary");
    expect(aresView).not.toContain("window.ares.planner");
    expect(aresView).not.toContain("window.ares.habits");
  });

  it("keeps interpretation, proposal, and confirmation as separate explicit technical steps", () => {
    expect(rendererSource).toContain('window.ares.assistant.interpret({ text: instruction })');
    // Interpretation never proposes; the voice path proposes through its own explicit step, and confirmation stays separate.
    expect(rendererSource).toContain("onPropose={(index, draft) => void propose(index, draft)}");
    expect(rendererSource).toContain('onResolveConfirmation(index, state.confirmation!, "CONFIRM")');
    expect(rendererSource).toContain('onResolveConfirmation(confirmationEntry.index, confirmationEntry.state.confirmation, "CANCEL")');
    expect(rendererSource).not.toContain("window.ares.assistant.execute");
    expect(rendererSource).not.toContain("window.ares.browser");
    expect(rendererSource).not.toContain("window.ares.web");
    const interpretationFlow = rendererSource.slice(
      rendererSource.indexOf("const submitInstruction ="),
      rendererSource.indexOf("const updateDraftState =")
    );
    expect(interpretationFlow).not.toContain("window.ares.actions.propose");
    expect(rendererSource).toContain("interpretation.drafts.map((draft, index)");
    expect(rendererSource).not.toContain("interpretation.drafts.sort(");
    expect(rendererSource).toContain("result.error.userMessage");
    // A clarification carries no draft and no Main confirmation, so the review dialog can never open for it.
    expect(rendererSource).toContain("hasAssistantReview");
    expect(rendererSource).toContain("confirmation.confirmationId.trim().length > 0");
    expect(rendererSource).toContain("window.ares.actions.propose(draft)");
  });

  it("routes successful voice input into the shared submission path without confirming actions", () => {
    expect(rendererSource).toContain("Te escucho…");
    expect(rendererSource).not.toContain("Detener y transcribir");
    expect(rendererSource).toContain(">Cancelar</button>");
    expect(rendererSource).toContain("createSpeechEndDetector");
    expect(rendererSource).toContain("maximumDurationMs: LIVE_RECORDING_LIMIT_MS");
    expect(rendererSource).toContain("window.ares.voice.transcribe");
    const transcriptionFlow = rendererSource.slice(
      rendererSource.indexOf("const transcribeAudio ="),
      rendererSource.indexOf("const startRecording =")
    );
    expect(transcriptionFlow).not.toContain("window.ares.assistant.interpret");
    expect(transcriptionFlow).not.toContain("window.ares.actions.propose");
    expect(transcriptionFlow).toContain("voiceSubmission.current.submit");
    expect(transcriptionFlow).toContain("submitInstruction(text, true");
  });

  it("subscribes to the fixed voice signal without auto-interpreting or executing", () => {
    expect(rendererSource).toContain("window.ares.voice.onGlobalShortcut(controller.activate)");
    expect(rendererSource).toContain("startRecording: () => { void startRecording(true); }");
    expect(rendererSource).toContain('reason === "USER_GESTURE_REQUIRED"');
    const shortcutFlow = rendererSource.slice(
      rendererSource.indexOf("const controller = createGlobalVoiceShortcutController"),
      rendererSource.indexOf("const submitInstruction =")
    );
    expect(shortcutFlow).not.toContain("window.ares.assistant.interpret");
    expect(shortcutFlow).not.toContain("window.ares.actions.propose");
  });


  it("keeps the appearance local to the renderer: it follows prefers-color-scheme and has no color button", () => {
    expect(rendererSource).toContain('"(prefers-color-scheme: dark)"');
    expect(rendererSource).toContain('setAttribute("data-theme", name)');
    expect(rendererSource).not.toContain("Cambiar color");
    expect(rendererSource).not.toContain("localStorage");
    expect(rendererSource).not.toContain("window.ares.settings.appearance");
    // The one theme method is the toggle button's closed setter; there is no getter.
    expect(rendererSource.match(/window\.ares\.theme\.\w+/gu)).toEqual(["window.ares.theme.setPreference"]);
  });

  it("keeps Spanish command controls and the renderer-only canvas orb", () => {
    expect(rendererSource).toContain("Hablar con Ares");
    expect(rendererSource).not.toContain("Proponer acción");
    expect(rendererSource).toContain("Confirmar");
    expect(rendererSource).toContain("Cancelar");
    expect(rendererSource).toContain("<OrbCanvas");
    expect(rendererSource).not.toContain("window.ares.files");
    expect(rendererSource).not.toContain("window.ares.assistant.execute");
  });

  it("keeps the command entry in the sole mounted Ares workspace", () => {
    const aresView = readFileSync(path.resolve(process.cwd(), "src/renderer/views/ares-view.tsx"), "utf8");

    // The orb is the only visible control; the dock and heading of the former workspace are not mounted.
    expect(aresView).not.toContain("command-heading");
    expect(aresView).not.toContain("<VoiceCommandControls");
    expect(aresView.indexOf("hud__stage")).toBeLessThan(aresView.indexOf("<InterpretationResult"));
    expect(aresView).toContain("<OrbCanvas");
    expect(aresView).not.toContain("command-instrument__axis");
    expect(aresView).not.toContain("command-instrument__anchor");
    expect(aresView).toContain("<InterpretationResult");
    expect(aresView).toContain("<ResponseSpeechControls");
  });


  it("keeps calendar source unmounted while preserving assistant action entry points", () => {
    expect(appSource).not.toContain("CalendarView");
    expect(rendererSource).toContain("window.ares.assistant.interpret({ text: instruction })");
    expect(rendererSource).toContain("window.ares.actions.confirm(confirmation.confirmationId)");
  });
});
