import { createVoiceTranscriptionService, type VoiceTranscriptionService } from "./voice-transcription-service";

let voiceTranscriptionService: VoiceTranscriptionService | undefined;

export const getVoiceTranscriptionService = (): VoiceTranscriptionService => {
  voiceTranscriptionService ??= createVoiceTranscriptionService();
  return voiceTranscriptionService;
};
