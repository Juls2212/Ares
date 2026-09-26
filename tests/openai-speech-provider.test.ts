import { describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ create: vi.fn(), configuration: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  audio = { speech: { create: mock.create } };
  constructor(configuration: unknown) { mock.configuration(configuration); }
} }));
import { createOpenAiSpeechProvider } from "../src/main/voice/openai-speech-provider";

describe("Main speech provider", () => {
  it("uses fixed model, voice, instructions, MP3, timeout and zero retries with an injected fake credential", async () => {
    mock.create.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const provider = createOpenAiSpeechProvider("test-only-placeholder");
    const signal = new AbortController().signal;
    const result = await provider("Listo.", signal);
    expect(mock.configuration).toHaveBeenCalledWith({ apiKey: "test-only-placeholder", maxRetries: 0, timeout: 20_000 });
    expect(mock.create).toHaveBeenCalledWith({ model: "gpt-4o-mini-tts", voice: "onyx", input: "Listo.", response_format: "mp3", instructions: "Adult masculine voice, warm, calm, clear, natural Colombian Spanish, slightly deep tone, conversational but concise. Do not imitate a real person." }, { signal });
    expect(result.mimeType).toBe("audio/mpeg"); expect(result.audio.byteLength).toBe(3);
  });
  it("rejects unapproved MIME without returning provider content", async () => {
    mock.create.mockResolvedValue(new Response("private detail", { headers: { "content-type": "application/json" } }));
    await expect(createOpenAiSpeechProvider("test-only-placeholder")("Listo.", new AbortController().signal)).rejects.toThrow("SPEECH_FORMAT");
  });
});
