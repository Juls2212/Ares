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
    expect(detector).toContain("dependencies.onRms?.(measuredLevel)");
    expect(detector).toContain("smoothedLevel");
    expect(detector).toContain("Math.min(1, Math.max(0");
    expect(detector).not.toContain("console.");
    expect(detector).not.toContain("window.ares");
    // The raw level goes to the orb's amplitude source; it never becomes React state again.
    expect(app).toContain("orbAmplitudeSource.pushMicRms(rms)");
    expect(app).not.toContain("setVoiceLevel");
    expect(app).not.toContain("voiceLevel");
    expect(app).toContain("orbAmplitudeSource.reset()");
    expect(app).toContain('if (voiceState !== "RECORDING") orbAmplitudeSource.reset();');
    expect(app).toContain("onProcessing: () => { detector.dispose(); orbAmplitudeSource.reset();");
    expect(app).toContain("onCancelled: () => { detector.dispose(); orbAmplitudeSource.reset();");
    expect(app).toContain("onAudio: (recording, recordingMimeType, durationMs) => { detector.dispose(); orbAmplitudeSource.reset();");
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
    expect(protectedSources).not.toContain("onRms");
    expect(protectedSources).not.toContain("orbAmplitude");
    expect(protectedSources).not.toContain("AnalyserNode");
    expect(protectedSources).not.toContain("createAnalyser");
  });
});
