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
    register: "applications:register",
    list: "applications:list",
    update: "applications:update"
  },
  dashboard: {
    getTodaySummary: "dashboard:get-today-summary"
  }
} as const;
import type { PlannerApi } from "./planner-contracts";
import type { ActionApi } from "./action-contracts";
import type { ApplicationsApi } from "./application-contracts";
import type { DashboardApi } from "./dashboard-contracts";
