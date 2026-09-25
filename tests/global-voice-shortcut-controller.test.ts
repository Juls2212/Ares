import { describe, expect, it, vi } from "vitest";
import { createGlobalVoiceShortcutController } from "../src/renderer/features/voice/global-voice-shortcut-controller";

describe("renderer global voice shortcut controller", () => {
  it("starts only from idle, stops only while recording, and ignores transcription", () => {
    const startRecording = vi.fn();
    const stopRecording = vi.fn();
    let state: "IDLE" | "RECORDING" | "PROCESSING" = "IDLE";
    const controller = createGlobalVoiceShortcutController({ getState: () => state, startRecording, stopRecording });
    controller.activate();
    state = "RECORDING";
    controller.activate();
    state = "PROCESSING";
    controller.activate();
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });
});
