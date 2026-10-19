import { describe, expect, it, vi } from "vitest";
import { createCatalogApplicationAdapter } from "../src/main/applications/catalog-application-adapter";
import {
  KNOWN_APPLICATION_CATALOG,
  getKnownApplicationProviderReferences,
  isKnownApplicationCatalogKey
} from "../src/main/applications/known-application-catalog";

describe("known application catalog", () => {
  it("contains exactly the approved catalog keys and Spanish display names", () => {
    expect(KNOWN_APPLICATION_CATALOG.map((entry) => [entry.key, entry.displayName])).toEqual([
      ["GOOGLE_CHROME", "Google Chrome"],
      ["MICROSOFT_EDGE", "Microsoft Edge"],
      ["MOZILLA_FIREFOX", "Mozilla Firefox"],
      ["SPOTIFY", "Spotify"],
      ["WHATSAPP", "WhatsApp"],
      ["MICROSOFT_WORD", "Microsoft Word"],
      ["VISUAL_STUDIO_CODE", "Visual Studio Code"],
      ["DISCORD", "Discord"],
      ["CLAUDE", "Claude"]
    ]);
    expect(isKnownApplicationCatalogKey("UNTRUSTED")).toBe(false);
  });

  it("projects no candidate paths or launch data to the provider", () => {
    expect(JSON.stringify(getKnownApplicationProviderReferences())).not.toMatch(/Program Files|\.exe|shell|arguments/i);
  });

  it("launches a traditional desktop application only through its fixed candidate", async () => {
    const realpath = vi.fn(async (path: string) => path);
    const stat = vi.fn(async () => ({ isFile: () => true }));
    let spawned: { once: (event: "error" | "spawn", listener: () => void) => typeof spawned; unref: () => void };
    spawned = {
      once: (event, listener) => { if (event === "spawn") listener(); return spawned; },
      unref: vi.fn()
    };
    const spawn = vi.fn(() => spawned);
    const adapter = createCatalogApplicationAdapter({ platform: () => "win32", realpath, stat, spawn });

    await expect(adapter.isAvailable("GOOGLE_CHROME")).resolves.toMatchObject({ ok: true });
    await expect(adapter.launch("GOOGLE_CHROME")).resolves.toMatchObject({ ok: true, data: { applicationName: "Google Chrome" } });
    expect(realpath.mock.calls[0]?.[0]).toMatch(/^C:\\Program Files/);
    expect(spawn).toHaveBeenCalledWith(expect.any(String), [], expect.objectContaining({ shell: false }));
    await expect(adapter.isAvailable("C:\\untrusted.exe")).resolves.toMatchObject({ ok: false });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("launches Spotify through the fixed App Execution Alias under trusted local application data", async () => {
    const localApplicationData = "C:\\Users\\Juli\\AppData\\Local";
    const roamingApplicationData = "C:\\Users\\Juli\\AppData\\Roaming";
    const appExecutionAlias = `${localApplicationData}\\Microsoft\\WindowsApps\\Spotify.exe`;
    const realpath = vi.fn(async (path: string) => {
      if (path === appExecutionAlias) return path;
      throw new Error("not found");
    });
    let spawned: { once: (event: "error" | "spawn", listener: () => void) => typeof spawned; unref: () => void };
    spawned = {
      once: (event, listener) => { if (event === "spawn") listener(); return spawned; },
      unref: vi.fn()
    };
    const spawn = vi.fn(() => spawned);
    const openFixedProtocol = vi.fn(async () => undefined);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => ({ localApplicationData, roamingApplicationData }),
      realpath,
      stat: vi.fn(async () => ({ isFile: () => true })),
      spawn,
      openFixedProtocol
    });

    await expect(adapter.isAvailable("SPOTIFY")).resolves.toMatchObject({ ok: true });
    expect(realpath).toHaveBeenCalledWith(`${roamingApplicationData}\\Spotify\\Spotify.exe`);
    expect(realpath).toHaveBeenCalledWith(appExecutionAlias);
    expect(JSON.stringify(await adapter.isAvailable("SPOTIFY"))).not.toContain(localApplicationData);

    await expect(adapter.launch("SPOTIFY")).resolves.toEqual({
      ok: true,
      data: { applicationName: "Spotify" }
    });
    expect(spawn).toHaveBeenCalledWith(appExecutionAlias, [], expect.objectContaining({ shell: false }));
    expect(JSON.stringify(spawn.mock.calls)).not.toContain("--");
    expect(openFixedProtocol).not.toHaveBeenCalled();
  });

  it("keeps fixed Discord updater arguments Main-owned", async () => {
    const localApplicationData = "C:\\Users\\Juli\\AppData\\Local";
    const trustedTarget = `${localApplicationData}\\Discord\\Update.exe`;
    let spawned: { once: (event: "error" | "spawn", listener: () => void) => typeof spawned; unref: () => void };
    spawned = {
      once: (event, listener) => { if (event === "spawn") listener(); return spawned; },
      unref: vi.fn()
    };
    const spawn = vi.fn(() => spawned);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => ({
        localApplicationData,
        roamingApplicationData: "C:\\Users\\Juli\\AppData\\Roaming"
      }),
      realpath: vi.fn(async (path: string) => {
        if (path === trustedTarget) return path;
        throw new Error("not found");
      }),
      stat: vi.fn(async () => ({ isFile: () => true })),
      spawn
    });

    await expect(adapter.launch("DISCORD")).resolves.toMatchObject({ ok: true, data: { applicationName: "Discord" } });
    expect(spawn).toHaveBeenCalledWith(trustedTarget, ["--processStart", "Discord.exe"], expect.objectContaining({ shell: false }));
  });

  it("uses the fixed internal Spotify protocol only when every executable candidate is absent", async () => {
    const missing = vi.fn(async () => { throw new Error("private filesystem detail"); });
    const openFixedProtocol = vi.fn(async () => undefined);
    const spawn = vi.fn();
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      getWindowsUserDirectories: () => ({
        localApplicationData: "C:\\Users\\Juli\\AppData\\Local",
        roamingApplicationData: "C:\\Users\\Juli\\AppData\\Roaming"
      }),
      realpath: missing,
      spawn,
      openFixedProtocol
    });

    await expect(adapter.isAvailable("SPOTIFY")).resolves.toEqual({ ok: true, data: { available: true } });
    await expect(adapter.launch("SPOTIFY")).resolves.toEqual({ ok: true, data: { applicationName: "Spotify" } });
    expect(openFixedProtocol).toHaveBeenCalledOnce();
    expect(openFixedProtocol).toHaveBeenCalledWith("SPOTIFY");
    expect(spawn).not.toHaveBeenCalled();
    expect(JSON.stringify(openFixedProtocol.mock.calls)).not.toContain("spotify:");
  });

  it("never selects the Spotify protocol strategy for another catalog key", async () => {
    const openFixedProtocol = vi.fn(async () => undefined);
    const adapter = createCatalogApplicationAdapter({
      platform: () => "win32",
      realpath: vi.fn(async () => { throw new Error("not found"); }),
      openFixedProtocol
    });

    await expect(adapter.isAvailable("GOOGLE_CHROME")).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CATALOG_UNAVAILABLE" }
    });
    await expect(adapter.launch("GOOGLE_CHROME")).resolves.toMatchObject({ ok: false });
    expect(openFixedProtocol).not.toHaveBeenCalled();
  });

  it("returns a controlled unavailable result without probing unsupported platforms", async () => {
    const realpath = vi.fn();
    const adapter = createCatalogApplicationAdapter({ platform: () => "linux", realpath });
    await expect(adapter.launch("SPOTIFY")).resolves.toMatchObject({
      ok: false,
      error: { userMessage: "No encontré esa aplicación disponible en este equipo." }
    });
    expect(realpath).not.toHaveBeenCalled();
  });

  it("rejects unknown catalog input before candidate resolution or launch", async () => {
    const realpath = vi.fn();
    const spawn = vi.fn();
    const adapter = createCatalogApplicationAdapter({ platform: () => "win32", realpath, spawn });

    await expect(adapter.launch({ key: "SPOTIFY", executablePath: "C:\\unsafe.exe", arguments: ["--unsafe"] })).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CATALOG_UNAVAILABLE" }
    });
    expect(realpath).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
