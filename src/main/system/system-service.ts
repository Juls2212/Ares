import type {
  OperationFailure,
  OperationResult,
  SystemCapabilities,
  SystemStatusData
} from "../../shared/contracts";

type SystemMetadata = Pick<
  SystemStatusData,
  "applicationName" | "applicationVersion" | "runtimePlatform"
>;

const createOperationFailure = (code: string, userMessage: string): OperationFailure => ({
  ok: false,
  error: {
    code,
    userMessage
  }
});

export const getSystemStatusResult = (
  getMetadata: () => SystemMetadata
): OperationResult<SystemStatusData> => {
  try {
    const metadata = getMetadata();

    return {
      ok: true,
      data: {
        ...metadata,
        readiness: "READY"
      }
    };
  } catch {
    console.error("System status retrieval failed.");
    return createOperationFailure(
      "SYSTEM_STATUS_UNAVAILABLE",
      "No se pudo consultar el estado técnico de Ares."
    );
  }
};

export const getSystemCapabilitiesResult = (): OperationResult<SystemCapabilities> => ({
  ok: true,
  data: {
    database: false,
    dashboard: true,
    planner: true,
    files: true,
    applications: true,
    assistant: true,
    voice: false,
    notifications: true
  }
});
