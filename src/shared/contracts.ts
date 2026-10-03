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
  dashboard: DashboardApi;
  planner: PlannerApi;
  actions: ActionApi;
  applications: ApplicationsApi;
  assistant: AssistantApi;
  voice: VoiceApi;
  speech: import("./speech-contracts").SpeechApi;
  settings: SettingsApi;
};

export const IPC_CHANNELS = {
  system: {
    getStatus: "system:get-status",
    getCapabilities: "system:get-capabilities"
  },
  planner: {
    categories: {
      create: "planner:categories:create",
      list: "planner:categories:list",
      update: "planner:categories:update"
    },
    tasks: {
      create: "planner:tasks:create",
      list: "planner:tasks:list",
      update: "planner:tasks:update",
      complete: "planner:tasks:complete",
      requestDeletion: "planner:tasks:request-deletion",
      confirmDeletion: "planner:tasks:confirm-deletion",
      cancelDeletion: "planner:tasks:cancel-deletion"
    },
    events: {
      create: "planner:events:create",
      list: "planner:events:list",
      update: "planner:events:update",
      requestDeletion: "planner:events:request-deletion",
      confirmDeletion: "planner:events:confirm-deletion",
      cancelDeletion: "planner:events:cancel-deletion"
    },
    reminders: {
      create: "planner:reminders:create",
      list: "planner:reminders:list"
    },
    weeklyRoutines: {
      create: "planner:weekly-routines:create",
      list: "planner:weekly-routines:list",
      update: "planner:weekly-routines:update",
      delete: "planner:weekly-routines:delete"
    },
    weeklySchedules: {
      create: "planner:weekly-schedules:create",
      list: "planner:weekly-schedules:list",
      update: "planner:weekly-schedules:update",
      delete: "planner:weekly-schedules:delete"
    },
    schedule: {
      getToday: "planner:schedule:get-today",
      getWeek: "planner:schedule:get-week"
    }
  },
  actions: {
    propose: "actions:propose",
    confirm: "actions:confirm",
    cancel: "actions:cancel",
    history: {
      list: "actions:history:list"
    }
  },
  applications: {
    registerCatalogApplication: "applications:register-catalog-application",
    registerCustomApplication: "applications:register-custom-application",
    list: "applications:list",
    update: "applications:update"
  },
  dashboard: {
    getTodaySummary: "dashboard:get-today-summary"
  },
  assistant: {
    interpret: "assistant:interpret",
    context: {
      set: "assistant:context:set",
      clear: "assistant:context:clear"
    }
  },
  voice: {
    transcribe: "voice:transcribe",
    globalShortcutActivated: "voice:global-shortcut-activated"
  },
  speech: { speak: "speech:speak" },
  settings: {
    voice: {
      get: "settings:voice:get",
      update: "settings:voice:update"
    }
  }
} as const;
import type { PlannerApi } from "./planner-contracts";
import type { ActionApi } from "./action-contracts";
import type { ApplicationsApi } from "./application-contracts";
import type { DashboardApi } from "./dashboard-contracts";
import type { AssistantApi } from "./assistant-contracts";
import type { VoiceApi } from "./voice-contracts";
import type { SettingsApi } from "./settings-contracts";
