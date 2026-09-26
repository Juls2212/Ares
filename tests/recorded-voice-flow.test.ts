import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createManualVoiceRecorder } from "../src/renderer/features/voice/manual-voice-recorder";
import { bindRecordingCancellation } from "../src/renderer/features/voice/recording-cancellation";
import { createVoiceTranscriptionService } from "../src/main/voice/voice-transcription-service";
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
import { createVoiceIpcRegistration, type VoiceIpcHandler } from "../src/main/ipc/register-voice-ipc";

describe("supervised recorded transcription", () => {
  it("transfers stopped audio through the explicit IPC service to editable text without submission", async () => {
    const provider = { transcribe: vi.fn(async () => "Eliminar esta tarea") };
    const service = createVoiceTranscriptionService({ getConfiguration: () => ({ apiKey: "fake", transcriptionModel: "fake" }), createProvider: () => provider, logError: vi.fn() });
    const handlers = new Map<string, VoiceIpcHandler>();
    createVoiceIpcRegistration({ registerHandler: (key, handler) => handlers.set(key, handler), getService: () => service, logError: vi.fn() })();
    let editableText = "";
    let completion: Promise<void> | undefined;
    let recorder: any;
    const submit = vi.fn();
    const capture = createManualVoiceRecorder({
      getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
      createRecorder: () => recorder = { mimeType: "audio/webm", state: "inactive" as "inactive" | "recording" | "paused", start() { this.state = "recording"; }, stop() { this.state = "inactive"; recorder.onstop(); }, onstop: null, ondataavailable: null },
      isMimeTypeSupported: mime => mime === "audio/webm", createBlob: (parts, options) => new Blob(parts, options), setTimer: vi.fn(), clearTimer: vi.fn(), onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: vi.fn(), onCancelled: vi.fn(),
      onAudio: (blob, mimeType, durationMs) => { completion = (async () => { const result = await handlers.get("voice:transcribe")!({ audio: await blob.arrayBuffer(), mimeType, durationMs }); if (result.ok) editableText = (result.data as { text: string }).text; })(); }
    });
    expect(provider.transcribe).not.toHaveBeenCalled();
    await capture.start(); recorder.ondataavailable({ data: new Blob(["mock-audio"]) }); capture.stop(); await completion;
    expect(editableText).toBe("Eliminar esta tarea"); expect(provider.transcribe).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  });

  it("cancels microphone acquisition before a recorder can start", async () => {
    let resolve!: (stream: { getTracks: () => { stop: () => void }[] }) => void;
    const trackStop = vi.fn(); const createRecorder = vi.fn(); const onAudio = vi.fn();
    const recorder = createManualVoiceRecorder({ getUserMedia: () => new Promise(r => { resolve = r; }), createRecorder, isMimeTypeSupported: () => true, createBlob: (parts, options) => new Blob(parts, options), setTimer: vi.fn(), clearTimer: vi.fn(), onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: vi.fn(), onCancelled: vi.fn(), onAudio });
    const start = recorder.start(); recorder.cancel(); resolve({ getTracks: () => [{ stop: trackStop }] }); await start;
    expect(trackStop).toHaveBeenCalledOnce(); expect(createRecorder).not.toHaveBeenCalled(); expect(onAudio).not.toHaveBeenCalled();
  });

  it("binds local Escape, hiding and closing cancellation and removes listeners", () => {
    const doc = new EventTarget(); const win = new EventTarget(); const cancel = vi.fn();
    const cleanup = bindRecordingCancellation(doc, win, () => true, cancel);
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" })); doc.dispatchEvent(new Event("visibilitychange")); win.dispatchEvent(new Event("pagehide")); win.dispatchEvent(new Event("blur"));
    expect(cancel).toHaveBeenCalledTimes(3); cleanup(); win.dispatchEvent(new Event("blur")); expect(cancel).toHaveBeenCalledTimes(3);
  });

  it("keeps the active control recorded-only and transcription separate from supervised actions", () => {
    const view = readFileSync("src/renderer/views/ares-view.tsx", "utf8");
    expect(view).not.toContain("BrowserSpeechControls"); expect(view).toContain("VoiceCommandControls");
    const app = readFileSync("src/renderer/app/App.tsx", "utf8");
    const transcription = app.slice(app.indexOf("const transcribeAudio"), app.indexOf("const startRecording"));
    expect(transcription).toContain("showTranscript: setInstruction"); expect(transcription).toContain("voiceSubmission.current.submit"); expect(transcription).not.toMatch(/actions\.confirm|actions\.cancel/);
    expect(app).toContain('destination !== "ARES"');
    const controls = readFileSync("src/renderer/features/voice/voice-command-controls.tsx", "utf8"); expect(controls).toContain("audio se enviará a OpenAI");
  });
});
