import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn() } }));

import { createCatalogApplicationRegistrationService } from "../src/main/applications/catalog-application-registration-service";
import type { ApplicationService } from "../src/main/applications/application-service";
import type {
  ApplicationRecord,
  RegisterableCatalogApplication
} from "../src/shared/application-contracts";

const definitions: Record<
  RegisterableCatalogApplication,
  { name: string; alias: string; executableName: string }
> = {
  GOOGLE_CHROME: { name: "Google Chrome", alias: "chrome", executableName: "chrome.exe" },
  VISUAL_STUDIO_CODE: { name: "Visual Studio Code", alias: "vscode", executableName: "Code.exe" },
  VISUAL_STUDIO: { name: "Visual Studio", alias: "visualstudio", executableName: "devenv.exe" },
  SPOTIFY: { name: "Spotify", alias: "spotify", executableName: "Spotify.exe" }
};

const selectedPathFor = (application: RegisterableCatalogApplication): string =>
  `C:\\Program Files\\Ares Test\\${definitions[application].executableName}`;

const recordFor = (application: RegisterableCatalogApplication): ApplicationRecord => {
  const definition = definitions[application];
  const id = "550e8400-e29b-41d4-a716-446655440000";
  return {
    id,
    name: definition.name,
    platform: "WINDOWS",
    isFavorite: false,
    isEnabled: true,
    lastLaunchedAt: null,
    aliases: [{ id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", applicationId: id, alias: definition.alias, createdAt: "2026-09-20T00:00:00.000Z" }],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z"
  };
};

const createApplicationService = (items: ApplicationRecord[] = [], record = recordFor("GOOGLE_CHROME")) => {
  const listApplications = vi.fn(async () => ({ ok: true as const, data: { items, total: items.length } }));
  const registerApplication = vi.fn(async () => ({ ok: true as const, data: { record } }));
  return {
    service: { listApplications, registerApplication } as unknown as ApplicationService,
    listApplications,
    registerApplication
  };
};

const createService = (
  application: RegisterableCatalogApplication,
  overrides: Record<string, unknown> = {}
) => {
  const record = recordFor(application);
  const applicationService = createApplicationService([], record);
  return {
    application: applicationService,
    service: createCatalogApplicationRegistrationService({
      applicationService: applicationService.service,
      showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPathFor(application)] }),
      realpath: async () => selectedPathFor(application),
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn(),
      ...overrides
    })
  };
};

describe("Main-only catalog application registration", () => {
  it.each(Object.keys(definitions) as RegisterableCatalogApplication[])(
    "registers %s with its fixed trusted catalog values",
    async (application) => {
      const { application: applicationService, service } = createService(application);
      const definition = definitions[application];

      const result = await service.registerCatalogApplication({ application });

      expect(result).toEqual({
        ok: true,
        data: { status: "REGISTERED", application, record: recordFor(application) }
      });
      expect(applicationService.registerApplication).toHaveBeenCalledWith({
        name: definition.name,
        executablePath: selectedPathFor(application),
        aliases: [definition.alias],
        platform: "WINDOWS",
        isEnabled: true
      });
      expect(JSON.stringify(result)).not.toContain(selectedPathFor(application));
    }
  );

  it("rejects unknown keys and invalid catalog selections before opening a picker", async () => {
    const { application, service } = createService("GOOGLE_CHROME");

    for (const input of [undefined, { application: "NOTEPAD" }, { application: "GOOGLE_CHROME", path: "forbidden" }]) {
      await expect(service.registerCatalogApplication(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "APPLICATION_INPUT_INVALID" }
      });
    }
    expect(application.registerApplication).not.toHaveBeenCalled();
  });

  it("does not write when the native selection is cancelled", async () => {
    const { application, service } = createService("SPOTIFY", {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    });

    await expect(service.registerCatalogApplication({ application: "SPOTIFY" })).resolves.toEqual({
      ok: true,
      data: { status: "CANCELLED", application: "SPOTIFY" }
    });
    expect(application.registerApplication).not.toHaveBeenCalled();
  });

  it("rejects a wrong filename, a non-regular file, and a canonicalization failure without leaking paths", async () => {
    const wrongFilename = createService("VISUAL_STUDIO_CODE", {
      realpath: async () => "C:\\Programs\\other.exe"
    });
    const nonFile = createService("VISUAL_STUDIO", { stat: async () => ({ isFile: () => false }) });
    const logError = vi.fn();
    const canonicalizationFailure = createService("GOOGLE_CHROME", {
      realpath: async () => {
        throw new Error(selectedPathFor("GOOGLE_CHROME"));
      },
      logError
    });

    for (const candidate of [wrongFilename, nonFile, canonicalizationFailure]) {
      const result = await candidate.service.registerCatalogApplication({
        application:
          candidate === wrongFilename
            ? "VISUAL_STUDIO_CODE"
            : candidate === nonFile
              ? "VISUAL_STUDIO"
              : "GOOGLE_CHROME"
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "APPLICATION_CATALOG_SELECTION_INVALID" }
      });
      expect(JSON.stringify(result)).not.toContain("C:\\");
      expect(candidate.application.registerApplication).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(logError.mock.calls)).not.toContain(selectedPathFor("GOOGLE_CHROME"));
  });

  it("returns an idempotent result for an exact existing catalog record without opening the picker", async () => {
    const application = "GOOGLE_CHROME" as const;
    const existing = recordFor(application);
    const applicationService = createApplicationService([existing], existing);
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [selectedPathFor(application)] }));
    const service = createCatalogApplicationRegistrationService({
      applicationService: applicationService.service,
      showOpenDialog,
      realpath: async () => selectedPathFor(application),
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn()
    });

    await expect(service.registerCatalogApplication({ application })).resolves.toEqual({
      ok: true,
      data: { status: "ALREADY_REGISTERED", application, record: existing }
    });
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(applicationService.registerApplication).not.toHaveBeenCalled();
  });

  it("does not overwrite a conflicting application or alias", async () => {
    const existing = { ...recordFor("GOOGLE_CHROME"), name: "Other application" };
    const applicationService = createApplicationService([existing]);
    const service = createCatalogApplicationRegistrationService({
      applicationService: applicationService.service,
      showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPathFor("GOOGLE_CHROME")] }),
      realpath: async () => selectedPathFor("GOOGLE_CHROME"),
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn()
    });

    await expect(service.registerCatalogApplication({ application: "GOOGLE_CHROME" })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CONFLICT" }
    });
    expect(applicationService.registerApplication).not.toHaveBeenCalled();
  });
});
