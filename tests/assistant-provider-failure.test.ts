import { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { describe, expect, it, vi } from "vitest";
import { getAssistantProviderFailureCategory } from "../src/main/assistant/provider-failure-category";
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
      [{ status: 401 }, "AUTHENTICATION"], [{ status: 403 }, "MODEL_ACCESS"],
      [{ status: 400, code: "model_not_found" }, "MODEL_ACCESS"],
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
  it("maps SDK timeout to the existing timeout outcome, without a second request or raw error leakage", async () => {
    const logError = vi.fn();
    const interpret = vi.fn(async () => { throw new APIConnectionTimeoutError({ message: "private response and configuration" }); });
    const interpreter = createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "test-only-placeholder", model: "test-only-placeholder" }),
      createProvider: () => ({ interpret }), logError
    });
    const result = await interpreter.interpret({ instruction: "Crea una tarea" });
    expect(result).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_TIMEOUT", drafts: [] } });
    expect(interpret).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("Assistant provider failure category [TIMEOUT].");
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
    expect(result).toMatchObject({ ok: true, data: { state: "UNAVAILABLE", errorCode: "ASSISTANT_PROVIDER_UNAVAILABLE", drafts: [] } });
    expect(logError).toHaveBeenCalledWith("Assistant provider failure category [NETWORK].");
    expect(JSON.stringify([result, logError.mock.calls])).not.toContain("private");
  });
});
