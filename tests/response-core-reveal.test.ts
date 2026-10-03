import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string): string => readFileSync(file, "utf8");

describe("core response reveal", () => {
  it("keeps the response hidden until the real playback event begins the animation-frame timeline", () => {
    const reveal = source("src/renderer/features/assistant/response-core-reveal.ts");

    expect(reveal).toContain('if (event.type === "PLAYING") reveal(event.durationSeconds);');
    expect(reveal).toContain("requestFrame");
    expect(reveal).toContain("const tick: FrameRequestCallback");
    expect(reveal).not.toContain("steps.slice(1).forEach");
  });

  it("uses word boundaries with restrained punctuation timing rather than per-word timers", () => {
    const reveal = source("src/renderer/features/assistant/response-core-reveal.ts");

    expect(reveal).toContain("const terminalPause = /[.!?…]$/u;");
    expect(reveal).toContain("const briefPause = /[,;:]$/u;");
    expect(reveal).toContain("visibleWordCount");
    expect(reveal).toContain("words.slice(0, visibleWordCount).join(\" \")");
  });

  it("holds terminal text for 1.5 seconds, fades it, then clears it", () => {
    const reveal = source("src/renderer/features/assistant/response-core-reveal.ts");

    expect(reveal).toContain("export const RESPONSE_COMPLETION_HOLD_MS = 1_500;");
    expect(reveal).toContain("export const RESPONSE_COMPLETION_FADE_MS = 160;");
    expect(reveal).toContain("dependencies.onCompletionFading();");
    expect(reveal).toContain("dependencies.onCompletionCleared();");
  });

  it("clears stale text on failure, replacement, and disposal", () => {
    const reveal = source("src/renderer/features/assistant/response-core-reveal.ts");

    expect(reveal).toContain('else if (event.type === "FAILED") clear();');
    expect(reveal).toContain("replace: (text: string): void => {");
    expect(reveal).toContain("dispose: (): void => {");
    expect(reveal).toContain("cancelAnimation();");
    expect(reveal).toContain("cancelCompletion();");
  });

  it("shows complete text immediately for reduced motion without scheduling animation frames", () => {
    const reveal = source("src/renderer/features/assistant/response-core-reveal.ts");

    expect(reveal).toContain("dependencies.prefersReducedMotion()");
    expect(reveal).toContain("showFull();");
  });

  it("uses a text-only floating core overlay and never reinstates a response card", () => {
    const component = source("src/renderer/components/particle-orb.tsx");
    const styles = source("src/renderer/styles/ares.css");

    expect(component).toContain("particle-orb__response--${responsePhase.toLowerCase()}");
    expect(component).not.toContain("particle-orb__response-card");
    expect(styles).toContain(".particle-orb__response--fading { opacity: 0; }");
    expect(styles).not.toContain(".particle-orb__response-card");
  });
});
