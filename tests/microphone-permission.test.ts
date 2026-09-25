import { describe, expect, it } from "vitest";
import {
  isTrustedAudioMicrophoneRequest,
  isTrustedMicrophoneRequest
} from "../src/main/voice/microphone-permission";

describe("trusted microphone permission", () => {
  it("allows only the approved development or packaged renderer origin", () => {
    expect(isTrustedMicrophoneRequest("http://localhost:5173/", "http://localhost:5173/voice")).toBe(true);
    expect(isTrustedMicrophoneRequest("http://127.0.0.1:5173/", "http://127.0.0.1:5173")).toBe(true);
    expect(isTrustedMicrophoneRequest("http://localhost:5173", "https://evil.example")).toBe(false);
    expect(isTrustedMicrophoneRequest("file:///app/index.html", "file:///app/index.html")).toBe(true);
    expect(isTrustedMicrophoneRequest("file:///app/index.html", "https://evil.example")).toBe(false);
    expect(isTrustedMicrophoneRequest("https://evil.example", "https://evil.example")).toBe(false);
  });

  it("grants only audio media requests from the trusted Main-frame webContents", () => {
    const trustedWebContentsIds = new Set([7]);
    const request = {
      trustedWebContentsIds,
      webContentsId: 7,
      loadedUrl: "http://127.0.0.1:5173/",
      requestingUrlOrOrigin: "http://127.0.0.1:5173/",
      isMainFrame: true,
      mediaTypes: ["audio"]
    };
    expect(isTrustedAudioMicrophoneRequest(request)).toBe(true);
    expect(isTrustedAudioMicrophoneRequest({ ...request, mediaTypes: ["video"] })).toBe(false);
    expect(isTrustedAudioMicrophoneRequest({ ...request, mediaTypes: ["audio", "video"] })).toBe(false);
    expect(isTrustedAudioMicrophoneRequest({ ...request, isMainFrame: false })).toBe(false);
    expect(isTrustedAudioMicrophoneRequest({ ...request, webContentsId: 8 })).toBe(false);
    expect(isTrustedAudioMicrophoneRequest({ ...request, requestingUrlOrOrigin: "https://evil.example" })).toBe(false);
  });
});
