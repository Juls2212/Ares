import { describe, expect, it, vi } from "vitest";

import { createManualVoiceRecorder } from "../src/renderer/features/voice/manual-voice-recorder";

const setup = () => {
  let recorder: { state: "inactive" | "recording" | "paused"; mimeType: string; ondataavailable: ((event: BlobEvent) => unknown) | null; onstop: ((event: Event) => unknown) | null; start: () => void; stop: () => void } | undefined;
  const onAudio = vi.fn();
  const onCancelled = vi.fn();
  const trackStop = vi.fn();
  const voice = createManualVoiceRecorder({
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] })),
    createRecorder: vi.fn(() => recorder = { state: "inactive", mimeType: "audio/webm", ondataavailable: null, onstop: null, start: () => { recorder!.state = "recording"; }, stop: () => { recorder!.state = "inactive"; recorder!.onstop?.(new Event("stop")); } }),
    isMimeTypeSupported: (mime) => mime === "audio/webm",
    createBlob: (parts, options) => new Blob(parts, options),
    setTimer: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
    clearTimer: vi.fn(),
    onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: vi.fn(), onCancelled, onAudio
  });
  return { voice, get recorder() { return recorder; }, onAudio, onCancelled, trackStop };
};

describe("manual browser voice capture", () => {
  it("records only after explicit start, then hands bounded audio to its callback", async () => {
    const fixture = setup();
    await fixture.voice.start();
    fixture.recorder?.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
    fixture.voice.stop();
    expect(fixture.onAudio).toHaveBeenCalledOnce();
    expect(fixture.trackStop).toHaveBeenCalledOnce();
  });

  it("cancels locally without calling the transcription callback", async () => {
    const fixture = setup();
    await fixture.voice.start();
    fixture.recorder?.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
    fixture.voice.cancel();
    expect(fixture.onAudio).not.toHaveBeenCalled();
    expect(fixture.onCancelled).toHaveBeenCalledOnce();
  });

  it("reports permission denial and unsupported capture without recording", async () => {
    const unavailable = vi.fn();
    const denied = createManualVoiceRecorder({
      getUserMedia: vi.fn(async () => { throw new Error("private"); }), createRecorder: vi.fn(), isMimeTypeSupported: () => true,
      createBlob: (parts, options) => new Blob(parts, options), setTimer: vi.fn(), clearTimer: vi.fn(), onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: unavailable, onCancelled: vi.fn(), onAudio: vi.fn()
    });
    await denied.start();
    expect(unavailable).toHaveBeenCalledWith(
      "No se puede usar el micrófono. Revisa los permisos.",
      "MICROPHONE_UNAVAILABLE"
    );

    const unsupported = createManualVoiceRecorder({
      getUserMedia: vi.fn(), createRecorder: vi.fn(), isMimeTypeSupported: () => false,
      createBlob: (parts, options) => new Blob(parts, options), setTimer: vi.fn(), clearTimer: vi.fn(), onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: unavailable, onCancelled: vi.fn(), onAudio: vi.fn()
    });
    await unsupported.start();
    expect(unavailable).toHaveBeenCalledWith("Este navegador no puede grabar audio compatible.");
  });

  it("marks a rejected shortcut-origin capture as gesture-limited only after an actual media failure", async () => {
    const unavailable = vi.fn();
    const denied = createManualVoiceRecorder({
      getUserMedia: vi.fn(async () => { throw { name: "NotAllowedError" }; }), createRecorder: vi.fn(), isMimeTypeSupported: () => true,
      createBlob: (parts, options) => new Blob(parts, options), setTimer: vi.fn(), clearTimer: vi.fn(), onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: unavailable, onCancelled: vi.fn(), onAudio: vi.fn(),
      isUserActivationActive: () => false
    });
    await denied.start();
    expect(unavailable).toHaveBeenCalledWith(
      "No se puede usar el micrófono. Revisa los permisos.",
      "USER_GESTURE_REQUIRED"
    );
  });
});
