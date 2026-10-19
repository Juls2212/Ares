import { APIConnectionError, APIConnectionTimeoutError } from "openai";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  typeof value === "object" && value !== null ? value as RecordValue : undefined;

export type AssistantProviderFailureCategory =
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "MODEL_UNAVAILABLE"
  | "QUOTA"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "PROVIDER_SERVER"
  | "SCHEMA_MAX_LENGTH"
  | "SCHEMA_MAX_ITEMS"
  | "SCHEMA_ADDITIONAL_PROPERTIES"
  | "SCHEMA_REQUIRED"
  | "SCHEMA_INVALID"
  | "REQUEST_PARAMETER_UNSUPPORTED"
  | "MODEL_REQUEST_INCOMPATIBLE"
  | "REQUEST_INVALID"
  | "UNKNOWN_FAILURE";

export type AssistantProviderFailureDiagnostic = {
  category: AssistantProviderFailureCategory;
  status?: number;
  retryable: boolean;
};

const statusOf = (value: RecordValue | undefined): number | undefined =>
  typeof value?.status === "number" && Number.isInteger(value.status)
    ? value.status
    : undefined;

/**
 * Returns only fixed, non-sensitive diagnostics. Callers must never log the
 * original error, its message, headers, request content, or response body.
 */
export const getAssistantProviderFailureDiagnostic = (
  error: unknown
): AssistantProviderFailureDiagnostic => {
  // SDK errors inherit Error.name; their constructor identity is the reliable distinction.
  if (error instanceof APIConnectionTimeoutError) return { category: "TIMEOUT", retryable: true };
  if (error instanceof APIConnectionError) return { category: "NETWORK", retryable: true };

  const value = record(error);
  const status = statusOf(value);
  if (!value) return { category: "UNKNOWN_FAILURE", retryable: false };
  if (status === 401) return { category: "AUTHENTICATION", status, retryable: false };
  if (status === 403) return { category: "AUTHORIZATION", status, retryable: false };
  if (status === 404 || value.code === "model_not_found") return { category: "MODEL_UNAVAILABLE", status, retryable: false };
  if (status === 429) {
    return {
      category: value.code === "insufficient_quota" ? "QUOTA" : "RATE_LIMIT",
      status,
      retryable: value.code !== "insufficient_quota"
    };
  }
  if (value.name === "APIConnectionTimeoutError" || value.name === "TimeoutError") {
    return { category: "TIMEOUT", status, retryable: true };
  }
  if (value.name === "APIConnectionError") return { category: "NETWORK", status, retryable: true };
  if (status !== undefined && status >= 500) return { category: "PROVIDER_SERVER", status, retryable: true };
  if (status === 400) {
    const message = typeof value.message === "string" ? value.message : "";
    if (value.code === "invalid_json_schema" || /invalid schema/i.test(message)) {
      if (/maxLength/i.test(message)) return { category: "SCHEMA_MAX_LENGTH", status, retryable: false };
      if (/maxItems/i.test(message)) return { category: "SCHEMA_MAX_ITEMS", status, retryable: false };
      if (/additionalProperties/i.test(message)) return { category: "SCHEMA_ADDITIONAL_PROPERTIES", status, retryable: false };
      if (/required/i.test(message)) return { category: "SCHEMA_REQUIRED", status, retryable: false };
      return { category: "SCHEMA_INVALID", status, retryable: false };
    }
    if (value.code === "unsupported_parameter" || /unsupported parameter/i.test(message)) {
      return { category: "REQUEST_PARAMETER_UNSUPPORTED", status, retryable: false };
    }
    if (value.code === "unsupported_value" || /not supported.*model|model.*not supported/i.test(message)) {
      return { category: "MODEL_REQUEST_INCOMPATIBLE", status, retryable: false };
    }
    return { category: "REQUEST_INVALID", status, retryable: false };
  }
  return { category: "UNKNOWN_FAILURE", status, retryable: false };
};

export const getAssistantProviderFailureCategory = (error: unknown): AssistantProviderFailureCategory =>
  getAssistantProviderFailureDiagnostic(error).category;
