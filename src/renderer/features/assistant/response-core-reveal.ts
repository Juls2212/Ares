export const RESPONSE_COMPLETION_HOLD_MS = 1_500;
export const RESPONSE_COMPLETION_FADE_MS = 160;

export type ResponseRevealStep = {
  visibleWordCount: number;
  delayMs: number;
};

export type ResponseRevealPlaybackEvent = {
  type: "PLAYING" | "ENDED" | "STOPPED" | "FAILED";
  durationSeconds?: number;
};

type RevealDependencies = {
  onTextChange: (text: string) => void;
  onCompletionFading: () => void;
  onCompletionCleared: () => void;
  prefersReducedMotion: () => boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
};

const terminalPause = /[.!?…]$/u;
const briefPause = /[,;:]$/u;

export const responseWords = (text: string): string[] => text.trim().split(/\s+/u).filter(Boolean);

const wordWeight = (word: string): number => {
  if (terminalPause.test(word)) return 1.45;
  if (briefPause.test(word)) return 1.2;
  return 1;
};

/** Maps word boundaries onto the measured audio timeline without word timestamps. */
export const responseRevealSteps = (text: string, durationSeconds: number): ResponseRevealStep[] => {
  const words = responseWords(text);
  if (words.length === 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const durationMs = Math.max(1, Math.round(durationSeconds * 1_000));
  const totalWeight = words.reduce((total, word) => total + wordWeight(word), 0);
  let elapsed = 0;
  return words.map((_word, index) => {
    if (index === 0) return { visibleWordCount: 1, delayMs: 0 };
    elapsed += Math.round((wordWeight(words[index - 1]) / totalWeight) * durationMs);
    return { visibleWordCount: index + 1, delayMs: index === words.length - 1 ? durationMs : Math.min(durationMs, elapsed) };
  });
};

/** Reveals already-issued response text only after actual playback starts. */
export const createResponseCoreReveal = (overrides: Partial<RevealDependencies> = {}) => {
  const dependencies: RevealDependencies = {
    onTextChange: overrides.onTextChange ?? (() => undefined),
    onCompletionFading: overrides.onCompletionFading ?? (() => undefined),
    onCompletionCleared: overrides.onCompletionCleared ?? (() => undefined),
    prefersReducedMotion: overrides.prefersReducedMotion ?? (() =>
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    ),
    requestFrame: overrides.requestFrame ?? (typeof window !== "undefined" ? window.requestAnimationFrame?.bind(window) : undefined),
    cancelFrame: overrides.cancelFrame ?? (typeof window !== "undefined" ? window.cancelAnimationFrame?.bind(window) : undefined),
    setTimer: overrides.setTimer ?? ((callback, delay) => setTimeout(callback, delay)),
    clearTimer: overrides.clearTimer ?? ((timer) => clearTimeout(timer))
  };
  let frame: number | undefined;
  let completionHoldTimer: ReturnType<typeof setTimeout> | undefined;
  let completionFadeTimer: ReturnType<typeof setTimeout> | undefined;
  let activeText = "";

  const cancelAnimation = (): void => {
    if (frame !== undefined) dependencies.cancelFrame?.(frame);
    frame = undefined;
  };
  const cancelCompletion = (): void => {
    if (completionHoldTimer !== undefined) dependencies.clearTimer(completionHoldTimer);
    if (completionFadeTimer !== undefined) dependencies.clearTimer(completionFadeTimer);
    completionHoldTimer = undefined;
    completionFadeTimer = undefined;
  };
  const cancel = (): void => {
    cancelAnimation();
    cancelCompletion();
  };
  const hide = (): void => {
    cancel();
    dependencies.onTextChange("");
  };
  const clear = (): void => {
    hide();
    activeText = "";
  };
  const showFull = (): void => {
    cancel();
    dependencies.onTextChange(activeText);
  };
  const complete = (): void => {
    showFull();
    if (!activeText) return;
    completionHoldTimer = dependencies.setTimer(() => {
      completionHoldTimer = undefined;
      dependencies.onCompletionFading();
      completionFadeTimer = dependencies.setTimer(() => {
        completionFadeTimer = undefined;
        dependencies.onTextChange("");
        activeText = "";
        dependencies.onCompletionCleared();
      }, RESPONSE_COMPLETION_FADE_MS);
    }, RESPONSE_COMPLETION_HOLD_MS);
  };
  const reveal = (durationSeconds?: number): void => {
    cancel();
    const words = responseWords(activeText);
    if (
      dependencies.prefersReducedMotion() ||
      words.length < 2 ||
      durationSeconds === undefined ||
      !dependencies.requestFrame ||
      !dependencies.cancelFrame
    ) {
      showFull();
      return;
    }
    const steps = responseRevealSteps(activeText, durationSeconds);
    if (steps.length === 0) {
      showFull();
      return;
    }
    let visibleWordCount = 1;
    let startedAt: number | undefined;
    dependencies.onTextChange(words[0]);
    const tick: FrameRequestCallback = (now) => {
      if (startedAt === undefined) startedAt = now;
      const elapsed = Math.max(0, now - startedAt);
      let nextStep: ResponseRevealStep | undefined;
      for (const step of steps) {
        if (step.delayMs > elapsed) break;
        nextStep = step;
      }
      const nextCount = nextStep?.visibleWordCount ?? 1;
      if (nextCount > visibleWordCount) {
        visibleWordCount = nextCount;
        dependencies.onTextChange(words.slice(0, visibleWordCount).join(" "));
      }
      if (elapsed >= steps.at(-1)!.delayMs) {
        frame = undefined;
        return;
      }
      frame = dependencies.requestFrame!(tick);
    };
    frame = dependencies.requestFrame(tick);
  };

  return {
    cancel,
    clear,
    hide,
    replace: (text: string): void => {
      cancel();
      activeText = text;
      dependencies.onTextChange("");
    },
    reveal,
    complete,
    handlePlaybackEvent: (event: ResponseRevealPlaybackEvent): void => {
      if (event.type === "PLAYING") reveal(event.durationSeconds);
      else if (event.type === "FAILED") clear();
      else complete();
    },
    showFull,
    dispose: (): void => {
      cancel();
      activeText = "";
    }
  };
};
