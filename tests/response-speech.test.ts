import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createSpeechService } from "../src/main/voice/speech-service";
import { composeFinalResponse } from "../src/main/voice/final-response-composer";
import { createResponsePlayback } from "../src/renderer/features/voice/response-playback";
import { SPEECH_LIMITS } from "../src/shared/speech-contracts";
import type { ActionOutcome } from "../src/shared/action-contracts";
import { shouldAutomaticallySpeak } from "../src/renderer/features/voice/speech-eligibility";

const audio = () => ({ audio: new ArrayBuffer(10), mimeType: "audio/mpeg" as const });
describe("trusted response speech", () => {
  it("reports only fixed playback categories and stops active audio immediately", async () => {
    const player = { play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), onended: null, onerror: null };
    const onState = vi.fn(); const onFailure = vi.fn(); const revokeUrl = vi.fn();
    const controller = createResponsePlayback({ speak: async () => ({ ok: true, data: audio() }), createUrl: () => "blob:memory", revokeUrl, createAudio: () => player as unknown as HTMLAudioElement, onState, onFailure });
    await controller.play("trusted-reference");
    const element = player as unknown as HTMLAudioElement;
    expect(onState).toHaveBeenLastCalledWith("LOADING");
    element.onplaying?.call(element, new Event("playing"));
    expect(onState).toHaveBeenLastCalledWith("PLAYING");
    controller.stop();
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.removeAttribute).toHaveBeenCalledWith("src");
    expect(revokeUrl).toHaveBeenCalledWith("blob:memory");
    expect(onState).toHaveBeenLastCalledWith("IDLE");
    const failed = createResponsePlayback({ speak: async () => ({ ok: true, data: audio() }), createUrl: () => "blob:memory", revokeUrl, createAudio: () => ({ ...player, play: async () => { throw new Error("private raw browser detail"); } }) as unknown as HTMLAudioElement, onState, onFailure });
    await failed.play("trusted-reference");
    expect(onFailure).toHaveBeenCalledWith("AUDIO_PLAYBACK");
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private");
  });
  it("uses real media events for playback and completion, not promise resolution", async () => {
    const element = { duration: 2.5, play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() } as unknown as HTMLAudioElement;
    const onState = vi.fn(); const onDiagnostic = vi.fn();
    const onPlaybackEvent = vi.fn();
    const controller = createResponsePlayback({ speak: async () => ({ ok: true, data: audio() }), createUrl: () => "blob:memory", revokeUrl: vi.fn(), createAudio: () => element, onState, onDiagnostic, onPlaybackEvent });
    await controller.play("reference");
    expect(onState).not.toHaveBeenCalledWith("PLAYING");
    expect(onPlaybackEvent).not.toHaveBeenCalled();
    element.onloadedmetadata?.call(element, new Event("loadedmetadata"));
    element.oncanplay?.call(element, new Event("canplay"));
    element.onplaying?.call(element, new Event("playing"));
    expect(onState).toHaveBeenLastCalledWith("PLAYING");
    expect(onPlaybackEvent).toHaveBeenLastCalledWith({ type: "PLAYING", responseId: "reference", durationSeconds: 2.5 });
    element.onended?.call(element, new Event("ended"));
    expect(onState).toHaveBeenLastCalledWith("FINISHED");
    expect(onPlaybackEvent).toHaveBeenLastCalledWith({ type: "ENDED", responseId: "reference" });
    expect(onDiagnostic.mock.calls.map(([category]) => category)).toEqual(["MP3_RECEIVED", "BLOB_READY", "LOADED_METADATA", "CAN_PLAY", "PLAYING", "ENDED", "STOPPED"]);
    expect(element.onplaying).toBeNull();
  });
  it("classifies autoplay and decoding rejection without exposing raw details", async () => {
    for (const [name, category] of [["NotAllowedError", "PLAY_NOT_ALLOWED"], ["NotSupportedError", "PLAY_NOT_SUPPORTED"], ["AbortError", "PLAY_ABORTED"]]) {
      const element = { play: vi.fn(async () => { const error = new Error("private browser details"); error.name = name; throw error; }), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() } as unknown as HTMLAudioElement;
      const onFailure = vi.fn(); const onState = vi.fn();
      const controller = createResponsePlayback({ speak: async () => ({ ok: true, data: audio() }), createUrl: () => "blob:memory", revokeUrl: vi.fn(), createAudio: () => element, onState, onFailure });
      await controller.play("reference");
      expect(onFailure).toHaveBeenCalledWith(category);
      expect(onState).toHaveBeenLastCalledWith("ERROR");
      expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private");
    }
  });
  it("never reports completion without a playing event and times out a silent start", async () => {
    vi.useFakeTimers();
    try {
      const element = { play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn() } as unknown as HTMLAudioElement;
      const onFailure = vi.fn(); const onState = vi.fn();
      const controller = createResponsePlayback({ speak: async () => ({ ok: true, data: audio() }), createUrl: () => "blob:memory", revokeUrl: vi.fn(), createAudio: () => element, onState, onFailure });
      await controller.play("reference");
      element.onended?.call(element, new Event("ended"));
      expect(onFailure).toHaveBeenLastCalledWith("NO_PLAYING_EVENT");
      expect(onState).not.toHaveBeenCalledWith("FINISHED");
      await controller.play("reference");
      await vi.advanceTimersByTimeAsync(SPEECH_LIMITS.timeoutMs);
      expect(onFailure).toHaveBeenLastCalledWith("PLAY_START_TIMEOUT");
      expect(onState).toHaveBeenLastCalledWith("ERROR");
      expect(element.oncanplay).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("automatic playback excludes pending confirmation, recording, progress, hidden and repeated responses", () => {
    const input = { enabled: true, blocked: false, hidden: false, responseId: "final" };
    expect(shouldAutomaticallySpeak(input)).toBe(true);
    for (const overrides of [{ enabled: false }, { blocked: true }, { hidden: true }, { responseId: undefined }, { previousId: "final" }]) expect(shouldAutomaticallySpeak({ ...input, ...overrides })).toBe(false);
  });
  it("accepts only a window-bound Main response reference, not arbitrary text", async () => {
    const provider = vi.fn(async () => audio());
    const service = createSpeechService(() => provider);
    const response = service.remember(1, "Listo, agregué la tarea.")!;
    expect((await service.speak(2, { responseId: response.responseId })).ok).toBe(false);
    expect((await service.speak(1, { responseId: response.responseId, text: "untrusted" })).ok).toBe(false);
    expect(provider).not.toHaveBeenCalled();
    expect((await service.speak(1, { responseId: response.responseId })).ok).toBe(true);
    expect(provider).toHaveBeenCalledWith(response.text, expect.any(AbortSignal));
    service.clear(1);
    expect((await service.speak(1, { responseId: response.responseId })).ok).toBe(false);
  });
  it("bounds text, expiry, audio and MIME", async () => {
    let now = 0;
    const provider = vi.fn(async () => ({ audio: new ArrayBuffer(SPEECH_LIMITS.audioBytes + 1), mimeType: "audio/mpeg" as const }));
    const service = createSpeechService(() => provider, () => now);
    expect(service.remember(1, "x".repeat(401))).toBeUndefined();
    let response = service.remember(1, "Listo.")!;
    expect((await service.speak(1, { responseId: response.responseId })).ok).toBe(false);
    response = service.remember(1, "Listo.")!;
    now = SPEECH_LIMITS.responseLifetimeMs;
    expect((await service.speak(1, { responseId: response.responseId })).ok).toBe(false);
    const invalid = createSpeechService(() => async () => ({ audio: new ArrayBuffer(0), mimeType: "audio/mpeg" }));
    expect((await invalid.speak(1, { responseId: invalid.remember(1, "Listo.")!.responseId })).ok).toBe(false);
  });
  it("single-flights and redacts provider/configuration failures and timeouts", async () => {
    const service = createSpeechService(() => async () => new Promise(() => {}), Date.now, 10);
    const responseId = service.remember(1, "Listo.")!.responseId;
    const first = service.speak(1, { responseId });
    expect(await service.speak(1, { responseId })).toMatchObject({ ok: false, error: { code: "SPEECH_BUSY" } });
    expect(await first).toMatchObject({ ok: false, error: { code: "SPEECH_TIMEOUT" } });
    const failure = createSpeechService(() => { throw new Error("private credential and provider details"); });
    const result = await failure.speak(1, { responseId: failure.remember(1, "Listo.")!.responseId });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.ok).toBe(false);
  });
  it("composes planner acknowledgements only from confirmed Main results", () => {
    const outcome = { action: "CREATE_TASK", status: "SUCCEEDED", data: { record: {} } } as ActionOutcome;
    expect(composeFinalResponse(outcome)).toBe("Listo, agregué la tarea.");
    for (const status of ["EXECUTION_FAILED", "CANCELLED", "VALIDATION_FAILED"] as const) expect(composeFinalResponse({ ...outcome, status })).toBeUndefined();
    expect(composeFinalResponse({ ...outcome, data: undefined })).toBeUndefined();
    expect(composeFinalResponse({ ...outcome, action: "DELETE_EVENT", data: { deleted: true } })).toBe("Listo, eliminé el evento.");
    expect(composeFinalResponse({ ...outcome, action: "DELETE_EVENT", data: {} })).toBeUndefined();
    expect(composeFinalResponse({ ...outcome, action: "ORGANIZE_FILES" })).toBeUndefined();
  });
  it("uses only the Main-resolved application display name and keeps it eligible for response-ID speech", async () => {
    const outcome = {
      action: "OPEN_APPLICATION",
      status: "SUCCEEDED",
      data: { applicationName: "Google Chrome" }
    } as ActionOutcome;
    const text = composeFinalResponse(outcome);
    expect(text).toBe("Listo, abrí Google Chrome.");

    const provider = vi.fn(async () => audio());
    const service = createSpeechService(() => provider);
    const response = service.remember(1, text!)!;
    expect((await service.speak(1, { responseId: response.responseId })).ok).toBe(true);
    expect(provider).toHaveBeenCalledWith("Listo, abrí Google Chrome.", expect.any(AbortSignal));
    expect(composeFinalResponse({ ...outcome, data: { applicationName: "C:\\private\\chrome.exe" } })).toBeUndefined();
  });
  it("does not turn failed or malformed application outcomes into a success acknowledgement", () => {
    const outcome = {
      action: "OPEN_APPLICATION",
      status: "EXECUTION_FAILED",
      data: { applicationName: "Google Chrome" },
      userSummary: "No se pudo abrir la aplicación registrada."
    } as ActionOutcome;
    expect(composeFinalResponse(outcome)).toBeUndefined();
    expect(composeFinalResponse({ ...outcome, status: "SUCCEEDED", data: undefined })).toBeUndefined();
    expect(JSON.stringify(outcome)).not.toContain("chrome.exe");
  });
  it("preserves Main-grounded schedule and current-time summaries for final display and speech", () => {
    for (const action of ["GET_TODAY_SCHEDULE", "GET_CURRENT_DATE_TIME", "GET_WEATHER", "GET_WEEKLY_SCHEDULE_DETAILS", "ANALYZE_WEEKLY_SCHEDULE", "GET_TODAY_AVAILABILITY"] as const) {
      expect(composeFinalResponse({ action, status: "SUCCEEDED" } as ActionOutcome)).toBeUndefined();
    }
  });
  it("plays only bounded memory audio, revokes URLs and ignores cancelled late results", async () => {
    const player = { play: vi.fn(async () => {}), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), onended: null, onerror: null };
    const revokeUrl = vi.fn(); const onState = vi.fn();
    const playback = createResponsePlayback({ speak: vi.fn(async () => ({ ok: true as const, data: audio() })), createUrl: () => "blob:local", revokeUrl, createAudio: () => player as unknown as HTMLAudioElement, onState });
    await playback.play("reference");
    expect(player.play).toHaveBeenCalledOnce();
    playback.stop(); expect(revokeUrl).toHaveBeenCalledWith("blob:local"); expect(player.pause).toHaveBeenCalled();
    let resolve!: (value: { ok: true; data: ReturnType<typeof audio> }) => void;
    const late = createResponsePlayback({ speak: () => new Promise((done) => { resolve = done; }), createUrl: vi.fn(), revokeUrl, createAudio: () => player as unknown as HTMLAudioElement, onState });
    const pending = late.play("reference"); late.stop(); resolve({ ok: true, data: audio() }); await pending;
    expect(player.play).toHaveBeenCalledOnce();
  });
  it("exposes one reference-only IPC method and keeps automatic playback fixed on", () => {
    const source = (file: string) => readFileSync(file, "utf8");
    const controls = source("src/renderer/features/voice/response-speech-controls.tsx");
    expect(controls).toContain("enabled: true");
    expect(source("src/renderer/app/App.tsx")).not.toContain("automaticSpeech");
    for (const label of ["Escuchar respuesta", "Detener voz"]) expect(controls).toContain(label);
    for (const removedLabel of ["La voz de Ares es generada por IA.", "Leer respuestas automáticamente"]) expect(controls).not.toContain(removedLabel);
    for (const label of ["Generando voz…", "Reproduciendo voz…", "Voz finalizada", "No se pudo iniciar o continuar la voz."]) expect(controls).toContain(label);
    for (const lifecycle of ["Escape", "visibilitychange", "pagehide", "controller.stop()", "blocked"]) expect(controls).toContain(lifecycle);
    expect(source("src/preload/preload.ts")).toContain("IPC_CHANNELS.speech.speak, input");
    const provider = source("src/main/voice/openai-speech-provider.ts");
    expect(provider).toContain('OPENAI_SPEECH_MODEL = "gpt-4o-mini-tts"');
    expect(provider).toContain('OPENAI_SPEECH_VOICE = "onyx"');
    expect(provider).toContain("OPENAI_SPEECH_SPEED = 1.05");
    expect(provider).toContain("maxRetries: 0");
    // Playback uses a local in-memory object URL, never a remote media source.
    expect(source("vite.renderer.config.ts")).toContain('"media-src blob:"');
    expect(controls).toContain("env?.DEV");
    for (const forbidden of ["writeFile", "speechSynthesis", "actions.confirm", "actions.propose", "process.env", 'from "openai"']) expect(controls).not.toContain(forbidden);
  });
});
