import { describe, expect, it, vi } from "vitest";
import { createCatalogApplicationRegistrationService } from "../src/main/applications/catalog-application-registration";
import { createCatalogApplicationAdapter } from "../src/main/applications/catalog-application-adapter";
import type { ApplicationRecord } from "../src/shared/application-contracts";

const listApplications = vi.fn(async () => ({ ok: true as const, data: { items: [], total: 0 } }));
const registeredRecord: ApplicationRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Spotify",
  platform: "WINDOWS",
  launchMode: "CATALOG_APPLICATION",
  catalogKey: "SPOTIFY",
  isFavorite: false,
  isEnabled: true,
  lastLaunchedAt: null,
  aliases: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};
const registerApplication = vi.fn(async (_input: unknown) => ({ ok: true as const, data: { record: registeredRecord } }));
const availableAdapter = {
  getCurrentPlatform: () => "WINDOWS" as const,
  isAvailable: vi.fn(async () => ({ ok: true as const, data: { available: true as const } })),
  launch: vi.fn()
};

describe("catalog application registration", () => {
  it("prepares a fixed catalog registration without persisting it", async () => {
    const service = createCatalogApplicationRegistrationService({
      applicationService: { listApplications, registerApplication },
      adapter: availableAdapter
    });
    await expect(service.prepare({ catalogKey: "SPOTIFY" })).resolves.toMatchObject({
      ok: true,
      data: { catalogKey: "SPOTIFY", alias: "spotify", applicationName: "Spotify" }
    });
    expect(registerApplication).not.toHaveBeenCalled();
  });

  it("registers Spotify through the fixed internal protocol strategy when executable candidates are absent", async () => {
    const openFixedProtocol = vi.fn(async () => undefined);
    const persistCatalogRegistration = vi.fn(async (_input: unknown) => ({ ok: true as const, data: { record: registeredRecord } }));
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      realpath: vi.fn(async () => { throw new Error("candidate unavailable"); }),
      openFixedProtocol
    });
    const service = createCatalogApplicationRegistrationService({
      applicationService: {
        listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [], total: 0 } })),
        registerApplication: persistCatalogRegistration
      },
      adapter
    });

    await expect(service.register({ catalogKey: "SPOTIFY" })).resolves.toEqual({
      ok: true,
      data: { catalogKey: "SPOTIFY", alias: "spotify", applicationName: "Spotify" }
    });
    expect(openFixedProtocol).not.toHaveBeenCalled();
    expect(persistCatalogRegistration).toHaveBeenCalledWith(expect.objectContaining({
      launchMode: "CATALOG_APPLICATION",
      catalogKey: "SPOTIFY"
    }));
    expect(persistCatalogRegistration.mock.calls[0]?.[0]).not.toHaveProperty("executablePath");
  });

  it("persists only a catalog target after its separate confirmation path executes", async () => {
    const service = createCatalogApplicationRegistrationService({
      applicationService: { listApplications, registerApplication },
      adapter: availableAdapter
    });
    await service.register({ catalogKey: "SPOTIFY", alias: "spotify" });
    expect(registerApplication).toHaveBeenCalledWith(expect.objectContaining({
      platform: "WINDOWS",
      launchMode: "CATALOG_APPLICATION",
      catalogKey: "SPOTIFY",
      aliases: ["spotify"]
    }));
    expect(registerApplication.mock.calls[0]?.[0]).not.toHaveProperty("executablePath");
  });

  it("rejects unknown keys before detection or persistence", async () => {
    const service = createCatalogApplicationRegistrationService({
      applicationService: { listApplications, registerApplication },
      adapter: availableAdapter
    });
    await expect(service.prepare({ catalogKey: "POWERSHELL", command: "unsafe" })).resolves.toMatchObject({ ok: false });
    expect(availableAdapter.isAvailable).not.toHaveBeenCalledWith("POWERSHELL");
  });
});

describe("catalog application registration failure taxonomy", () => {
  const legacyRecord: ApplicationRecord = {
    ...registeredRecord,
    id: "22222222-2222-4222-8222-222222222222",
    launchMode: "WINDOWS_EXECUTABLE",
    catalogKey: null,
    aliases: [{ id: "a", applicationId: "22222222-2222-4222-8222-222222222222", alias: "musica", createdAt: "2026-01-01T00:00:00.000Z" }]
  };
  const create = (overrides: Record<string, unknown> = {}) => {
    const logError = vi.fn();
    const persist = vi.fn(async (_input: unknown) => ({ ok: true as const, data: { record: registeredRecord } }));
    const service = createCatalogApplicationRegistrationService({
      applicationService: {
        listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [], total: 0 } })),
        registerApplication: persist
      },
      adapter: availableAdapter,
      logError,
      ...overrides
    } as never);
    return { service, logError, persist };
  };
  const messageOf = (result: { ok: boolean; error?: { userMessage: string } }) => result.error?.userMessage;

  it("reports an unknown catalog key with its own message", async () => {
    const { service } = create();
    const result = await service.prepare({ catalogKey: "NOT_A_KEY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_KEY_INVALID" } });
    expect(messageOf(result)).toBe("Esa aplicación no está en el catálogo aprobado.");
  });

  it("reports an unsupported platform separately from unavailability", async () => {
    const { service } = create({ adapter: { ...availableAdapter, getCurrentPlatform: () => "LINUX" as const } });
    const result = await service.prepare({ catalogKey: "SPOTIFY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNSUPPORTED_PLATFORM" } });
    expect(messageOf(result)).toBe("Este sistema todavía no permite registrar aplicaciones aprobadas.");
  });

  it("uses the not-found message only when the application is truly unavailable", async () => {
    const { service } = create({
      adapter: {
        ...availableAdapter,
        isAvailable: vi.fn(async () => ({ ok: false as const, error: { code: "APPLICATION_CATALOG_UNAVAILABLE", userMessage: "private C:\\detail" } }))
      }
    });
    const result = await service.prepare({ catalogKey: "SPOTIFY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });
    expect(messageOf(result)).toBe("No encontré esa aplicación disponible en este equipo.");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("reports an already registered catalog application", async () => {
    const { service, persist } = create({
      applicationService: {
        listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [registeredRecord], total: 1 } })),
        registerApplication: vi.fn()
      }
    });
    const result = await service.register({ catalogKey: "SPOTIFY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_ALREADY_REGISTERED" } });
    expect(messageOf(result)).toBe("Esa aplicación ya está registrada.");
    expect(persist).not.toHaveBeenCalled();
  });

  it("regression: a repeated application name is reported at preparation, before the user confirms", async () => {
    const { service } = create({
      applicationService: {
        listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [legacyRecord], total: 1 } })),
        registerApplication: vi.fn()
      }
    });
    const result = await service.prepare({ catalogKey: "SPOTIFY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CONFLICT" } });
    expect(messageOf(result)).toBe("Ya existe una aplicación o alias con esos datos.");
  });

  it("maps a persistence conflict raised at registration time to the alias conflict message", async () => {
    const { service } = create({
      applicationService: {
        listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [], total: 0 } })),
        registerApplication: vi.fn(async () => ({ ok: false as const, error: { code: "APPLICATION_CONFLICT", userMessage: "x" } }))
      }
    });
    const result = await service.register({ catalogKey: "SPOTIFY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CONFLICT" } });
  });

  it("reports persistence failures with a bounded message and no raw error text", async () => {
    const { service, logError } = create({
      applicationService: {
        listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [], total: 0 } })),
        registerApplication: vi.fn(async () => { throw new Error("relation \"applications\" does not exist at C:\\db"); })
      }
    });
    const result = await service.register({ catalogKey: "SPOTIFY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_PERSISTENCE_FAILED" } });
    expect(messageOf(result)).toBe("No pude guardar el registro de la aplicación.");
    expect(JSON.stringify(result)).not.toMatch(/relation|applications|C:\\/);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/relation|C:\\/);
  });

  it("reports a failed catalog read during preparation as a persistence failure", async () => {
    const { service } = create({
      applicationService: {
        listApplications: vi.fn(async () => ({ ok: false as const, error: { code: "APPLICATION_DATABASE_UNAVAILABLE", userMessage: "x" } })),
        registerApplication: vi.fn()
      }
    });
    await expect(service.prepare({ catalogKey: "SPOTIFY" })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CATALOG_PERSISTENCE_FAILED" }
    });
  });

  it("reports an unexpected exception during preparation with its own message", async () => {
    const { service, logError } = create({
      applicationService: {
        listApplications: vi.fn(async () => { throw new Error("secret detail"); }),
        registerApplication: vi.fn()
      }
    });
    const result = await service.prepare({ catalogKey: "SPOTIFY" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_PREPARATION_FAILED" } });
    expect(messageOf(result)).toBe("No pude preparar el registro de la aplicación.");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret detail");
  });

  it("never uses the Spotify protocol fallback when registering another catalog application", async () => {
    const openFixedProtocol = vi.fn(async () => undefined);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      realpath: vi.fn(async () => { throw new Error("not found"); }),
      openFixedProtocol
    });
    const { service, persist } = create({ adapter });
    const result = await service.register({ catalogKey: "GOOGLE_CHROME" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });
    expect(openFixedProtocol).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("registers Spotify with an installed executable and exposes no path or protocol", async () => {
    const openFixedProtocol = vi.fn(async () => undefined);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      realpath: vi.fn(async (path: string) => path),
      stat: vi.fn(async () => ({ isFile: () => true })),
      openFixedProtocol
    });
    const { service, persist } = create({ adapter });
    const result = await service.register({ catalogKey: "SPOTIFY" });
    expect(result).toEqual({ ok: true, data: { catalogKey: "SPOTIFY", alias: "spotify", applicationName: "Spotify" } });
    expect(JSON.stringify(result)).not.toMatch(/spotify:|\.exe|C:\\/i);
    expect(openFixedProtocol).not.toHaveBeenCalled();
    expect(JSON.stringify(persist.mock.calls)).not.toMatch(/spotify:|\.exe|C:\\/i);
  });

  it("after registration, opening re-resolves the enabled alias and uses the fixed protocol only inside the adapter", async () => {
    const openFixedProtocol = vi.fn(async () => undefined);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      realpath: vi.fn(async () => { throw new Error("not found"); }),
      openFixedProtocol
    });
    const { service, persist } = create({ adapter });
    await expect(service.register({ catalogKey: "SPOTIFY" })).resolves.toMatchObject({ ok: true });
    expect(persist).toHaveBeenCalledOnce();

    const resolveEnabledApplicationByAlias = vi.fn(async () => ({
      ok: true as const,
      data: {
        id: registeredRecord.id,
        name: "Spotify",
        platform: "WINDOWS" as const,
        launchMode: "CATALOG_APPLICATION" as const,
        catalogKey: "SPOTIFY" as const,
        executablePath: null,
        isEnabled: true
      }
    }));
    const { createApplicationLauncher } = await import("../src/main/applications/application-launcher");
    const launcher = createApplicationLauncher({
      applicationService: { resolveEnabledApplicationByAlias } as never,
      catalogAdapter: adapter,
      logError: vi.fn()
    });
    const opened = await launcher.launchByAlias("spotify");
    expect(resolveEnabledApplicationByAlias).toHaveBeenCalledWith("spotify");
    expect(opened).toEqual({ ok: true, data: { applicationName: "Spotify" } });
    expect(openFixedProtocol).toHaveBeenCalledOnce();
    expect(JSON.stringify(opened)).not.toContain("spotify:");
  });
});
