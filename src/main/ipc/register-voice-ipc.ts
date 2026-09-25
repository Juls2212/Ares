import { ipcMain } from "electron";

import {
  VOICE_ERROR_CODES,
  type VoiceOperationResult,
  type VoiceTranscriptionData
} from "../../shared/voice-contracts";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  getVoiceTranscriptionService,
} from "../voice/voice-composition";
import type { VoiceTranscriptionService } from "../voice/voice-transcription-service";

export type VoiceIpcHandler = (input: unknown) => Promise<OperationResult<unknown>>;
export type VoiceIpcHandlerRegistrar = (channel: string, handler: VoiceIpcHandler) => void;

type VoiceIpcDependencies = {
  registerHandler: VoiceIpcHandlerRegistrar;
  getService: () => VoiceTranscriptionService;
  logError: (message: string) => void;
};

const unavailable = (): VoiceOperationResult<VoiceTranscriptionData> => ({
  ok: false,
  error: {
    code: VOICE_ERROR_CODES.ipcUnavailable,
    userMessage: "La transcripción no está disponible en este momento."
  }
});

export const createVoiceIpcRegistration = (dependencies: VoiceIpcDependencies): (() => void) => {
  let registered = false;
  return (): void => {
    if (registered) return;
    dependencies.registerHandler(IPC_CHANNELS.voice.transcribe, async (input) => {
      try {
        return await dependencies.getService().transcribe(input);
      } catch {
        dependencies.logError("Voice transcription IPC handler failed.");
        return unavailable();
      }
    });
    registered = true;
  };
};

const registerElectronHandler: VoiceIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, (_event, input: unknown) => handler(input));
};

export const registerVoiceIpcHandlers = createVoiceIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getVoiceTranscriptionService,
  logError: (message) => console.error(message)
});
