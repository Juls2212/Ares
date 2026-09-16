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
};

export const IPC_CHANNELS = {
  system: {
    getStatus: "system:get-status",
    getCapabilities: "system:get-capabilities"
  }
} as const;
