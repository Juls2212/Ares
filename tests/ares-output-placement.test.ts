import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string): string => readFileSync(file, "utf8");

describe("Ares assistant output placement", () => {
  it("keeps the command dock limited to voice and text input controls", () => {
    const view = source("src/renderer/views/ares-view.tsx");
    const dockStart = view.indexOf('className="command-input-area command-entry-zone command-dock"');
    const review = view.indexOf("<InterpretationResult");
    const dock = view.slice(dockStart, review);

    expect(dockStart).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(dockStart);
    expect(dock).toContain("VoiceCommandControls");
    expect(dock).toContain("command-entry-form");
    expect(dock).not.toContain("InterpretationResult");
    expect(dock).not.toContain("ResponseSpeechControls");
    expect(dock).not.toContain("Proponer acción");
  });

  it("keeps final text in the neural core and playback controls beside that core", () => {
    const view = source("src/renderer/views/ares-view.tsx");
    const controls = source("src/renderer/features/voice/response-speech-controls.tsx");

    expect(view).toContain("responseText={visibleCoreResponse}");
    expect(view).toContain('className="command-instrument__speech"');
    expect(view).toContain("<ResponseSpeechControls");
    expect(controls).toContain("Detener voz");
    expect(controls).not.toContain("speechSynthesis");
  });

  it("keeps listening, processing, playback, completion, and failure visually exclusive", () => {
    const view = source("src/renderer/views/ares-view.tsx");

    expect(view).toContain('voiceState === "RECORDING"\n    ? "LISTENING"');
    expect(view).toContain('voiceState === "PROCESSING" || isInterpreting\n      ? "PROCESSING"');
    expect(view).toContain('const visibleCoreResponse = responsePhase ? coreResponseText : "";');
    expect(view).toContain("responseText={visibleCoreResponse}");
    expect(view).toContain("const handleStartRecording");
    expect(view).toContain("const handleInterpret");
    expect(view).toContain("clearCoreForNewInteraction();");
  });

  it("retains explicit confirmation callbacks for reinforced actions without a generic execution surface", () => {
    const review = source("src/renderer/features/assistant/interpretation-result.tsx");

    expect(review).toContain('onResolveConfirmation(index, state.confirmation!, "CONFIRM")');
    expect(review).toContain('onResolveConfirmation(confirmationEntry.index, confirmationEntry.state.confirmation, "CANCEL")');
    expect(review).not.toContain("executeAction");
    expect(review).not.toContain("ipcRenderer");
  });
});
