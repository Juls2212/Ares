import { describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ create: vi.fn(), configuration: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  audio = { speech: { create: mock.create } };
  constructor(configuration: unknown) { mock.configuration(configuration); }
} }));
import { OPENAI_SPEECH_INSTRUCTIONS, OPENAI_SPEECH_MODEL, OPENAI_SPEECH_SPEED, OPENAI_SPEECH_VOICE, createOpenAiSpeechProvider } from "../src/main/voice/openai-speech-provider";

describe("Main speech provider", () => {
  it("uses fixed model, voice, instructions, MP3, timeout and zero retries with an injected fake credential", async () => {
    mock.create.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const provider = createOpenAiSpeechProvider("test-only-placeholder");
    const signal = new AbortController().signal;
    const result = await provider("Listo.", signal);
    expect(mock.configuration).toHaveBeenCalledWith({ apiKey: "test-only-placeholder", maxRetries: 0, timeout: 20_000 });
    expect(mock.create).toHaveBeenCalledWith({ model: OPENAI_SPEECH_MODEL, voice: OPENAI_SPEECH_VOICE, speed: OPENAI_SPEECH_SPEED, input: "Listo.", response_format: "mp3", instructions: OPENAI_SPEECH_INSTRUCTIONS }, { signal });
    expect(result.mimeType).toBe("audio/mpeg"); expect(result.audio.byteLength).toBe(3);
  });
  it("uses the fluid Colombian Spanish speech profile", () => {
    expect(OPENAI_SPEECH_MODEL).toBe("gpt-4o-mini-tts");
    expect(OPENAI_SPEECH_VOICE).toBe("onyx");
    expect(OPENAI_SPEECH_SPEED).toBe(1.05);
    expect(OPENAI_SPEECH_INSTRUCTIONS).toContain("fluid, connected rhythm");
    expect(OPENAI_SPEECH_INSTRUCTIONS).toContain("genuine sentence boundaries");
    expect(OPENAI_SPEECH_INSTRUCTIONS).toContain("Do not imitate a real person.");
  });
  it("rejects unapproved MIME without returning provider content", async () => {
    mock.create.mockResolvedValue(new Response("private detail", { headers: { "content-type": "application/json" } }));
    await expect(createOpenAiSpeechProvider("test-only-placeholder")("Listo.", new AbortController().signal)).rejects.toThrow("SPEECH_FORMAT");
  });
});
