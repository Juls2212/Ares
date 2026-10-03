import { SPEECH_LIMITS, type SpeechApi } from "../../../shared/speech-contracts";

export type PlaybackState = "IDLE" | "LOADING" | "PLAYING" | "FINISHED" | "ERROR";
export type PlaybackEvent = {
  type: "PLAYING" | "ENDED" | "STOPPED" | "FAILED";
  responseId: string;
  durationSeconds?: number;
};
export type PlaybackFailure = "MAIN_RESULT" | "AUDIO_VALIDATION" | "OBJECT_URL" | "AUDIO_PLAYBACK" | "PLAY_NOT_ALLOWED" | "PLAY_NOT_SUPPORTED" | "PLAY_ABORTED" | "PLAY_START_TIMEOUT" | "NO_PLAYING_EVENT";
export type PlaybackDiagnostic = "MP3_RECEIVED" | "BLOB_READY" | "LOADED_METADATA" | "CAN_PLAY" | "PLAYING" | "ENDED" | "STOPPED" | "MEDIA_ABORTED" | "MEDIA_NETWORK" | "MEDIA_DECODE" | "MEDIA_UNSUPPORTED" | "MEDIA_UNKNOWN";

export const createResponsePlayback = (dependencies: {
  speak: SpeechApi["speak"];
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  createAudio: (url: string) => HTMLAudioElement;
  onState: (state: PlaybackState) => void;
  onFailure?: (category: PlaybackFailure) => void;
  onDiagnostic?: (category: PlaybackDiagnostic) => void;
  onPlaybackEvent?: (event: PlaybackEvent) => void;
}) => {
  let generation = 0;
  let audio: HTMLAudioElement | undefined;
  let url: string | undefined;
  let busy = false;
  let activeResponseId: string | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const release = (event?: PlaybackEvent["type"]): void => {
    const responseId = activeResponseId;
    generation++; busy = false;
    if (startTimer) clearTimeout(startTimer);
    startTimer = undefined;
    if (audio) {
      audio.onloadedmetadata = null; audio.oncanplay = null; audio.onplaying = null;
      audio.onended = null; audio.onerror = null;
      audio.pause(); audio.removeAttribute("src"); audio.load();
      dependencies.onDiagnostic?.("STOPPED");
    }
    if (url) dependencies.revokeUrl(url);
    audio = undefined; url = undefined; activeResponseId = undefined;
    if (event && responseId) dependencies.onPlaybackEvent?.({ type: event, responseId });
    dependencies.onState("IDLE");
  };
  const stop = (): void => release("STOPPED");
  return {
    stop,
    async play(responseId: string): Promise<void> {
      if (busy) return;
      stop(); busy = true; const current = generation;
      activeResponseId = responseId;
      dependencies.onState("LOADING");
      let category: PlaybackFailure = "MAIN_RESULT";
      try {
        const result = await dependencies.speak({ responseId });
        if (current !== generation) return;
        if (!result.ok) throw new Error("PLAYBACK_UNAVAILABLE");
        category = "AUDIO_VALIDATION";
        if (result.data.mimeType !== "audio/mpeg" || !(result.data.audio instanceof ArrayBuffer) || !result.data.audio.byteLength || result.data.audio.byteLength > SPEECH_LIMITS.audioBytes) throw new Error("PLAYBACK_UNAVAILABLE");
        dependencies.onDiagnostic?.("MP3_RECEIVED");
        category = "OBJECT_URL";
        const blob = new Blob([result.data.audio], { type: "audio/mpeg" });
        if (blob.size !== result.data.audio.byteLength || blob.type !== "audio/mpeg") throw new Error("BLOB_INVALID");
        url = dependencies.createUrl(blob);
        dependencies.onDiagnostic?.("BLOB_READY");
        audio = dependencies.createAudio(url);
        const player = audio;
        let started = false;
        player.muted = false; player.volume = 1;
        player.onloadedmetadata = () => { if (current === generation) dependencies.onDiagnostic?.("LOADED_METADATA"); };
        player.oncanplay = () => { if (current === generation) dependencies.onDiagnostic?.("CAN_PLAY"); };
        player.onplaying = () => {
          if (current !== generation) return;
          started = true;
          if (startTimer) clearTimeout(startTimer);
          startTimer = undefined;
          dependencies.onDiagnostic?.("PLAYING");
          dependencies.onState("PLAYING");
          const durationSeconds = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : undefined;
          dependencies.onPlaybackEvent?.({ type: "PLAYING", responseId, durationSeconds });
        };
        player.onended = () => {
          if (current !== generation) return;
          if (!started) {
            dependencies.onFailure?.("NO_PLAYING_EVENT"); release("FAILED"); dependencies.onState("ERROR"); return;
          }
          dependencies.onDiagnostic?.("ENDED");
          release("ENDED"); dependencies.onState("FINISHED");
        };
        category = "AUDIO_PLAYBACK";
        player.onerror = () => {
          if (current !== generation) return;
          const categories: Record<number, PlaybackDiagnostic> = { 1: "MEDIA_ABORTED", 2: "MEDIA_NETWORK", 3: "MEDIA_DECODE", 4: "MEDIA_UNSUPPORTED" };
          dependencies.onDiagnostic?.(categories[player.error?.code ?? 0] ?? "MEDIA_UNKNOWN");
          dependencies.onFailure?.("AUDIO_PLAYBACK"); release("FAILED"); dependencies.onState("ERROR");
        };
        startTimer = setTimeout(() => {
          if (current !== generation) return;
          dependencies.onFailure?.("PLAY_START_TIMEOUT"); release("FAILED"); dependencies.onState("ERROR");
        }, SPEECH_LIMITS.timeoutMs);
        await player.play();
      } catch (error) {
        if (current === generation) {
          const name = error instanceof Error ? error.name : "";
          if (category === "AUDIO_PLAYBACK") category = name === "NotAllowedError" ? "PLAY_NOT_ALLOWED" : name === "NotSupportedError" ? "PLAY_NOT_SUPPORTED" : name === "AbortError" ? "PLAY_ABORTED" : "AUDIO_PLAYBACK";
          dependencies.onFailure?.(category); release("FAILED"); dependencies.onState("ERROR");
        }
      }
    }
  };
};
