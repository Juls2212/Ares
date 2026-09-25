import { describe, expect, it } from "vitest";

import { getOpenAiConfiguration, getOpenAiTranscriptionConfiguration } from "../src/main/config/openai-environment";

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

  it("requires a separate Main-only transcription model only for transcription", () => {
    expect(getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "configured", OPENAI_TRANSCRIPTION_MODEL: "configured" }))
      .toEqual({ apiKey: "configured", transcriptionModel: "configured" });
    expect(() => getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "configured" }))
      .toThrow("OPENAI_TRANSCRIPTION_MODEL is required before a transcription request.");
  });
});
