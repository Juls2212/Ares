import {
  VOICE_ALLOWED_MIME_TYPES,
  VOICE_MAX_AUDIO_BYTES,
  VOICE_MAX_RECORDING_DURATION_MS,
  type VoiceMimeType
} from "../../../shared/voice-contracts";

type RecorderLike = {
  mimeType: string;
  state: "inactive" | "recording" | "paused";
  ondataavailable: ((event: BlobEvent) => unknown) | null;
  onstop: ((event: Event) => unknown) | null;
  start: (timeslice?: number) => void;
  stop: () => void;
};

type StreamLike = { getTracks: () => Array<{ stop: () => void }> };

export type ManualVoiceRecorder = {
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  dispose: () => void;
};

export type VoiceCaptureUnavailableReason =
  | "MICROPHONE_UNAVAILABLE"
  | "USER_GESTURE_REQUIRED";

export type ManualVoiceRecorderDependencies = {
  getUserMedia: () => Promise<StreamLike>;
  createRecorder: (stream: StreamLike, mimeType: VoiceMimeType) => RecorderLike;
  isMimeTypeSupported: (mimeType: string) => boolean;
  createBlob: (parts: BlobPart[], options: BlobPropertyBag) => Blob;
  setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  onRecording: () => void;
  onProcessing: () => void;
  onUnavailable: (message: string, reason?: VoiceCaptureUnavailableReason) => void;
  onCancelled: () => void;
  onAudio: (audio: Blob, mimeType: VoiceMimeType, durationMs: number) => void;
  now?: () => number;
  isUserActivationActive?: () => boolean;
};

const isPermissionFailure = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "name" in error && error.name === "NotAllowedError";

const firstSupportedMimeType = (
  isSupported: (mimeType: string) => boolean
): VoiceMimeType | undefined => VOICE_ALLOWED_MIME_TYPES.find(isSupported);

/** Browser-only bounded manual capture. It has no IPC or transcription dependency. */
export const createManualVoiceRecorder = (
  dependencies: ManualVoiceRecorderDependencies
): ManualVoiceRecorder => {
  let stream: StreamLike | undefined;
  let recorder: RecorderLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let disposed = false;
  let starting = false;
  let stopping = false;
  let bytes = 0;
  let startedAt = 0;
  const now = dependencies.now ?? (() => performance.now());
  let chunks: BlobPart[] = [];

  const release = (): void => {
    if (timer !== undefined) dependencies.clearTimer(timer);
    timer = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    recorder = undefined;
  };

  const stop = (): void => {
    if (!recorder || stopping || recorder.state !== "recording") return;
    stopping = true;
    if (timer !== undefined) dependencies.clearTimer(timer);
    timer = undefined;
    dependencies.onProcessing();
    recorder.stop();
  };

  const cancel = (): void => {
    if (!recorder && !starting) return;
    cancelled = true;
    if (recorder?.state === "recording") recorder.stop();
    else if (!starting) { release(); chunks = []; dependencies.onCancelled(); }
  };

  return {
    async start(): Promise<void> {
      if (disposed || starting || recorder) return;
      const mimeType = firstSupportedMimeType(dependencies.isMimeTypeSupported);
      if (!mimeType) {
        dependencies.onUnavailable("Este navegador no puede grabar audio compatible.");
        return;
      }
      cancelled = false;
      stopping = false;
      starting = true;
      bytes = 0;
      chunks = [];
      try {
        stream = await dependencies.getUserMedia();
        if (cancelled || disposed) { release(); dependencies.onCancelled(); return; }
        recorder = dependencies.createRecorder(stream, mimeType);
        recorder.ondataavailable = (event) => {
          if (cancelled || disposed) return;
          bytes += event.data.size;
          if (bytes > VOICE_MAX_AUDIO_BYTES) { cancel(); return; }
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          if (!recorder) return;
          const activeMimeType = firstSupportedMimeType((candidate) => candidate === recorder?.mimeType) ?? mimeType;
          const audio = dependencies.createBlob(chunks, { type: activeMimeType });
          const wasCancelled = cancelled || disposed;
          const durationMs = Math.max(1, Math.ceil(now() - startedAt));
          release();
          if (wasCancelled) {
            dependencies.onCancelled();
          } else if (audio.size === 0) {
            dependencies.onUnavailable("No se recibió audio para transcribir.");
          } else if (audio.size > VOICE_MAX_AUDIO_BYTES || durationMs > VOICE_MAX_RECORDING_DURATION_MS) {
            dependencies.onUnavailable("La grabación es demasiado larga para transcribirla.");
          } else {
            dependencies.onAudio(audio, activeMimeType, durationMs);
          }
          chunks = [];
        };
        startedAt = now();
        recorder.start(250);
        timer = dependencies.setTimer(cancel, VOICE_MAX_RECORDING_DURATION_MS);
        dependencies.onRecording();
      } catch (error) {
        release();
        const reason = isPermissionFailure(error) && dependencies.isUserActivationActive?.() === false
          ? "USER_GESTURE_REQUIRED"
          : "MICROPHONE_UNAVAILABLE";
        dependencies.onUnavailable("No se puede usar el micrófono. Revisa los permisos.", reason);
      } finally {
        starting = false;
      }
    },
    stop,
    cancel,
    dispose(): void {
      disposed = true;
      cancel();
    }
  };
};
