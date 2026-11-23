/**
 * Privacy-safe per-turn timing. Only closed stage names and millisecond durations are ever stored or logged: no text, names,
 * paths or identifiers. It is renderer-side because the stages span the whole turn and no IPC channel may be added.
 */
export const TURN_STAGES = [
  "recording_stopped",
  "transcription_done",
  "interpretation_done",
  "execution_done",
  "response_composed",
  "tts_first_audio",
  "playback_started"
] as const;

export type TurnStage = (typeof TURN_STAGES)[number];
export const MAXIMUM_STAGE_MS = 600_000;
export const TURN_RING_CAPACITY = 20;

export type TurnTimingSummary = Readonly<Partial<Record<TurnStage | "total_to_audio", number>>>;

const isStage = (value: unknown): value is TurnStage =>
  typeof value === "string" && (TURN_STAGES as readonly string[]).includes(value);

const boundedMs = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAXIMUM_STAGE_MS, Math.max(0, Math.round(value))) : 0;

/** Fixed-order, fixed-key line: `turn-timing recording_stopped=0 transcription_done=812 ... total_to_audio=3120`. */
export const formatTurnTiming = (summary: TurnTimingSummary): string => {
  const parts: string[] = [];
  for (const key of [...TURN_STAGES, "total_to_audio"] as const) {
    const value = Object.prototype.hasOwnProperty.call(summary, key) ? summary[key] : undefined;
    if (typeof value === "number" && Number.isFinite(value)) parts.push(`${key}=${boundedMs(value)}`);
  }
  return parts.length === 0 ? "turn-timing" : `turn-timing ${parts.join(" ")}`;
};

export type TurnTimer = {
  /** Records the first time a stage is reached, in milliseconds since the turn started. Unknown stages are ignored. */
  mark: (stage: unknown) => void;
  /** Emits exactly one line, and stores the summary in the bounded ring. Later calls do nothing. */
  finish: () => void;
};

export const createTurnRing = (capacity = TURN_RING_CAPACITY) => {
  const entries: TurnTimingSummary[] = [];
  return {
    push: (summary: TurnTimingSummary): void => {
      entries.push(summary);
      while (entries.length > Math.max(1, capacity)) entries.shift();
    },
    entries: (): readonly TurnTimingSummary[] => [...entries]
  };
};

export const turnRing = createTurnRing();

export const createTurnTimer = (
  log: (line: string) => void,
  now: () => number = () => Date.now(),
  ring: Pick<ReturnType<typeof createTurnRing>, "push"> = turnRing
): TurnTimer => {
  const startedAt = now();
  const reached: Partial<Record<TurnStage, number>> = {};
  let finished = false;
  return {
    mark: (stage) => {
      if (finished || !isStage(stage) || reached[stage] !== undefined) return;
      reached[stage] = boundedMs(now() - startedAt);
    },
    finish: () => {
      if (finished) return;
      finished = true;
      const summary: Partial<Record<TurnStage | "total_to_audio", number>> = { ...reached };
      const audio = reached.playback_started ?? reached.tts_first_audio;
      if (audio !== undefined) summary.total_to_audio = audio;
      ring.push(summary);
      try { log(formatTurnTiming(summary)); } catch { /* timing never affects the turn */ }
    }
  };
};

let currentTurn: TurnTimer | undefined;

/** Starts a new turn; a turn still open is finished first, so every turn emits exactly one line. */
export const beginCurrentTurn = (log: (line: string) => void, now?: () => number): void => {
  currentTurn?.finish();
  currentTurn = createTurnTimer(log, now);
};

export const markCurrentTurn = (stage: unknown): void => currentTurn?.mark(stage);

export const finishCurrentTurn = (): void => {
  currentTurn?.finish();
  currentTurn = undefined;
};
