import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AresApi,
  type OperationResult,
  type SystemCapabilities,
  type SystemStatusData
} from "../shared/contracts";
import type {
  ActionLifecycleResult,
  ActionOperationResult,
  ActionOutcome,
  ActionSubmission
} from "../shared/action-contracts";
import type {
  ContactFormCancellation,
  ContactFormCancellationData,
  ContactFormRequest,
  ContactFormSubmission,
  ContactFormSubmissionData,
  MessagingOperationResult
} from "../shared/messaging-contracts";
import type {
  AssistantInterpretRequest,
  AssistantInterpretation,
  AssistantOperationResult
} from "../shared/assistant-contracts";
import type {
  VoiceOperationResult,
  VoiceTranscriptionData,
  VoiceTranscriptionInput
} from "../shared/voice-contracts";
import type {
  SettingsOperationResult,
  VoicePreferencesData
} from "../shared/settings-contracts";

const aresApi = {
  system: {
    getStatus: () =>
      ipcRenderer.invoke(IPC_CHANNELS.system.getStatus) as Promise<
        OperationResult<SystemStatusData>
      >,
    getCapabilities: () =>
      ipcRenderer.invoke(IPC_CHANNELS.system.getCapabilities) as Promise<
        OperationResult<SystemCapabilities>
      >
  },
  actions: {
    propose: (submission: ActionSubmission) =>
      ipcRenderer.invoke(IPC_CHANNELS.actions.propose, submission) as Promise<
        ActionOperationResult<ActionLifecycleResult>
      >,
    confirm: (confirmationId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.actions.confirm, confirmationId) as Promise<
        ActionOperationResult<ActionOutcome>
      >,
    cancel: (confirmationId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.actions.cancel, confirmationId) as Promise<
        ActionOperationResult<ActionOutcome>
      >
  },
  assistant: {
    interpret: (input: AssistantInterpretRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.assistant.interpret, input) as Promise<
        AssistantOperationResult<AssistantInterpretation>
      >
  },
  voice: {
    transcribe: (input: VoiceTranscriptionInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.voice.transcribe, input) as Promise<
        VoiceOperationResult<VoiceTranscriptionData>
      >,
    onGlobalShortcut: (callback: () => void) => {
      const listener = (): void => callback();
      ipcRenderer.on(IPC_CHANNELS.voice.globalShortcutActivated, listener);
      return (): void => {
        ipcRenderer.removeListener(IPC_CHANNELS.voice.globalShortcutActivated, listener);
      };
    }
  },
  messaging: {
    onContactFormRequested: (callback: (request: ContactFormRequest) => void) => {
      const listener = (_event: unknown, request: ContactFormRequest): void => callback(request);
      ipcRenderer.on(IPC_CHANNELS.messaging.contactFormRequested, listener);
      return (): void => {
        ipcRenderer.removeListener(IPC_CHANNELS.messaging.contactFormRequested, listener);
      };
    },
    submitContactForm: (input: ContactFormSubmission) =>
      ipcRenderer.invoke(IPC_CHANNELS.messaging.submitContactForm, input) as Promise<
        MessagingOperationResult<ContactFormSubmissionData>
      >,
    cancelContactForm: (input: ContactFormCancellation) =>
      ipcRenderer.invoke(IPC_CHANNELS.messaging.cancelContactForm, input) as Promise<
        MessagingOperationResult<ContactFormCancellationData>
      >
  },
  speech: {
    speak: (input: { responseId: string }) => ipcRenderer.invoke(IPC_CHANNELS.speech.speak, input) as Promise<OperationResult<import("../shared/speech-contracts").SpeechAudio>>
  },
  settings: {
    voice: {
      get: () =>
        ipcRenderer.invoke(IPC_CHANNELS.settings.voice.get) as Promise<
          SettingsOperationResult<VoicePreferencesData>
        >
    }
  }
} satisfies AresApi;

contextBridge.exposeInMainWorld("ares", aresApi);
