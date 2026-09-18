import { describe, expect, it, vi } from "vitest";
import { createApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import type { ApplicationLauncher } from "../src/main/applications/application-launcher";

const proposal = {
  actionId: "550e8400-e29b-41d4-a716-446655440000",
  action: "OPEN_APPLICATION" as const,
  input: { alias: "Word" }
};

const createLauncher = (): ApplicationLauncher =>
  ({
    launchByAlias: vi.fn(async () => ({ ok: true as const, data: { applicationName: "Microsoft Word" } })),
    launchResolvedTarget: vi.fn()
  }) as unknown as ApplicationLauncher;

describe("application action executor", () => {
  it("maps OPEN_APPLICATION to the Main-only launcher and returns safe terminal data", async () => {
    const launcher = createLauncher();
    const executor = createApplicationActionExecutor({ launcher, logError: vi.fn() });

    const outcome = await executor.execute(proposal, getActionPolicy("OPEN_APPLICATION"));

    expect(launcher.launchByAlias).toHaveBeenCalledWith("Word");
    expect(outcome).toEqual({
      actionId: proposal.actionId,
      action: "OPEN_APPLICATION",
      riskLevel: 1,
      status: "SUCCEEDED",
      data: { applicationName: "Microsoft Word" },
      userSummary: "Se abrió Microsoft Word."
    });
    expect(JSON.stringify(outcome)).not.toContain("C:\\");
  });

  it("preserves controlled launch failures without paths or raw errors", async () => {
    const launcher = createLauncher();
    vi.mocked(launcher.launchByAlias).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "APPLICATION_EXECUTABLE_NOT_FOUND",
        userMessage: "No se encontró el ejecutable de la aplicación registrada."
      }
    });
    const executor = createApplicationActionExecutor({ launcher, logError: vi.fn() });

    const outcome = await executor.execute(proposal, getActionPolicy("OPEN_APPLICATION"));

    expect(outcome).toMatchObject({
      status: "VALIDATION_FAILED",
      errorCode: "APPLICATION_EXECUTABLE_NOT_FOUND",
      userSummary: "No se encontró el ejecutable de la aplicación registrada."
    });
    expect(JSON.stringify(outcome)).not.toContain("C:\\");
  });
});
