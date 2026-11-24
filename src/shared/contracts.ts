export type OperationSuccess<T> = {
  ok: true;
  data: T;
};

export type OperationFailure = {
  ok: false;
  error: {
    code: string;
    userMessage: string;
    /** A Main-issued, window-bound reference for optional speech playback. */
    spokenResponse?: import("./speech-contracts").SpokenResponse;
  };
};

export type OperationResult<T> = OperationSuccess<T> | OperationFailure;

export type SystemReadiness = "READY";

export type SystemStatusData = {
  applicationName: string;
  applicationVersion: string;
  runtimePlatform: NodeJS.Platform;
  readiness: SystemReadiness;
  /** The operating system's microphone access status for Ares: a closed enum, present only when Main could read it. */
  microphoneAccess?: "granted" | "denied" | "restricted" | "not-determined" | "unknown";
};

export type SystemCapabilities = {
  database: boolean;
  dashboard: boolean;
  planner: boolean;
  files: boolean;
  applications: boolean;
  assistant: boolean;
  voice: boolean;
  notifications: boolean;
};

export type SystemApi = {
  getStatus: () => Promise<OperationResult<SystemStatusData>>;
  getCapabilities: () => Promise<OperationResult<SystemCapabilities>>;
};

export type AresApi = {
  system: SystemApi;
  actions: ActionApi;
  assistant: AssistantApi;
  voice: VoiceApi;
  speech: import("./speech-contracts").SpeechApi;
  settings: SettingsApi;
  theme: import("./theme-contracts").ThemeApi;
  messaging: import("./messaging-contracts").MessagingApi;
};

export const IPC_CHANNELS = {
  system: {
    getStatus: "system:get-status",
    getCapabilities: "system:get-capabilities"
  },
  actions: {
    propose: "actions:propose",
    confirm: "actions:confirm",
    cancel: "actions:cancel"
  },
  assistant: {
    interpret: "assistant:interpret"
  },
  voice: {
    transcribe: "voice:transcribe",
    globalShortcutActivated: "voice:global-shortcut-activated"
  },
  speech: { speak: "speech:speak" },
  messaging: {
    contactFormRequested: "messaging:contact-form-requested",
    submitContactForm: "messaging:contact-form:submit",
    cancelContactForm: "messaging:contact-form:cancel"
  },
  settings: {
    voice: {
      get: "settings:voice:get"
    }
  },
  theme: { setPreference: "theme:set-preference" }
} as const;
import type { ActionApi } from "./action-contracts";
import type { AssistantApi } from "./assistant-contracts";
import type { VoiceApi } from "./voice-contracts";
import type { SettingsApi } from "./settings-contracts";
