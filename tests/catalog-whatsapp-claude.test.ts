import { describe, expect, it, vi } from "vitest";
import { createApplicationLauncher } from "../src/main/applications/application-launcher";
import { createCatalogApplicationAdapter } from "../src/main/applications/catalog-application-adapter";
import { createCatalogApplicationRegistrationService } from "../src/main/applications/catalog-application-registration";
import {
  KNOWN_APPLICATION_CATALOG,
  getKnownApplication,
  normalizeApplicationAlias,
  toWindowsLaunchCandidate
} from "../src/main/applications/known-application-catalog";
import { APPLICATION_CATALOG_KEYS, type ApplicationRecord } from "../src/shared/application-contracts";

const directories = {
  localApplicationData: "C:\\Users\\Juli\\AppData\\Local",
  roamingApplicationData: "C:\\Users\\Juli\\AppData\\Roaming"
};

const spawnSucceeding = () => {
  let child: { once: (event: "error" | "spawn", listener: () => void) => typeof child; unref: () => void };
  child = { once: (event, listener) => { if (event === "spawn") listener(); return child; }, unref: vi.fn() };
  return vi.fn(() => child);
};

const spawnFailing = () => {
  let child: { once: (event: "error" | "spawn", listener: () => void) => typeof child; unref: () => void };
  child = { once: (event, listener) => { if (event === "error") listener(); return child; }, unref: vi.fn() };
  return vi.fn(() => child);
};

const onlyExistingPath = (existing: string) => vi.fn(async (path: string) => {
  if (path === existing) return path;
  throw new Error("private filesystem detail");
});

const registeredRecord = (key: "WHATSAPP" | "CLAUDE", name: string): ApplicationRecord => ({
  id: "11111111-1111-4111-8111-111111111111",
  name,
  platform: "WINDOWS",
  launchMode: "CATALOG_APPLICATION",
  catalogKey: key,
  isFavorite: false,
  isEnabled: true,
  lastLaunchedAt: null,
  aliases: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
});

const registrationServiceFor = (adapter: ReturnType<typeof createCatalogApplicationAdapter>, name: "WHATSAPP" | "CLAUDE") => {
  const registerApplication = vi.fn(async (_input: unknown) => ({
    ok: true as const,
    data: { record: registeredRecord(name, name === "CLAUDE" ? "Claude" : "WhatsApp") }
  }));
  const service = createCatalogApplicationRegistrationService({
    applicationService: {
      listApplications: vi.fn(async () => ({ ok: true as const, data: { items: [], total: 0 } })),
      registerApplication
    },
    adapter,
    logError: vi.fn()
  });
  return { service, registerApplication };
};

describe("WhatsApp catalog detection", () => {
  it("registers through the fixed internal protocol strategy when no executable exists", async () => {
    const openFixedProtocol = vi.fn(async () => undefined);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: vi.fn(async () => { throw new Error("missing"); }),
      openFixedProtocol
    });
    const { service, registerApplication } = registrationServiceFor(adapter, "WHATSAPP");

    const result = await service.register({ catalogKey: "WHATSAPP" });

    expect(result).toEqual({ ok: true, data: { catalogKey: "WHATSAPP", alias: "whatsapp", applicationName: "WhatsApp" } });
    expect(openFixedProtocol).not.toHaveBeenCalled();
    expect(registerApplication).toHaveBeenCalledWith(expect.objectContaining({ launchMode: "CATALOG_APPLICATION", catalogKey: "WHATSAPP" }));
    expect(JSON.stringify(registerApplication.mock.calls)).not.toMatch(/whatsapp:|\.exe|C:\\/i);
  });

  it("registers and launches an installed executable without using the protocol", async () => {
    const executable = `${directories.localApplicationData}\\WhatsApp\\WhatsApp.exe`;
    const openFixedProtocol = vi.fn(async () => undefined);
    const spawn = spawnSucceeding();
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: onlyExistingPath(executable),
      stat: vi.fn(async () => ({ isFile: () => true })),
      spawn,
      openFixedProtocol
    });
    const { service } = registrationServiceFor(adapter, "WHATSAPP");

    await expect(service.register({ catalogKey: "WHATSAPP" })).resolves.toMatchObject({ ok: true });
    await expect(adapter.launch("WHATSAPP")).resolves.toEqual({ ok: true, data: { applicationName: "WhatsApp" } });
    expect(spawn).toHaveBeenCalledWith(executable, [], expect.objectContaining({ shell: false }));
    expect(openFixedProtocol).not.toHaveBeenCalled();
  });

  it("detects the per-user updater layout with fixed Main-owned arguments", async () => {
    const updater = `${directories.localApplicationData}\\WhatsApp\\Update.exe`;
    const spawn = spawnSucceeding();
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: onlyExistingPath(updater),
      stat: vi.fn(async () => ({ isFile: () => true })),
      spawn
    });
    await expect(adapter.launch("WHATSAPP")).resolves.toMatchObject({ ok: true });
    expect(spawn).toHaveBeenCalledWith(updater, ["--processStart", "WhatsApp.exe"], expect.objectContaining({ shell: false }));
  });

  it("opens through the fixed protocol by key only and never exposes the protocol string", async () => {
    const openFixedProtocol = vi.fn(async () => undefined);
    const logError = vi.fn();
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: vi.fn(async () => { throw new Error("missing"); }),
      openFixedProtocol,
      logError
    });
    const launched = await adapter.launch("WHATSAPP");
    expect(launched).toEqual({ ok: true, data: { applicationName: "WhatsApp" } });
    expect(openFixedProtocol).toHaveBeenCalledOnce();
    expect(openFixedProtocol).toHaveBeenCalledWith("WHATSAPP");
    expect(JSON.stringify([launched, openFixedProtocol.mock.calls, logError.mock.calls])).not.toMatch(/whatsapp:|spotify:/i);
  });
});

describe("closed protocol strategy table", () => {
  it("offers no protocol strategy to any key other than SPOTIFY and WHATSAPP", async () => {
    for (const key of APPLICATION_CATALOG_KEYS.filter((candidate) => candidate !== "SPOTIFY" && candidate !== "WHATSAPP")) {
      const openFixedProtocol = vi.fn(async () => undefined);
      const adapter = createCatalogApplicationAdapter({
        platform: () => "win32",
        getWindowsUserDirectories: () => directories,
        realpath: vi.fn(async () => { throw new Error("missing"); }),
        openFixedProtocol
      });
      await expect(adapter.isAvailable(key)).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });
      await expect(adapter.launch(key)).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });
      expect(openFixedProtocol).not.toHaveBeenCalled();
    }
  });

  it("does not let the default strategy open anything for a key without a protocol", async () => {
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: vi.fn(async () => { throw new Error("missing"); })
    });
    await expect(adapter.launch("CLAUDE")).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_UNAVAILABLE" } });
  });
});

describe("registered catalog application launch failure", () => {
  const registeredTarget = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "WhatsApp",
    platform: "WINDOWS" as const,
    launchMode: "CATALOG_APPLICATION" as const,
    catalogKey: "WHATSAPP" as const,
    executablePath: null,
    isEnabled: true
  };
  const launcherFor = (adapter: ReturnType<typeof createCatalogApplicationAdapter>) => createApplicationLauncher({
    applicationService: {
      resolveEnabledApplicationByAlias: vi.fn(async () => ({ ok: true as const, data: registeredTarget }))
    } as never,
    catalogAdapter: adapter,
    logError: vi.fn()
  });

  it("reports a failed protocol launch with the dedicated message, never the not-found message", async () => {
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: vi.fn(async () => { throw new Error("missing"); }),
      openFixedProtocol: vi.fn(async () => { throw new Error("private handler failure whatsapp:"); }),
      logError: vi.fn()
    });
    const result = await launcherFor(adapter).launchByAlias("whatsapp");
    expect(result).toEqual({
      ok: false,
      error: { code: "APPLICATION_CATALOG_LAUNCH_FAILED", userMessage: "No pude abrir esa aplicación. Revisa que esté instalada." }
    });
    expect(JSON.stringify(result)).not.toMatch(/No encontré|private|whatsapp:/);
  });

  it("reports a failed executable spawn with the dedicated message", async () => {
    const executable = `${directories.localApplicationData}\\Microsoft\\WindowsApps\\WhatsApp.exe`;
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: onlyExistingPath(executable),
      stat: vi.fn(async () => ({ isFile: () => true })),
      spawn: spawnFailing(),
      logError: vi.fn()
    });
    const result = await launcherFor(adapter).launchByAlias("whatsapp");
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CATALOG_LAUNCH_FAILED" } });
  });

  it("keeps the not-found message for a key that cannot be resolved", async () => {
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: vi.fn(async () => { throw new Error("missing"); })
    });
    const result = await createApplicationLauncher({
      applicationService: {
        resolveEnabledApplicationByAlias: vi.fn(async () => ({
          ok: true as const,
          data: { ...registeredTarget, name: "Claude", catalogKey: "CLAUDE" as const }
        }))
      } as never,
      catalogAdapter: adapter,
      logError: vi.fn()
    }).launchByAlias("claude");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CATALOG_UNAVAILABLE", userMessage: "No encontré esa aplicación disponible en este equipo." }
    });
  });
});

describe("Claude catalog entry", () => {
  it("resolves, registers and opens through the shared path with fixed candidates only", async () => {
    const executable = `${directories.localApplicationData}\\AnthropicClaude\\claude.exe`;
    const spawn = spawnSucceeding();
    const openFixedProtocol = vi.fn(async () => undefined);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: onlyExistingPath(executable),
      stat: vi.fn(async () => ({ isFile: () => true })),
      spawn,
      openFixedProtocol
    });
    const { service, registerApplication } = registrationServiceFor(adapter, "CLAUDE");

    await expect(service.register({ catalogKey: "CLAUDE" })).resolves.toEqual({
      ok: true,
      data: { catalogKey: "CLAUDE", alias: "claude", applicationName: "Claude" }
    });
    expect(registerApplication).toHaveBeenCalledWith(expect.objectContaining({ catalogKey: "CLAUDE", launchMode: "CATALOG_APPLICATION" }));
    await expect(adapter.launch("CLAUDE")).resolves.toEqual({ ok: true, data: { applicationName: "Claude" } });
    expect(spawn).toHaveBeenCalledWith(executable, [], expect.objectContaining({ shell: false }));
    expect(openFixedProtocol).not.toHaveBeenCalled();
  });

  it("uses only candidates anchored to fixed roots and has no protocol fallback", () => {
    const definition = getKnownApplication("CLAUDE");
    expect(definition?.windowsCandidates.length).toBeGreaterThan(0);
    for (const rule of definition?.windowsCandidates ?? []) {
      const candidate = toWindowsLaunchCandidate(rule, directories);
      expect(candidate.executablePath).toMatch(/^C:\\(Program Files|Users\\Juli\\AppData)/);
      expect(candidate.executablePath).toMatch(/\.exe$/i);
    }
  });

  it("is reported unavailable when no candidate exists", async () => {
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => directories,
      realpath: vi.fn(async () => { throw new Error("missing"); })
    });
    const { service } = registrationServiceFor(adapter, "CLAUDE");
    await expect(service.prepare({ catalogKey: "CLAUDE" })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CATALOG_UNAVAILABLE" }
    });
  });
});

describe("declarative catalog", () => {
  it("has exactly one entry for each catalog key", () => {
    expect(KNOWN_APPLICATION_CATALOG.map((entry) => entry.key)).toEqual([...APPLICATION_CATALOG_KEYS]);
  });

  it("never lets one normalized alias belong to two applications", () => {
    const owners = new Map<string, string>();
    for (const entry of KNOWN_APPLICATION_CATALOG) {
      for (const alias of new Set([entry.defaultAlias, ...entry.recognitionAliases].map(normalizeApplicationAlias))) {
        expect(owners.get(alias) ?? entry.key).toBe(entry.key);
        owners.set(alias, entry.key);
      }
    }
    expect(owners.get("claude")).toBe("CLAUDE");
  });

  it("derives launch candidates from data alone, so a new entry needs no executor or adapter code", () => {
    const fakeRule = { root: "LOCAL_APP_DATA" as const, segments: ["FakeApp", "fake.exe"], arguments: ["--start"] };
    expect(toWindowsLaunchCandidate(fakeRule, directories)).toEqual({
      executablePath: "C:\\Users\\Juli\\AppData\\Local\\FakeApp\\fake.exe",
      arguments: ["--start"]
    });
    expect(toWindowsLaunchCandidate({ root: "PROGRAM_FILES", segments: ["Fake", "fake.exe"] }, directories).executablePath)
      .toBe("C:\\Program Files\\Fake\\fake.exe");
  });

  it("keeps launch rules and protocol data out of the provider projection", async () => {
    const { getKnownApplicationProviderReferences } = await import("../src/main/applications/known-application-catalog");
    expect(JSON.stringify(getKnownApplicationProviderReferences())).not.toMatch(/AppData|Program Files|\.exe|whatsapp:|spotify:|root|segments/i);
  });
});
