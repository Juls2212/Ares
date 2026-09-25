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
  start: () => void;
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
  onAudio: (audio: Blob, mimeType: VoiceMimeType) => void;
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
  let chunks: BlobPart[] = [];

  const release = (): void => {
    if (timer !== undefined) dependencies.clearTimer(timer);
    timer = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    recorder = undefined;
  };

  const stop = (): void => {
    if (!recorder || recorder.state !== "recording") return;
    dependencies.onProcessing();
    recorder.stop();
  };

  return {
    async start(): Promise<void> {
      if (recorder?.state === "recording") return;
      const mimeType = firstSupportedMimeType(dependencies.isMimeTypeSupported);
      if (!mimeType) {
        dependencies.onUnavailable("Este navegador no puede grabar audio compatible.");
        return;
      }
      cancelled = false;
      chunks = [];
      try {
        stream = await dependencies.getUserMedia();
        recorder = dependencies.createRecorder(stream, mimeType);
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          const activeMimeType = firstSupportedMimeType((candidate) => candidate === recorder?.mimeType) ?? mimeType;
          const audio = dependencies.createBlob(chunks, { type: activeMimeType });
          const wasCancelled = cancelled;
          release();
          if (wasCancelled) {
            dependencies.onCancelled();
          } else if (audio.size === 0) {
            dependencies.onUnavailable("No se recibió audio para transcribir.");
          } else if (audio.size > VOICE_MAX_AUDIO_BYTES) {
            dependencies.onUnavailable("La grabación es demasiado larga para transcribirla.");
          } else {
            dependencies.onAudio(audio, activeMimeType);
          }
          chunks = [];
        };
        recorder.start();
        timer = dependencies.setTimer(stop, VOICE_MAX_RECORDING_DURATION_MS);
        dependencies.onRecording();
      } catch (error) {
        release();
        const reason = isPermissionFailure(error) && dependencies.isUserActivationActive?.() === false
          ? "USER_GESTURE_REQUIRED"
          : "MICROPHONE_UNAVAILABLE";
        dependencies.onUnavailable("No se puede usar el micrófono. Revisa los permisos.", reason);
      }
    },
    stop,
    cancel(): void {
      cancelled = true;
      if (recorder?.state === "recording") {
        recorder.stop();
      } else {
        release();
        dependencies.onCancelled();
      }
    },
    dispose(): void {
      cancelled = true;
      if (recorder?.state === "recording") recorder.stop();
      else release();
    }
  };
};
