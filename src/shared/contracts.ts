export type OperationSuccess<T> = {
  ok: true;
  data: T;
};

export type OperationFailure = {
  ok: false;
  error: {
    code: string;
    userMessage: string;
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
  planner: PlannerApi;
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
      complete: "planner:tasks:complete"
    },
    events: {
      create: "planner:events:create",
      list: "planner:events:list",
      update: "planner:events:update"
    },
    reminders: {
      create: "planner:reminders:create",
      list: "planner:reminders:list"
    },
    schedule: {
      getToday: "planner:schedule:get-today",
      getWeek: "planner:schedule:get-week"
    }
  }
} as const;
import type { PlannerApi } from "./planner-contracts";
