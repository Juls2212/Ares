import { describe, expect, it, vi } from "vitest";

import {
  createSpeechEndDetector,
  SPEECH_END_SILENCE_MS
} from "../src/renderer/features/voice/speech-end-detector";

const frameHarness = () => {
  let callback: FrameRequestCallback | undefined;
  let time = 0;
  const frames: FrameRequestCallback[] = [];
  const requestFrame = vi.fn((next: FrameRequestCallback) => {
    frames.push(next);
    callback = next;
    return frames.length;
  });
  return {
    requestFrame,
    advance: (nextTime: number) => { time = nextTime; callback?.(time); },
    now: () => time
  };
};

const contextFor = (samples: number[]) => {
  const analyser = {
    fftSize: 256,
    getByteTimeDomainData: (values: Uint8Array) => values.fill(samples.shift() ?? 128)
  };
  return {
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    close: vi.fn(async () => undefined)
  };
};

describe("renderer speech-end detection", () => {
  it("does not end before speech, then stops once after 1.7 seconds of silence", () => {
    const frame = frameHarness();
    const ended = vi.fn();
    const detector = createSpeechEndDetector({
      createAudioContext: () => contextFor([128, 144, 128, 128, 128]),
      now: frame.now,
      requestFrame: frame.requestFrame,
      cancelFrame: vi.fn(),
      onSpeechEnded: ended
    });
    expect(detector.start({} as MediaStream)).toBe(true);
    frame.advance(0);
    expect(ended).not.toHaveBeenCalled();
    frame.advance(100);
    expect(detector.hasDetectedSpeech()).toBe(true);
    frame.advance(200);
    frame.advance(200 + SPEECH_END_SILENCE_MS - 1);
    expect(ended).not.toHaveBeenCalled();
    frame.advance(200 + SPEECH_END_SILENCE_MS);
    expect(ended).toHaveBeenCalledOnce();
    frame.advance(3_000);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("uses a safe unavailable fallback when Web Audio cannot be created", () => {
    const detector = createSpeechEndDetector({ createAudioContext: () => undefined, onSpeechEnded: vi.fn() });
    expect(detector.start({} as MediaStream)).toBe(false);
    expect(detector.hasDetectedSpeech()).toBe(false);
    expect(() => detector.dispose()).not.toThrow();
  });
});
