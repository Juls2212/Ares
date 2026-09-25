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
  it("accepts only bounded ArrayBuffer audio with an allowed browser MIME type", async () => {
    const service = serviceFor();
    await expect(service.transcribe({ audio, mimeType: "audio/webm" })).resolves.toEqual({ ok: true, data: { text: "Crear una tarea" } });
    for (const input of [
      { audio: new ArrayBuffer(0), mimeType: "audio/webm" },
      { audio, mimeType: "audio/mp3" },
      { audio: new Uint8Array([1]), mimeType: "audio/webm" },
      { audio, mimeType: "audio/webm", extra: true }
    ]) {
      const result = await service.transcribe(input);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects oversized audio before provider creation", async () => {
    const createProvider = vi.fn();
    const service = serviceFor({ createProvider });
    const result = await service.transcribe({ audio: new ArrayBuffer(5 * 1024 * 1024 + 1), mimeType: "audio/webm" });
    expect(result).toMatchObject({ ok: false, error: { code: "VOICE_AUDIO_TOO_LARGE" } });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("maps configuration and provider failures without audio, transcript, or technical leakage", async () => {
    const secret = "private-audio-or-provider-detail";
    const logError = vi.fn();
    const configuration = serviceFor({ getConfiguration: () => { throw new Error(secret); }, logError });
    const provider = serviceFor({ createProvider: () => ({ transcribe: async () => { throw { status: 401, detail: secret }; } }), logError });
    const results = [
      await configuration.transcribe({ audio, mimeType: "audio/webm" }),
      await provider.transcribe({ audio, mimeType: "audio/webm" })
    ];
    expect(results[0]).toMatchObject({ ok: false, error: { code: "VOICE_CONFIGURATION_UNAVAILABLE" } });
    expect(results[1]).toMatchObject({ ok: false, error: { code: "VOICE_AUTHENTICATION_UNAVAILABLE" } });
    expect(JSON.stringify([results, logError.mock.calls])).not.toContain(secret);
  });

  it("uses no persistent audio file or filesystem adapter", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/main/voice/openai-transcription-provider.ts"), "utf8");
    expect(source).not.toMatch(/node:fs|writeFile|mkdtemp|unlink|createReadStream/);
    expect(source).toContain("toFile(new Uint8Array(audio)");
    expect(source).toContain('language: "es"');
  });
});
