import { describe, expect, it, vi } from "vitest";

const openAiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  toFile: vi.fn(async () => "safe-audio-file")
}));

vi.mock("openai", () => ({
  default: class OpenAiClient {
    public audio = { transcriptions: { create: openAiMocks.create } };
  },
  toFile: openAiMocks.toFile
}));

import { createOpenAiTranscriptionProvider } from "../src/main/voice/openai-transcription-provider";

describe("OpenAI transcription provider", () => {
  it("sends the fixed Spanish language hint without exposing configuration", async () => {
    openAiMocks.create.mockResolvedValueOnce({ text: "Texto transcrito" });
    const provider = createOpenAiTranscriptionProvider({
      apiKey: "test-only-secret",
      transcriptionModel: "test-only-model"
    });
    const signal = new AbortController().signal;

    await expect(provider.transcribe({
      audio: new Uint8Array([1, 2, 3]).buffer,
      mimeType: "audio/webm",
      signal
    })).resolves.toBe("Texto transcrito");

    expect(openAiMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ language: "es", response_format: "json" }),
      { signal }
    );
    // No recognition hint is sent: the request has exactly these fields.
    const sent = openAiMocks.create.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["file", "language", "model", "response_format"]);
    expect(sent).not.toHaveProperty("prompt");
  });
});
