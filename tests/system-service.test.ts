import { describe, expect, it, vi } from "vitest";
import {
  getSystemCapabilitiesResult,
  getSystemStatusResult
} from "../src/main/system/system-service";

describe("system service", () => {
  it("returns a typed system status success result", () => {
    const result = getSystemStatusResult(() => ({
      applicationName: "Ares",
      applicationVersion: "0.1.0",
      runtimePlatform: "win32"
    }));

    expect(result).toEqual({
      ok: true,
      data: {
        applicationName: "Ares",
        applicationVersion: "0.1.0",
        runtimePlatform: "win32",
        readiness: "READY"
      }
    });
  });

  it("maps failures without exposing raw exception text", () => {
    const technicalError = new Error("unexpected internal diagnostic");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = getSystemStatusResult(() => {
      throw technicalError;
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "SYSTEM_STATUS_UNAVAILABLE",
        userMessage: "No se pudo consultar el estado técnico de Ares."
      }
    });
    expect(JSON.stringify(result)).not.toContain(technicalError.message);
    expect(JSON.stringify(result)).not.toContain("stack");
    expect(JSON.stringify(result)).not.toContain("process.env");
    expect(JSON.stringify(result)).not.toContain("C:\\\\");
    errorSpy.mockRestore();
  });

  it("reports Main-only dashboard, planner, file-action, application, and reminder-delivery availability without exposing database access", () => {
    const result = getSystemCapabilitiesResult();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.planner).toBe(true);
      expect(result.data.database).toBe(false);
      expect(result.data.dashboard).toBe(true);
      expect(result.data.files).toBe(true);
      expect(result.data.applications).toBe(true);
      expect(result.data.assistant).toBe(true);
      expect(result.data.voice).toBe(true);
      expect(result.data.notifications).toBe(true);
    }
  });
});
