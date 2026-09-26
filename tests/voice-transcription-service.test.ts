import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createVoiceTranscriptionService } from "../src/main/voice/voice-transcription-service";

const audio = new Uint8Array([1, 2, 3]).buffer;

const serviceFor = (overrides: Record<string, unknown> = {}) =>
  createVoiceTranscriptionService({
    getConfiguration: () => ({ apiKey: "private-key", transcriptionModel: "private-model" }),
    createProvider: () => ({ transcribe: vi.fn(async () => "Crear una tarea") }),
    logError: vi.fn(),
    ...overrides
  } as never);

describe("Main-only voice transcription service", () => {
  it("bounds a stalled provider and rejects concurrent requests without retry", async () => {
    vi.useFakeTimers();
    try {
      const transcribe = vi.fn(() => new Promise<string>(() => {}));
      const service = serviceFor({ createProvider: () => ({ transcribe }), timeoutMs: 20 });
      const first = service.transcribe({ audio, mimeType: "audio/webm", durationMs: 1000 });
      await expect(service.transcribe({ audio, mimeType: "audio/webm", durationMs: 1000 })).resolves.toMatchObject({ ok: false, error: { code: "VOICE_TRANSCRIPTION_BUSY" } });
      await vi.advanceTimersByTimeAsync(20);
      await expect(first).resolves.toMatchObject({ ok: false, error: { code: "VOICE_TRANSCRIPTION_TIMEOUT" } });
      expect(transcribe).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("accepts only bounded ArrayBuffer audio with an allowed browser MIME type", async () => {
    const service = serviceFor();
    await expect(service.transcribe({ audio, mimeType: "audio/webm", durationMs: 1000 })).resolves.toEqual({ ok: true, data: { text: "Crear una tarea" } });
    for (const input of [
      { audio: new ArrayBuffer(0), mimeType: "audio/webm", durationMs: 1000 },
      { audio, mimeType: "audio/mp3", durationMs: 1000 },
      { audio: new Uint8Array([1]), mimeType: "audio/webm", durationMs: 1000 },
      { audio, mimeType: "audio/webm", durationMs: 1000, extra: true },
      { audio, mimeType: "audio/webm", durationMs: 60_001 },
      { audio, mimeType: "audio/webm", durationMs: NaN },
      { audio, mimeType: "audio/webm" }
    ]) {
      const result = await service.transcribe(input);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects oversized audio before provider creation", async () => {
    const createProvider = vi.fn();
    const service = serviceFor({ createProvider });
    const result = await service.transcribe({ audio: new ArrayBuffer(5 * 1024 * 1024 + 1), mimeType: "audio/webm", durationMs: 1000 });
    expect(result).toMatchObject({ ok: false, error: { code: "VOICE_AUDIO_TOO_LARGE" } });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("maps configuration and provider failures without audio, transcript, or technical leakage", async () => {
    const secret = "private-audio-or-provider-detail";
    const logError = vi.fn();
    const configuration = serviceFor({ getConfiguration: () => { throw new Error(secret); }, logError });
    const provider = serviceFor({ createProvider: () => ({ transcribe: async () => { throw { status: 401, detail: secret }; } }), logError });
    const results = [
      await configuration.transcribe({ audio, mimeType: "audio/webm", durationMs: 1000 }),
      await provider.transcribe({ audio, mimeType: "audio/webm", durationMs: 1000 })
    ];
    expect(results[0]).toMatchObject({ ok: false, error: { code: "VOICE_CONFIGURATION_UNAVAILABLE" } });
    expect(results[1]).toMatchObject({ ok: false, error: { code: "VOICE_AUTHENTICATION_UNAVAILABLE" } });
    expect(JSON.stringify([results, logError.mock.calls])).not.toContain(secret);
  });

  it("redacts network and provider errors using only stable controlled outcomes", async () => {
    for (const error of [{ name: "APIConnectionError", message: "private-network-detail" }, { status: 500, message: "private-provider-detail" }]) {
      const logError = vi.fn();
      const service = serviceFor({ createProvider: () => ({ transcribe: async () => { throw error; } }), logError });
      const result = await service.transcribe({ audio, mimeType: "audio/webm", durationMs: 1000 });
      expect(result).toMatchObject({ ok: false, error: { code: "VOICE_PROVIDER_UNAVAILABLE" } });
      expect(JSON.stringify([result, logError.mock.calls])).not.toContain("private-");
    }
  });

  it("uses no persistent audio file or filesystem adapter", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/main/voice/openai-transcription-provider.ts"), "utf8");
    expect(source).not.toMatch(/node:fs|writeFile|mkdtemp|unlink|createReadStream/);
    expect(source).toContain("toFile(new Uint8Array(audio)");
    expect(source).toContain('language: "es"');
  });
});
