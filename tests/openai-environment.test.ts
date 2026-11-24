import { describe, expect, it } from "vitest";

import { DEFAULT_TRANSCRIPTION_MODEL, getOpenAiConfiguration, getOpenAiTranscriptionConfiguration } from "../src/main/config/openai-environment";

describe("OpenAI Main environment boundary", () => {
  it("reads only explicitly supplied nonblank configuration in isolated tests", () => {
    expect(
      getOpenAiConfiguration({ OPENAI_API_KEY: "configured", OPENAI_MODEL: "configured" })
    ).toEqual({ apiKey: "configured", model: "configured" });
  });

  it("reports missing configuration without returning a secret", () => {
    expect(() => getOpenAiConfiguration({ OPENAI_MODEL: "configured" })).toThrow(
      "OPENAI_API_KEY is required before an interpretation request."
    );
    expect(() => getOpenAiConfiguration({ OPENAI_API_KEY: "configured" })).toThrow(
      "OPENAI_MODEL is required before an interpretation request."
    );
  });

  it("reads a separate Main-only transcription model, and falls back to the documented full-size default when it is unset or blank", () => {
    expect(getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "configured", OPENAI_TRANSCRIPTION_MODEL: "configured" }))
      .toEqual({ apiKey: "configured", transcriptionModel: "configured" });
    expect(getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "configured", OPENAI_TRANSCRIPTION_MODEL: "  custom-model  " }).transcriptionModel).toBe("custom-model");
    for (const value of [undefined, "", "   "]) {
      expect(getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "configured", OPENAI_TRANSCRIPTION_MODEL: value }))
        .toEqual({ apiKey: "configured", transcriptionModel: "gpt-4o-transcribe" });
    }
    expect(DEFAULT_TRANSCRIPTION_MODEL).toBe("gpt-4o-transcribe");
    // The key is still required.
    expect(() => getOpenAiTranscriptionConfiguration({})).toThrow("OPENAI_API_KEY is required before a transcription request.");
  });
});
