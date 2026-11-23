import { defineFailureTaxonomy } from "./failure-taxonomy";
import { VOICE_ERROR_CODES } from "./voice-contracts";

/**
 * Privacy-safe diagnostics for one voice attempt. Everything recorded here is a fixed enum or a bounded number: never audio,
 * a transcript, a device name or any text the person said. Every input is sanitized again when the line is formatted, so even
 * a hostile value (a secret in an error name, a transcript in a mime type) cannot reach the log.
 */

/** The stages of one attempt in the order they are reached. */
export const VOICE_STAGES = [
  "shortcut_or_click",
  "permission_checked",
  "stream_opened",
  "recorder_started",
  "recorder_stopped",
  "blob_ready",
  "ipc_submitted",
  "transcription_started",
  "transcription_done"
] as const;
export type VoiceStage = (typeof VOICE_STAGES)[number];

export const MICROPHONE_ACCESS_STATUSES = ["granted", "denied", "restricted", "not-determined", "unknown"] as const;
export type MicrophoneAccessStatus = (typeof MICROPHONE_ACCESS_STATUSES)[number];

export const MIME_FAMILIES = ["webm", "ogg", "mp4", "other"] as const;
export type MimeFamily = (typeof MIME_FAMILIES)[number];

export const SIZE_BUCKETS = ["0", "<1KB", "<10KB", "<100KB", "bigger"] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

/** How loud the loudest moment of the recording was, from the level analyser: «speech» means the speech threshold was reached. */
export const PEAK_LEVELS = ["silent", "low", "speech"] as const;
export type PeakLevel = (typeof PEAK_LEVELS)[number];

export const ANALYSIS_STATES = ["ok", "unavailable"] as const;
export type AnalysisState = (typeof ANALYSIS_STATES)[number];

/** The DOM error names getUserMedia and MediaRecorder can raise; any other name is recorded as «other». */
export const CAPTURE_ERROR_NAMES = [
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OverconstrainedError",
  "AbortError",
  "SecurityError"
] as const;
export type CaptureErrorName = (typeof CAPTURE_ERROR_NAMES)[number];

/**
 * Closed failure taxonomy of voice capture and transcription as the person experiences it. Messages are fixed Spanish
 * sentences with no user data. Several keep the exact text the recorder and the transcription service already used.
 */
export const VOICE_CAPTURE_FAILURES = defineFailureTaxonomy({
  VOICE_CAPTURE_SYSTEM_DENIED: "Windows tiene bloqueado el micrófono para Ares. Actívalo en Configuración, Privacidad, Micrófono.",
  VOICE_CAPTURE_PERMISSION_DENIED: "No se puede usar el micrófono. Revisa los permisos.",
  VOICE_CAPTURE_NO_DEVICE: "No encontré ningún micrófono. Conecta uno e inténtalo de nuevo.",
  VOICE_CAPTURE_DEVICE_BUSY: "El micrófono está ocupado o no se puede leer. Cierra otras aplicaciones que lo usen.",
  VOICE_CAPTURE_UNKNOWN: "No se puede usar el micrófono. Revisa los permisos.",
  VOICE_CAPTURE_EMPTY_RECORDING: "No se recibió audio para transcribir.",
  VOICE_CAPTURE_RECORDER_UNSUPPORTED: "Este navegador no puede grabar audio compatible.",
  VOICE_TRANSCRIPTION_FAILED: "La transcripción no está disponible en este momento.",
  VOICE_TRANSCRIPT_EMPTY: "No se entendió lo que dijiste. Inténtalo de nuevo."
});
export type VoiceFailureCode = (typeof VOICE_CAPTURE_FAILURES.codes)[number];

/** Exhaustive by type: every known DOM error name must be mapped, and the system-level denial is decided separately. */
const FAILURE_BY_ERROR_NAME: Record<CaptureErrorName, VoiceFailureCode> = {
  NotAllowedError: "VOICE_CAPTURE_PERMISSION_DENIED",
  SecurityError: "VOICE_CAPTURE_PERMISSION_DENIED",
  NotFoundError: "VOICE_CAPTURE_NO_DEVICE",
  OverconstrainedError: "VOICE_CAPTURE_NO_DEVICE",
  NotReadableError: "VOICE_CAPTURE_DEVICE_BUSY",
  AbortError: "VOICE_CAPTURE_DEVICE_BUSY"
};

const isCaptureErrorName = (value: unknown): value is CaptureErrorName =>
  typeof value === "string" && Object.hasOwn(FAILURE_BY_ERROR_NAME, value);

/** The name of a thrown value, or undefined when it has none; only the name is ever read. */
export const errorNameOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "name" in error ? (error as { name: unknown }).name : undefined;

/**
 * Maps a getUserMedia or MediaRecorder error name to a closed failure code. An unknown name, or no name, becomes
 * VOICE_CAPTURE_UNKNOWN. A permission error while the system reports the microphone as denied or restricted is the
 * system-level denial.
 */
export const failureCodeForCaptureError = (name: unknown, microphone: MicrophoneAccessStatus = "unknown"): VoiceFailureCode => {
  if (!isCaptureErrorName(name)) return "VOICE_CAPTURE_UNKNOWN";
  if (FAILURE_BY_ERROR_NAME[name] === "VOICE_CAPTURE_PERMISSION_DENIED" && (microphone === "denied" || microphone === "restricted")) {
    return "VOICE_CAPTURE_SYSTEM_DENIED";
  }
  return FAILURE_BY_ERROR_NAME[name];
};

/** Maps a transcription error code from Main to the closed voice failure; unknown codes are a plain transcription failure. */
export const failureCodeForTranscription = (code: unknown): VoiceFailureCode => {
  if (code === VOICE_ERROR_CODES.audioEmpty) return "VOICE_CAPTURE_EMPTY_RECORDING";
  if (code === VOICE_ERROR_CODES.transcriptEmpty) return "VOICE_TRANSCRIPT_EMPTY";
  return "VOICE_TRANSCRIPTION_FAILED";
};

export const normalizeMicrophoneAccess = (value: unknown): MicrophoneAccessStatus =>
  typeof value === "string" && (MICROPHONE_ACCESS_STATUSES as readonly string[]).includes(value) ? (value as MicrophoneAccessStatus) : "unknown";

export const mimeFamilyOf = (value: unknown): MimeFamily => {
  if (typeof value !== "string") return "other";
  const head = value.trim().toLowerCase();
  return head.startsWith("audio/webm") ? "webm" : head.startsWith("audio/ogg") ? "ogg" : head.startsWith("audio/mp4") ? "mp4" : "other";
};

export const sizeBucketOf = (bytes: unknown): SizeBucket => {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "0";
  return bytes < 1_024 ? "<1KB" : bytes < 10_240 ? "<10KB" : bytes < 102_400 ? "<100KB" : "bigger";
};

/** Maps a raw RMS level to the closed peak enum (the speech threshold is the one the end-of-speech detector uses). */
export const peakLevelOf = (rms: unknown, speechThreshold: number): PeakLevel =>
  typeof rms !== "number" || !Number.isFinite(rms) || rms < 0.005 ? "silent" : rms < speechThreshold ? "low" : "speech";

const boundedInteger = (value: unknown, maximum: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.trunc(value))) : undefined;

/** The raw facts of one attempt. Every field is unknown on purpose: it is sanitized when formatted. */
export type VoiceDiagnosticFacts = {
  side?: unknown;
  stage?: unknown;
  microphone?: unknown;
  devices?: unknown;
  mime?: unknown;
  bytes?: unknown;
  durationMs?: unknown;
  errorName?: unknown;
  failure?: unknown;
  peak?: unknown;
  analysis?: unknown;
};

/**
 * Formats one fixed-order, key=value diagnostic line from raw facts. Each present field is reduced to a closed enum or a
 * bounded integer; an unknown stage, status or code prints its fallback and never the input.
 */
export const formatVoiceDiagnostic = (facts: VoiceDiagnosticFacts): string => {
  const parts: string[] = ["voice-diag"];
  const add = (key: string, value: string | number | undefined): void => {
    if (value !== undefined) parts.push(`${key}=${value}`);
  };
  add("side", facts.side === undefined ? undefined : facts.side === "main" ? "main" : "renderer");
  add("stage", facts.stage === undefined ? undefined : (VOICE_STAGES as readonly unknown[]).includes(facts.stage) ? (facts.stage as string) : "invalid");
  add("mic", facts.microphone === undefined ? undefined : normalizeMicrophoneAccess(facts.microphone));
  add("devices", boundedInteger(facts.devices, 99));
  add("mime", facts.mime === undefined ? undefined : mimeFamilyOf(facts.mime));
  add("size", facts.bytes === undefined ? undefined : sizeBucketOf(facts.bytes));
  add("durationMs", boundedInteger(facts.durationMs, 600_000));
  add("peak", facts.peak === undefined ? undefined : (PEAK_LEVELS as readonly unknown[]).includes(facts.peak) ? (facts.peak as string) : "silent");
  add("analysis", facts.analysis === undefined ? undefined : (ANALYSIS_STATES as readonly unknown[]).includes(facts.analysis) ? (facts.analysis as string) : "unavailable");
  add("error", facts.errorName === undefined ? undefined : isCaptureErrorName(facts.errorName) ? facts.errorName : "other");
  add("failure", facts.failure === undefined ? undefined : VOICE_CAPTURE_FAILURES.isCode(facts.failure) ? facts.failure : "invalid");
  return parts.join(" ");
};

/** The narrow surface the recorder uses to report what happened; nothing else of the attempt is visible to it. */
export type VoiceAttemptReporter = {
  reach: (stage: VoiceStage) => void;
  facts: (facts: VoiceDiagnosticFacts) => void;
  fail: (failure: VoiceFailureCode, errorName?: unknown) => void;
};

export type VoiceAttempt = VoiceAttemptReporter & {
  /** Emits the single line of the attempt (once) with the furthest stage reached. */
  finish: () => void;
};

/** One attempt: accumulates stages and facts, and emits exactly one line through `log` when it finishes or fails. */
export const createVoiceAttempt = (log: (line: string) => void): VoiceAttempt => {
  let furthest = -1;
  let facts: VoiceDiagnosticFacts = { side: "renderer" };
  let emitted = false;
  const emit = (): void => {
    if (emitted) return;
    emitted = true;
    try {
      log(formatVoiceDiagnostic({ ...facts, stage: furthest >= 0 ? VOICE_STAGES[furthest] : undefined }));
    } catch {
      // Diagnostics must never affect the attempt.
    }
  };
  return {
    reach: (stage) => {
      const index = VOICE_STAGES.indexOf(stage);
      if (index > furthest) furthest = index;
    },
    facts: (more) => {
      facts = { ...facts, ...Object.fromEntries(Object.entries(more).filter(([, value]) => value !== undefined)) };
    },
    fail: (failure, errorName) => {
      facts = { ...facts, failure, ...(errorName === undefined ? {} : { errorName }) };
      emit();
    },
    finish: emit
  };
};
