import { describe, expect, it, vi } from "vitest";
import { createApplicationActionExecutor } from "../src/main/actions/application-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";
import { catalogRegistrationFailure } from "../src/main/applications/catalog-registration-failures";
import type { ApplicationLauncher } from "../src/main/applications/application-launcher";
import type { WebPageLauncher } from "../src/main/applications/web-page-launcher";

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

const createWebPageLauncher = (): WebPageLauncher =>
  ({
    launch: vi.fn(async () => ({
      ok: true as const,
      data: { applicationName: "Google Chrome", destination: "YOUTUBE" as const }
    }))
  }) as WebPageLauncher;

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

  it("returns only Spotify's trusted display name after the catalog adapter reports a successful launch", async () => {
    const launcher = createLauncher();
    vi.mocked(launcher.launchByAlias).mockResolvedValueOnce({
      ok: true,
      data: { applicationName: "Spotify" }
    });
    const executor = createApplicationActionExecutor({ launcher, logError: vi.fn() });

    const outcome = await executor.execute(
      { ...proposal, input: { alias: "spotify" } },
      getActionPolicy("OPEN_APPLICATION")
    );

    expect(outcome).toMatchObject({
      status: "SUCCEEDED",
      data: { applicationName: "Spotify" },
      userSummary: "Se abrió Spotify."
    });
    expect(JSON.stringify(outcome)).not.toContain("spotify:");
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

  it("maps each catalog registration failure category to its own status and bounded Spanish summary", async () => {
    const registrationProposal = {
      actionId: proposal.actionId,
      action: "REGISTER_CATALOG_APPLICATION" as const,
      input: { catalogKey: "SPOTIFY" as const, alias: "spotify" }
    };
    const cases = [
      ["UNKNOWN_CATALOG_KEY", "VALIDATION_FAILED", "Esa aplicación no está en el catálogo aprobado."],
      ["UNSUPPORTED_PLATFORM", "VALIDATION_FAILED", "Este sistema todavía no permite registrar aplicaciones aprobadas."],
      ["NOT_AVAILABLE", "VALIDATION_FAILED", "No encontré esa aplicación disponible en este equipo."],
      ["ALREADY_REGISTERED", "VALIDATION_FAILED", "Esa aplicación ya está registrada."],
      ["ALIAS_CONFLICT", "VALIDATION_FAILED", "Ya existe una aplicación o alias con esos datos."],
      ["PREPARATION_FAILED", "EXECUTION_FAILED", "No pude preparar el registro de la aplicación."],
      ["PERSISTENCE_FAILED", "EXECUTION_FAILED", "No pude guardar el registro de la aplicación."]
    ] as const;
    expect(new Set(cases.map(([, , message]) => message)).size).toBe(cases.length);
    for (const [category, status, message] of cases) {
      const executor = createApplicationActionExecutor({
        catalogRegistrationService: {
          prepare: vi.fn(),
          register: vi.fn(async () => catalogRegistrationFailure(category))
        },
        logError: vi.fn()
      });
      const outcome = await executor.execute(registrationProposal, getActionPolicy("REGISTER_CATALOG_APPLICATION"));
      expect(outcome).toMatchObject({ status, userSummary: message });
      expect(JSON.stringify(outcome)).not.toMatch(/spotify:|\.exe|C:\\/i);
    }
  });

  it("maps OPEN_WEB_PAGE through the trusted launcher with no URL in the terminal outcome", async () => {
    const launcher = createLauncher();
    const webPageLauncher = createWebPageLauncher();
    const executor = createApplicationActionExecutor({ launcher, webPageLauncher, logError: vi.fn() });
    const webProposal = {
      actionId: proposal.actionId,
      action: "OPEN_WEB_PAGE" as const,
      input: { destination: "YOUTUBE" as const, browser: "CHROME" as const }
    };

    const outcome = await executor.execute(webProposal, getActionPolicy("OPEN_WEB_PAGE"));

    expect(webPageLauncher.launch).toHaveBeenCalledWith(webProposal.input);
    expect(launcher.launchByAlias).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      actionId: proposal.actionId,
      action: "OPEN_WEB_PAGE",
      riskLevel: 1,
      status: "SUCCEEDED",
      data: { applicationName: "Google Chrome", destination: "YOUTUBE" },
      userSummary: "Se abrió YouTube en Google Chrome."
    });
    expect(JSON.stringify(outcome)).not.toContain("https://");
    expect(JSON.stringify(outcome)).not.toContain("chrome.exe");
  });
});
