import { describe, expect, it, vi } from "vitest";

import { createManualVoiceRecorder } from "../src/renderer/features/voice/manual-voice-recorder";
import {
  CAPTURE_ERROR_NAMES,
  VOICE_CAPTURE_FAILURES,
  VOICE_STAGES,
  createVoiceAttempt,
  errorNameOf,
  failureCodeForCaptureError,
  failureCodeForTranscription,
  formatVoiceDiagnostic,
  mimeFamilyOf,
  normalizeMicrophoneAccess,
  peakLevelOf,
  sizeBucketOf
} from "../src/shared/voice-diagnostics";
import { VOICE_ERROR_CODES } from "../src/shared/voice-contracts";

/** The only shape a diagnostic line may have: fixed keys, and values made of enum characters and digits. */
const LINE_SHAPE = /^voice-diag(?: (?:side|stage|mic|devices|mime|size|durationMs|peak|analysis|error|failure)=[A-Za-z0-9_<>-]+)*$/u;

describe("voice diagnostic line", () => {
  it("formats known facts as fixed enums and bounded numbers, in a fixed order", () => {
    expect(formatVoiceDiagnostic({
      side: "renderer", stage: "blob_ready", microphone: "granted", devices: 2, mime: "audio/webm;codecs=opus", bytes: 5_000,
      durationMs: 2_300, peak: "speech", analysis: "ok", errorName: "NotFoundError", failure: "VOICE_CAPTURE_NO_DEVICE"
    })).toBe("voice-diag side=renderer stage=blob_ready mic=granted devices=2 mime=webm size=<10KB durationMs=2300 peak=speech analysis=ok error=NotFoundError failure=VOICE_CAPTURE_NO_DEVICE");
    expect(formatVoiceDiagnostic({})).toBe("voice-diag");
  });

  it("never lets a hostile value through: unknown inputs print their fallback, never the input", () => {
    const secret = "sk-SECRET-token Ana García dijo crear una tarea C:\\Users\\Ana\\x https://evil.example/?q=1";
    const line = formatVoiceDiagnostic({
      side: secret, stage: secret, microphone: secret, devices: secret, mime: secret, bytes: secret, durationMs: secret, peak: secret,
      analysis: secret, errorName: secret, failure: secret
    });
    expect(line).toMatch(LINE_SHAPE);
    for (const leak of ["SECRET", "Ana", "García", "tarea", "evil", "Users", "sk-"]) expect(line).not.toContain(leak);
    expect(line).toContain("stage=invalid");
    expect(line).toContain("mic=unknown");
    expect(line).toContain("error=other");
    expect(line).toContain("failure=invalid");
    for (const hostile of [{ toString: () => secret }, [secret], null, Symbol("x"), 1e300, -1, NaN, Infinity, "audio/webm; label=Ana"]) {
      const out = formatVoiceDiagnostic({ stage: hostile, microphone: hostile, devices: hostile, mime: hostile, bytes: hostile, durationMs: hostile, errorName: hostile, failure: hostile, peak: hostile, analysis: hostile });
      expect(out).toMatch(LINE_SHAPE);
      expect(out).not.toMatch(/Ana|SECRET|evil/u);
    }
  });

  it("bounds every number", () => {
    expect(formatVoiceDiagnostic({ devices: 1_000_000 })).toBe("voice-diag devices=99");
    expect(formatVoiceDiagnostic({ devices: -4 })).toBe("voice-diag devices=0");
    expect(formatVoiceDiagnostic({ devices: 2.9 })).toBe("voice-diag devices=2");
    expect(formatVoiceDiagnostic({ durationMs: 9e9 })).toBe("voice-diag durationMs=600000");
    expect(formatVoiceDiagnostic({ durationMs: Number.NaN })).toBe("voice-diag");
  });

  it("buckets sizes, families, access status and peak level", () => {
    expect([0, -1, NaN, 1, 1023, 1024, 10_239, 10_240, 102_399, 102_400, 5_000_000].map(sizeBucketOf)).toEqual(["0", "0", "0", "<1KB", "<1KB", "<10KB", "<10KB", "<100KB", "<100KB", "bigger", "bigger"]);
    expect(["audio/webm", "audio/webm;codecs=opus", "AUDIO/OGG", "audio/mp4", "video/mp4", "", undefined, 5].map(mimeFamilyOf)).toEqual(["webm", "webm", "ogg", "mp4", "other", "other", "other", "other"]);
    expect(["granted", "denied", "restricted", "not-determined", "unknown", "GRANTED", "x", undefined].map(normalizeMicrophoneAccess)).toEqual(["granted", "denied", "restricted", "not-determined", "unknown", "unknown", "unknown", "unknown"]);
    expect([0, 0.004, 0.005, 0.0249, 0.025, 0.4, NaN, "0.5"].map((rms) => peakLevelOf(rms, 0.025))).toEqual(["silent", "silent", "low", "low", "speech", "speech", "silent", "silent"]);
  });
});

describe("closed failure mapping", () => {
  it("maps every known DOM error name to a closed code, and anything else to the unknown fallback", () => {
    expect(CAPTURE_ERROR_NAMES.map((name) => [name, failureCodeForCaptureError(name)])).toEqual([
      ["NotAllowedError", "VOICE_CAPTURE_PERMISSION_DENIED"],
      ["NotFoundError", "VOICE_CAPTURE_NO_DEVICE"],
      ["NotReadableError", "VOICE_CAPTURE_DEVICE_BUSY"],
      ["OverconstrainedError", "VOICE_CAPTURE_NO_DEVICE"],
      ["AbortError", "VOICE_CAPTURE_DEVICE_BUSY"],
      ["SecurityError", "VOICE_CAPTURE_PERMISSION_DENIED"]
    ]);
    for (const name of CAPTURE_ERROR_NAMES) expect(VOICE_CAPTURE_FAILURES.isCode(failureCodeForCaptureError(name))).toBe(true);
    for (const unknown of ["TypeError", "Error", "", "notallowederror", "constructor", "__proto__", "toString", "hasOwnProperty", undefined, null, 5, {}, ["NotAllowedError"]]) {
      expect(failureCodeForCaptureError(unknown), String(unknown)).toBe("VOICE_CAPTURE_UNKNOWN");
    }
  });

  it("reports a system-level denial only for a permission error while the system says denied or restricted", () => {
    expect(failureCodeForCaptureError("NotAllowedError", "denied")).toBe("VOICE_CAPTURE_SYSTEM_DENIED");
    expect(failureCodeForCaptureError("SecurityError", "restricted")).toBe("VOICE_CAPTURE_SYSTEM_DENIED");
    expect(failureCodeForCaptureError("NotAllowedError", "granted")).toBe("VOICE_CAPTURE_PERMISSION_DENIED");
    expect(failureCodeForCaptureError("NotAllowedError", "unknown")).toBe("VOICE_CAPTURE_PERMISSION_DENIED");
    expect(failureCodeForCaptureError("NotFoundError", "denied")).toBe("VOICE_CAPTURE_NO_DEVICE");
  });

  it("maps transcription errors from Main and reads only the name of a thrown value", () => {
    expect(failureCodeForTranscription(VOICE_ERROR_CODES.audioEmpty)).toBe("VOICE_CAPTURE_EMPTY_RECORDING");
    expect(failureCodeForTranscription(VOICE_ERROR_CODES.transcriptEmpty)).toBe("VOICE_TRANSCRIPT_EMPTY");
    for (const code of [VOICE_ERROR_CODES.provider, VOICE_ERROR_CODES.timeout, VOICE_ERROR_CODES.configuration, "anything", undefined]) {
      expect(failureCodeForTranscription(code)).toBe("VOICE_TRANSCRIPTION_FAILED");
    }
    expect(errorNameOf({ name: "NotFoundError", message: "private" })).toBe("NotFoundError");
    expect(errorNameOf("string")).toBeUndefined();
    expect(errorNameOf(null)).toBeUndefined();
  });

  it("keeps the messages that already existed byte for byte and adds fixed Spanish ones for the rest", () => {
    expect(VOICE_CAPTURE_FAILURES.messages.VOICE_CAPTURE_PERMISSION_DENIED).toBe("No se puede usar el micrófono. Revisa los permisos.");
    expect(VOICE_CAPTURE_FAILURES.messages.VOICE_CAPTURE_UNKNOWN).toBe("No se puede usar el micrófono. Revisa los permisos.");
    expect(VOICE_CAPTURE_FAILURES.messages.VOICE_CAPTURE_EMPTY_RECORDING).toBe("No se recibió audio para transcribir.");
    expect(VOICE_CAPTURE_FAILURES.messages.VOICE_CAPTURE_RECORDER_UNSUPPORTED).toBe("Este navegador no puede grabar audio compatible.");
    expect(VOICE_CAPTURE_FAILURES.messages.VOICE_TRANSCRIPTION_FAILED).toBe("La transcripción no está disponible en este momento.");
    expect(VOICE_CAPTURE_FAILURES.codes).toHaveLength(9);
  });
});

describe("one line per attempt", () => {
  it("emits once, with the furthest stage reached and the facts gathered", () => {
    const log = vi.fn();
    const attempt = createVoiceAttempt(log);
    attempt.reach("shortcut_or_click");
    attempt.reach("stream_opened");
    attempt.reach("permission_checked");
    attempt.facts({ microphone: "granted", devices: 1, bytes: undefined });
    attempt.fail("VOICE_CAPTURE_DEVICE_BUSY", "NotReadableError");
    attempt.finish();
    attempt.fail("VOICE_TRANSCRIPTION_FAILED");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toBe("voice-diag side=renderer stage=stream_opened mic=granted devices=1 error=NotReadableError failure=VOICE_CAPTURE_DEVICE_BUSY");
  });

  it("finishes without a failure when the attempt was only cancelled, and never throws if logging does", () => {
    const log = vi.fn();
    const attempt = createVoiceAttempt(log);
    attempt.reach("recorder_started");
    attempt.finish();
    expect(log.mock.calls[0]![0]).toBe("voice-diag side=renderer stage=recorder_started");
    const throwing = createVoiceAttempt(() => { throw new Error("private"); });
    expect(() => throwing.fail("VOICE_CAPTURE_UNKNOWN")).not.toThrow();
  });

  it("orders every stage and never goes backwards", () => {
    const log = vi.fn();
    const attempt = createVoiceAttempt(log);
    for (const stage of [...VOICE_STAGES].reverse()) attempt.reach(stage);
    attempt.finish();
    expect(log.mock.calls[0]![0]).toContain("stage=transcription_done");
  });
});

describe("recorder reports what happened", () => {
  const deps = (overrides: Partial<Parameters<typeof createManualVoiceRecorder>[0]>) => ({
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
    createRecorder: vi.fn(),
    isMimeTypeSupported: () => true,
    createBlob: (parts: BlobPart[], options: BlobPropertyBag) => new Blob(parts, options),
    setTimer: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
    clearTimer: vi.fn(),
    onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable: vi.fn(), onCancelled: vi.fn(), onAudio: vi.fn(),
    ...overrides
  });

  it.each([
    ["NotFoundError", "unknown", "No encontré ningún micrófono. Conecta uno e inténtalo de nuevo."],
    ["OverconstrainedError", "unknown", "No encontré ningún micrófono. Conecta uno e inténtalo de nuevo."],
    ["NotReadableError", "unknown", "El micrófono está ocupado o no se puede leer. Cierra otras aplicaciones que lo usen."],
    ["AbortError", "unknown", "El micrófono está ocupado o no se puede leer. Cierra otras aplicaciones que lo usen."],
    ["NotAllowedError", "granted", "No se puede usar el micrófono. Revisa los permisos."],
    ["NotAllowedError", "denied", VOICE_CAPTURE_FAILURES.messages.VOICE_CAPTURE_SYSTEM_DENIED],
    ["WeirdError", "unknown", "No se puede usar el micrófono. Revisa los permisos."]
  ] as const)("shows the bounded message for %s with microphone status %s and logs the closed code", async (name, microphone, message) => {
    const onUnavailable = vi.fn();
    const log = vi.fn();
    const attempt = createVoiceAttempt(log);
    const recorder = createManualVoiceRecorder(deps({
      getUserMedia: vi.fn(async () => { throw { name, message: "private detail Ana" }; }),
      onUnavailable, diagnostics: attempt, getMicrophoneAccess: () => microphone
    }));
    await recorder.start();
    expect(onUnavailable.mock.calls[0]![0]).toBe(message);
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]![0])).toMatch(LINE_SHAPE);
    expect(String(log.mock.calls[0]![0])).not.toMatch(/Ana|private/u);
  });

  it("reports the stages of a recording and its size and duration bucket without any content", async () => {
    let recorder: { state: string; mimeType: string; ondataavailable: ((event: BlobEvent) => unknown) | null; onstop: ((event: Event) => unknown) | null; start: () => void; stop: () => void } | undefined;
    const log = vi.fn();
    const attempt = createVoiceAttempt(log);
    const onAudio = vi.fn();
    const voice = createManualVoiceRecorder(deps({
      createRecorder: vi.fn(() => recorder = { state: "inactive", mimeType: "audio/webm", ondataavailable: null, onstop: null, start: () => { recorder!.state = "recording"; }, stop: () => { recorder!.state = "inactive"; recorder!.onstop?.(new Event("stop")); } }) as never,
      isMimeTypeSupported: (mime) => mime === "audio/webm",
      diagnostics: attempt, onAudio, now: (() => { let value = 0; return () => (value += 1_000); })()
    }));
    await voice.start();
    recorder!.ondataavailable?.({ data: new Blob(["audio-bytes-never-logged"]) } as BlobEvent);
    voice.stop();
    expect(onAudio).toHaveBeenCalledOnce();
    attempt.finish();
    const line = String(log.mock.calls[0]![0]);
    expect(line).toMatch(LINE_SHAPE);
    expect(line).toContain("stage=blob_ready");
    expect(line).toContain("mime=webm");
    expect(line).toContain("size=<1KB");
    expect(line).not.toContain("audio-bytes");
  });

  it("logs an empty recording and an unsupported recorder as closed failures", async () => {
    const emptyLog = vi.fn();
    let recorder: { state: string; mimeType: string; ondataavailable: unknown; onstop: ((event: Event) => unknown) | null; start: () => void; stop: () => void } | undefined;
    const onUnavailable = vi.fn();
    const voice = createManualVoiceRecorder(deps({
      createRecorder: vi.fn(() => recorder = { state: "inactive", mimeType: "audio/webm", ondataavailable: null, onstop: null, start: () => { recorder!.state = "recording"; }, stop: () => { recorder!.state = "inactive"; recorder!.onstop?.(new Event("stop")); } }) as never,
      isMimeTypeSupported: (mime) => mime === "audio/webm", onUnavailable, diagnostics: createVoiceAttempt(emptyLog)
    }));
    await voice.start();
    voice.stop();
    expect(onUnavailable).toHaveBeenCalledWith("No se recibió audio para transcribir.");
    expect(String(emptyLog.mock.calls[0]![0])).toContain("failure=VOICE_CAPTURE_EMPTY_RECORDING");
    expect(String(emptyLog.mock.calls[0]![0])).toContain("size=0");

    const unsupportedLog = vi.fn();
    const unsupported = vi.fn();
    await createManualVoiceRecorder(deps({ isMimeTypeSupported: () => false, onUnavailable: unsupported, diagnostics: createVoiceAttempt(unsupportedLog) })).start();
    expect(unsupported).toHaveBeenCalledWith("Este navegador no puede grabar audio compatible.");
    expect(String(unsupportedLog.mock.calls[0]![0])).toContain("failure=VOICE_CAPTURE_RECORDER_UNSUPPORTED");
  });
});
