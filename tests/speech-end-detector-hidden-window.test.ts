import { describe, expect, it, vi } from "vitest";
import { createSpeechEndDetector } from "../src/renderer/features/voice/speech-end-detector";

describe("silence detection in a hidden window", () => {
  const withGlobals = async (hidden: boolean, run: (calls: { timeouts: number; frames: number; cleared: number[] }) => void) => {
    const calls = { timeouts: 0, frames: 0, cleared: [] as number[] };
    vi.stubGlobal("document", { hidden });
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => { calls.timeouts += 1; void callback; return 7; },
      clearTimeout: (handle: number) => { calls.cleared.push(handle); }
    });
    vi.stubGlobal("requestAnimationFrame", () => { calls.frames += 1; return 3; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try { run(calls); } finally { vi.unstubAllGlobals(); }
  };

  const contextFor = () => ({
    createAnalyser: () => ({ fftSize: 256, getByteTimeDomainData: (values: Uint8Array) => values.fill(128) }),
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    close: vi.fn(async () => undefined)
  });

  it("polls with a timer instead of an animation frame when the document is hidden, and cancels it", async () => {
    await withGlobals(true, (calls) => {
      const detector = createSpeechEndDetector({ createAudioContext: contextFor as never, onSpeechEnded: vi.fn() });
      expect(detector.start({} as MediaStream)).toBe(true);
      expect(calls.timeouts).toBe(1);
      expect(calls.frames).toBe(0);
      detector.dispose();
      expect(calls.cleared).toEqual([7]);
    });
  });

  it("keeps using animation frames while the document is visible", async () => {
    await withGlobals(false, (calls) => {
      const detector = createSpeechEndDetector({ createAudioContext: contextFor as never, onSpeechEnded: vi.fn() });
      detector.start({} as MediaStream);
      expect(calls.frames).toBe(1);
      expect(calls.timeouts).toBe(0);
      detector.dispose();
    });
  });
});
