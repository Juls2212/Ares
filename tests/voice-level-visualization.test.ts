import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("renderer-only voice level visualization", () => {
  it("reuses the active silence analyser and resets the transient level across recorder exits", () => {
    const app = source("src/renderer/app/App.tsx");
    const detector = source("src/renderer/features/voice/speech-end-detector.ts");
    const cancellation = source("src/renderer/features/voice/recording-cancellation.ts");

    expect(detector).toContain("dependencies.onLevel?.");
    expect(detector).toContain("smoothedLevel");
    expect(detector).toContain("Math.min(1, Math.max(0");
    expect(detector).not.toContain("console.");
    expect(detector).not.toContain("window.ares");
    expect(app).toContain("onLevel: reduceMotion ? undefined");
    expect(app).toContain("setVoiceLevel(0)");
    expect(app).toContain('if (voiceState !== "RECORDING") setVoiceLevel(0);');
    expect(app).toContain("onProcessing: () => { detector.dispose(); setVoiceLevel(0);");
    expect(app).toContain("onCancelled: () => { detector.dispose(); setVoiceLevel(0);");
    expect(app).toContain("onAudio: (recording, recordingMimeType, durationMs) => { detector.dispose(); setVoiceLevel(0);");
    expect(cancellation).not.toContain("addEventListener(\"visibilitychange\"");
    expect(cancellation).toContain('windowTarget.addEventListener("pagehide", cancel)');
  });

  it("keeps visualization level and analyser details out of Main, preload, shared contracts, and IPC", () => {
    const protectedSources = [
      "src/main/main.ts",
      "src/main/ipc/register-voice-ipc.ts",
      "src/preload/preload.ts",
      "src/shared/voice-contracts.ts"
    ].map(source).join("\n");

    expect(protectedSources).not.toContain("voiceLevel");
    expect(protectedSources).not.toContain("onLevel");
    expect(protectedSources).not.toContain("AnalyserNode");
    expect(protectedSources).not.toContain("createAnalyser");
  });
});
