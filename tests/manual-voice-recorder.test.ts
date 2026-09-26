import { describe, expect, it, vi } from "vitest";

import { createManualVoiceRecorder } from "../src/renderer/features/voice/manual-voice-recorder";
import { VOICE_ALLOWED_MIME_TYPES } from "../src/shared/voice-contracts";
import { VoiceCommandControls } from "../src/renderer/features/voice/voice-command-controls";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";

const setup = () => {
  let recorder: { state: "inactive" | "recording" | "paused"; mimeType: string; ondataavailable: ((event: BlobEvent) => unknown) | null; onstop: ((event: Event) => unknown) | null; start: () => void; stop: () => void } | undefined;
  const onAudio = vi.fn();
  const onCancelled = vi.fn();
  const trackStop = vi.fn();
  const timers: (() => void)[] = [];
  const voice = createManualVoiceRecorder({
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] })),
    createRecorder: vi.fn(() => recorder = { state: "inactive", mimeType: "audio/webm", ondataavailable: null, onstop: null, start: () => { recorder!.state = "recording"; }, stop: () => { recorder!.state = "inactive"; recorder!.onstop?.(new Event("stop")); } }),
    isMimeTypeSupported: (mime) => mime === "audio/webm",
    createBlob: (parts, options) => new Blob(parts, options),
    setTimer: vi.fn((callback: () => void) => { timers.push(callback); return 1 as unknown as ReturnType<typeof setTimeout>; }),
    clearTimer: vi.fn(),
    onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: vi.fn(), onCancelled, onAudio
  });
  return { voice, get recorder() { return recorder; }, onAudio, onCancelled, trackStop, timers };
};

describe("manual browser voice capture", () => {
  it("exports the MIME allowlist as a runtime array", () => {
    expect(Array.isArray(VOICE_ALLOWED_MIME_TYPES)).toBe(true);
    expect(VOICE_ALLOWED_MIME_TYPES).toContain("audio/webm");
  });

  it("uses separate native buttons for pointer and keyboard stop versus cancellation", async () => {
    for (const activation of ["mouse", "keyboard"] as const) {
      for (const decision of ["Detener y transcribir", "Cancelar"]) {
        const f = setup(); await f.voice.start();
        f.recorder?.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
        const controls = VoiceCommandControls({ state: "RECORDING", onStart: vi.fn(), onStop: f.voice.stop, onCancel: f.voice.cancel });
        const nodes: ReactElement<any>[] = [];
        const collect = (value: any): void => { if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === "object" && "props" in value) { nodes.push(value); collect(value.props.children); } };
        collect(controls);
        const button = nodes.find(node => node.type === "button" && node.props.children === decision)!;
        expect(button.props.type).toBe("button");
        button.props.onClick({ type: "click", detail: activation === "keyboard" ? 0 : 1 });
        expect(f.onAudio).toHaveBeenCalledTimes(decision === "Cancelar" ? 0 : 1);
        expect(f.onCancelled).toHaveBeenCalledTimes(decision === "Cancelar" ? 1 : 0);
      }
    }
    const html = renderToStaticMarkup(createElement(VoiceCommandControls, { state: "RECORDING", onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn() }));
    expect(html).toContain("Grabando…"); expect(html).toContain("Detener y transcribir"); expect(html).toContain(">Cancelar</button>");
  });
  it("ignores repeated stop and idle cancellation and preserves completed audio", async () => {
    const f = setup(); f.voice.cancel(); expect(f.onCancelled).not.toHaveBeenCalled();
    await f.voice.start(); f.recorder?.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
    f.voice.stop(); f.voice.stop(); f.voice.cancel();
    expect(f.onAudio).toHaveBeenCalledOnce(); expect(f.onCancelled).not.toHaveBeenCalled();
  });
  it("preserves the final asynchronous chunk after normal stop and publishes exactly once", async () => {
    const f = setup(); await f.voice.start();
    const recorder = f.recorder!;
    recorder.stop = () => { recorder.state = "inactive"; };
    f.voice.stop(); f.voice.stop();
    expect(f.onAudio).not.toHaveBeenCalled();
    recorder.ondataavailable?.({ data: new Blob(["final-audio"]) } as BlobEvent);
    const onstop = recorder.onstop;
    onstop?.(new Event("stop")); onstop?.(new Event("stop"));
    expect(f.onAudio).toHaveBeenCalledOnce(); expect(f.onCancelled).not.toHaveBeenCalled();
    expect(await (f.onAudio.mock.calls[0][0] as Blob).text()).toBe("final-audio");
  });
  it("discards audio at the duration limit and after disposal without uploading", async () => {
    for (const cancel of ["deadline", "dispose"] as const) {
      const f = setup(); await f.voice.start();
      f.recorder?.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
      if (cancel === "deadline") f.timers[0](); else f.voice.dispose();
      expect(f.onAudio).not.toHaveBeenCalled(); expect(f.trackStop).toHaveBeenCalledOnce();
    }
  });
  it("discards an oversized recording while collecting bounded chunks", async () => {
    const f = setup(); await f.voice.start();
    f.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]) } as BlobEvent);
    expect(f.onAudio).not.toHaveBeenCalled(); expect(f.trackStop).toHaveBeenCalledOnce();
  });
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
