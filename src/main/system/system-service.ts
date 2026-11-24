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
  getMetadata: () => SystemMetadata,
  readMicrophoneAccess?: () => SystemStatusData["microphoneAccess"]
): OperationResult<SystemStatusData> => {
  try {
    const metadata = getMetadata();
    let microphoneAccess: SystemStatusData["microphoneAccess"];
    try {
      microphoneAccess = readMicrophoneAccess?.();
    } catch {
      microphoneAccess = "unknown";
    }

    return {
      ok: true,
      data: {
        ...metadata,
        readiness: "READY",
        ...(microphoneAccess === undefined ? {} : { microphoneAccess })
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

/**
 * `voice` says whether spoken input can work right now: transcription needs the OpenAI key, so it is false without it and the
 * renderer offers typed input instead. `assistant` stays true because the offline local brain always answers. Nothing about
 * the key itself (not even its presence in detail) is returned.
 */
export const getSystemCapabilitiesResult = (isVoiceConfigured: () => boolean = () => true): OperationResult<SystemCapabilities> => ({
  ok: true,
  data: {
    database: false,
    dashboard: true,
    planner: true,
    files: true,
    applications: true,
    assistant: true,
    voice: ((): boolean => { try { return isVoiceConfigured(); } catch { return false; } })(),
    notifications: true
  }
});
