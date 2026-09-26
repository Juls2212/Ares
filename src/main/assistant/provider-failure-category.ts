type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  typeof value === "object" && value !== null ? value as RecordValue : undefined;

/** Returns only fixed categories. Never log error objects, messages, headers or provider identifiers. */
export const getAssistantProviderFailureCategory = (error: unknown): string => {
  // SDK errors inherit Error.name; their constructor identity is the reliable distinction.
  if (error instanceof APIConnectionTimeoutError) return "TIMEOUT";
  if (error instanceof APIConnectionError) return "NETWORK";
  const value = record(error);
  if (!value) return "UNKNOWN_FAILURE";
  if (value.status === 401) return "AUTHENTICATION";
  if (value.status === 403 || value.status === 404 || value.code === "model_not_found") return "MODEL_ACCESS";
  if (value.status === 429) return value.code === "insufficient_quota" ? "QUOTA" : "RATE_LIMIT";
  if (value.name === "APIConnectionTimeoutError" || value.name === "TimeoutError") return "TIMEOUT";
  if (value.name === "APIConnectionError") return "NETWORK";
  if (typeof value.status === "number" && value.status >= 500) return "PROVIDER_SERVER";
  if (value.status === 400) {
    const message = typeof value.message === "string" ? value.message : "";
    if (value.code === "invalid_json_schema" || /invalid schema/i.test(message)) {
      if (/maxLength/i.test(message)) return "SCHEMA_MAX_LENGTH";
      if (/maxItems/i.test(message)) return "SCHEMA_MAX_ITEMS";
      if (/additionalProperties/i.test(message)) return "SCHEMA_ADDITIONAL_PROPERTIES";
      if (/required/i.test(message)) return "SCHEMA_REQUIRED";
      return "SCHEMA_INVALID";
    }
    if (value.code === "unsupported_parameter" || /unsupported parameter/i.test(message)) return "REQUEST_PARAMETER_UNSUPPORTED";
    if (value.code === "unsupported_value" || /not supported.*model|model.*not supported/i.test(message)) return "MODEL_REQUEST_INCOMPATIBLE";
    return "REQUEST_INVALID";
  }
  return "UNKNOWN_FAILURE";
};
import { APIConnectionError, APIConnectionTimeoutError } from "openai";
