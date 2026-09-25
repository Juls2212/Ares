export type VoiceShortcutState = "IDLE" | "RECORDING" | "PROCESSING";

export type GlobalVoiceShortcutController = {
  activate: () => void;
};

/** Renderer-only toggle policy; it never invokes transcription or assistant actions itself. */
export const createGlobalVoiceShortcutController = (dependencies: {
  getState: () => VoiceShortcutState;
  startRecording: () => void;
  stopRecording: () => void;
}): GlobalVoiceShortcutController => ({
  activate: (): void => {
    const state = dependencies.getState();
    if (state === "IDLE") dependencies.startRecording();
    if (state === "RECORDING") dependencies.stopRecording();
  }
});
