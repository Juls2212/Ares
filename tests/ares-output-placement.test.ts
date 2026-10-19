import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string): string => readFileSync(file, "utf8");

describe("Ares assistant output placement", () => {
  it("keeps the compact shell voice-only without a command dock or typed entry", () => {
    const view = source("src/renderer/views/ares-view.tsx");
    const controlsStart = view.indexOf("<ParticleOrb");
    const review = view.indexOf("<InterpretationResult");
    const controls = view.slice(controlsStart, review);

    expect(controlsStart).toBeGreaterThan(-1);
    expect(review).toBeGreaterThan(controlsStart);
    expect(controls).toContain("onActivate={orbInteraction.activate}");
    expect(view).not.toContain("VoiceCommandControls");
    expect(view).not.toContain("command-entry-form");
    expect(view).not.toContain("assistant-instruction");
    expect(view).not.toContain("Interpretar");
    expect(controls).not.toContain("InterpretationResult");
  });

  it("keeps one Ares identity in the shell header without a duplicate view heading", () => {
    const view = source("src/renderer/views/ares-view.tsx");
    const app = source("src/renderer/app/App.tsx");

    expect(view).not.toContain("command-heading");
    expect(view).not.toContain("<h1>Ares</h1>");
    expect(app).toContain('className="wordmark">ARES</span>');
  });

  it("keeps final text and Stop interaction in the core with headless playback", () => {
    const view = source("src/renderer/views/ares-view.tsx");
    const controls = source("src/renderer/features/voice/response-speech-controls.tsx");

    expect(view).toContain("responseText={visibleCoreResponse}");
    expect(view).toContain('const coreResponse = spokenResponse?.text ?? "";');
    expect(view).not.toContain("resolvedActionMessage");
    expect(view).not.toContain('className="command-instrument__speech"');
    expect(view).toContain("<ResponseSpeechControls");
    expect(view).toContain("headless onPlaybackEvent");
    expect(view).toContain("stop: () => stopSpeechReference.current?.()");
    expect(controls).toContain("Detener voz");
    expect(controls).not.toContain("speechSynthesis");
  });

  it("keeps listening, processing, playback, completion, and failure visually exclusive", () => {
    const view = source("src/renderer/views/ares-view.tsx");

    expect(view).toContain('voiceState === "RECORDING"\n    ? "LISTENING"');
    expect(view).toContain('voiceState === "PROCESSING" || isInterpreting || isGeneratingSpeech\n      ? "PROCESSING"');
    expect(view).toContain('? "ACTING"');
    expect(view).toContain('exclusiveCoreState === "FAILURE" ? "error"');
    expect(view).toContain('const visibleCoreResponse = responsePhase ? coreResponseText : "";');
    expect(view).toContain("responseText={visibleCoreResponse}");
    expect(view).toContain("const handleStartRecording");
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
