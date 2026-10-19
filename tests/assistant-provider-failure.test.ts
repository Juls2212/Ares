import { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  getAssistantProviderFailureCategory,
  getAssistantProviderFailureDiagnostic
} from "../src/main/assistant/provider-failure-category";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";

describe("assistant provider failure classification", () => {
  it("distinguishes actual SDK connection and timeout errors even though their name is Error", () => {
    const timeout = new APIConnectionTimeoutError({ message: "private upstream detail" });
    const network = new APIConnectionError({ message: "private upstream detail", cause: new Error("private credential") });
    expect(timeout.name).toBe("Error");
    expect(getAssistantProviderFailureCategory(timeout)).toBe("TIMEOUT");
    expect(getAssistantProviderFailureCategory(network)).toBe("NETWORK");
  });
  it("returns only fixed categories for HTTP errors and schema incompatibilities", () => {
    const cases = [
      [{ status: 401 }, "AUTHENTICATION"], [{ status: 403 }, "AUTHORIZATION"],
      [{ status: 400, code: "model_not_found" }, "MODEL_UNAVAILABLE"],
      [{ status: 429, code: "insufficient_quota" }, "QUOTA"], [{ status: 429 }, "RATE_LIMIT"],
      [{ status: 503 }, "PROVIDER_SERVER"],
      [{ status: 400, code: "invalid_json_schema", message: "private input: maxLength is unsupported" }, "SCHEMA_MAX_LENGTH"],
      [{ status: 400, code: "unsupported_parameter", param: "private parameter" }, "REQUEST_PARAMETER_UNSUPPORTED"],
      [{ status: 400, code: "unsupported_value" }, "MODEL_REQUEST_INCOMPATIBLE"],
      [{ status: 400, message: "private unknown request detail" }, "REQUEST_INVALID"],
      [new Error("private provider error"), "UNKNOWN_FAILURE"]
    ] as const;
    for (const [error, category] of cases) expect(getAssistantProviderFailureCategory(error)).toBe(category);
  });
  it("keeps status and retryability diagnostic-only without preserving provider content", () => {
    const diagnostic = getAssistantProviderFailureDiagnostic({
      status: 429,
      code: "insufficient_quota",
      message: "raw upstream body, transcript, and api key"
    });
    expect(diagnostic).toEqual({ category: "QUOTA", status: 429, retryable: false });
    expect(JSON.stringify(diagnostic)).not.toContain("raw upstream body");
    expect(JSON.stringify(diagnostic)).not.toContain("transcript");
    expect(JSON.stringify(diagnostic)).not.toContain("api key");
  });
  it("maps SDK timeout to the existing timeout outcome, without a second request or raw error leakage", async () => {
    const logError = vi.fn();
    const interpret = vi.fn(async () => { throw new APIConnectionTimeoutError({ message: "private response and configuration" }); });
    const interpreter = createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "test-only-placeholder", model: "test-only-placeholder" }),
      createProvider: () => ({ interpret }), logError
    });
    const result = await interpreter.interpret({ instruction: "Crea una tarea" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        state: "UNAVAILABLE",
        errorCode: "ASSISTANT_TIMEOUT",
        summary: "El servicio de interpretación tardó demasiado. Inténtalo de nuevo.",
        drafts: []
      }
    });
    expect(interpret).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("Assistant provider failure category [TIMEOUT] status [NONE] retryable [true].");
    expect(JSON.stringify([result, logError.mock.calls])).not.toContain("private");
    expect(JSON.stringify([result, logError.mock.calls])).not.toContain("test-only-placeholder");
  });
  it("keeps genuine network failures unavailable and logs only a fixed category", async () => {
    const logError = vi.fn();
    const interpreter = createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "test-only-placeholder", model: "test-only-placeholder" }),
      createProvider: () => ({ interpret: async () => { throw new APIConnectionError({ message: "private endpoint", cause: new Error("private detail") }); } }), logError
    });
    const result = await interpreter.interpret({ instruction: "Crea una tarea" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        state: "UNAVAILABLE",
        errorCode: "ASSISTANT_NETWORK_UNAVAILABLE",
        summary: "No se pudo conectar con el servicio de interpretación. Inténtalo de nuevo.",
        drafts: []
      }
    });
    expect(logError).toHaveBeenCalledWith("Assistant provider failure category [NETWORK] status [NONE] retryable [true].");
    expect(JSON.stringify([result, logError.mock.calls])).not.toContain("private");
  });
});
