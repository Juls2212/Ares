import { describe, expect, it, vi } from "vitest";
import { createApplicationLauncher } from "../src/main/applications/application-launcher";
import { resolveTrustedWebDestination } from "../src/main/applications/trusted-web-destinations";
import type { ApplicationService } from "../src/main/applications/application-service";
import type { ResolvedApplicationTarget } from "../src/main/applications/application-repositories";
import type { OperationResult } from "../src/shared/contracts";

const executablePath = "C:\\Registered Apps\\Ares Test\\launcher.exe";
const canonicalPath = "C:\\Canonical Apps\\Ares Test\\launcher.exe";

const target: ResolvedApplicationTarget = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Aplicación de prueba",
  platform: "WINDOWS",
  executablePath,
  isEnabled: true
};

type TestChild = {
  child: {
    once: (event: "error" | "spawn", listener: () => void) => TestChild["child"];
    unref: () => void;
  };
  unref: ReturnType<typeof vi.fn>;
  emit: (event: "error" | "spawn") => void;
};

const createChild = (): TestChild => {
  const listeners = new Map<string, () => void>();
  const unref = vi.fn();
  const child = {
    once: vi.fn((event: "error" | "spawn", listener: () => void) => {
      listeners.set(event, listener);
      return child;
    }),
    unref: () => unref()
  };
  return {
    child,
    unref,
    emit: (event) => listeners.get(event)?.()
  };
};

const createApplicationService = (
  result: OperationResult<ResolvedApplicationTarget> = { ok: true, data: target }
): ApplicationService =>
  ({
    resolveEnabledApplicationByAlias: vi.fn(async () => result)
  }) as unknown as ApplicationService;

const createLauncher = (overrides: Record<string, unknown> = {}) => {
  const child = createChild();
  const spawn = vi.fn(() => {
    queueMicrotask(() => child.emit("spawn"));
    return child.child;
  });
  const applicationService = createApplicationService();
  const realpath = vi.fn(async () => canonicalPath);
  const stat = vi.fn(async () => ({ isFile: () => true }));
  const logError = vi.fn();
  return {
    child,
    spawn,
    applicationService,
    realpath,
    stat,
    logError,
    launcher: createApplicationLauncher({
      applicationService,
      realpath,
      stat,
      spawn,
      logError,
      ...overrides
    })
  };
};

describe("application launcher", () => {
  it("resolves an enabled registered alias and spawns exactly its canonical executable", async () => {
    const { launcher, applicationService, realpath, stat, spawn, child } = createLauncher();

    const result = await launcher.launchByAlias("Word");

    expect(applicationService.resolveEnabledApplicationByAlias).toHaveBeenCalledWith("Word");
    expect(realpath).toHaveBeenCalledWith(executablePath);
    expect(stat).toHaveBeenCalledWith(canonicalPath);
    expect(spawn).toHaveBeenCalledWith(canonicalPath, [], {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    expect(child.unref).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, data: { applicationName: target.name } });
    expect(JSON.stringify(result)).not.toContain(executablePath);
    expect(JSON.stringify(result)).not.toContain(canonicalPath);
    expect(JSON.stringify(result)).not.toContain("pid");
  });

  it("launches a trusted browser target with only the fixed catalog URL and no fallback", async () => {
    const { launcher, spawn } = createLauncher();
    const destination = resolveTrustedWebDestination("YOUTUBE");
    if (!destination) throw new Error("Expected trusted destination.");

    const result = await launcher.launchResolvedBrowserTarget(target, destination);

    expect(spawn).toHaveBeenCalledWith(canonicalPath, ["https://www.youtube.com/"], {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    expect(result).toEqual({ ok: true, data: { applicationName: target.name } });
    expect(JSON.stringify(result)).not.toContain("youtube.com");
    expect(JSON.stringify(result)).not.toContain(canonicalPath);
  });

  it("returns controlled alias and disabled failures without filesystem or process access", async () => {
    const missingService = createApplicationService({
      ok: false,
      error: { code: "APPLICATION_NOT_FOUND", userMessage: "No se encontró la aplicación solicitada." }
    });
    const missing = createLauncher({ applicationService: missingService });
    await expect(missing.launcher.launchByAlias("Unknown")).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_NOT_FOUND" }
    });
    expect(missing.realpath).not.toHaveBeenCalled();
    expect(missing.spawn).not.toHaveBeenCalled();

    const disabledService = createApplicationService({
      ok: false,
      error: { code: "APPLICATION_DISABLED", userMessage: "La aplicación está deshabilitada." }
    });
    const disabled = createLauncher({ applicationService: disabledService });
    await expect(disabled.launcher.launchByAlias("Word")).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_DISABLED" }
    });
    expect(disabled.realpath).not.toHaveBeenCalled();
  });

  it("rejects invalid, missing, non-file, and non-executable registered targets", async () => {
    const invalid = createLauncher();
    await expect(
      invalid.launcher.launchResolvedTarget({ ...target, executablePath: "C:\\Registered Apps\\launcher.cmd" })
    ).resolves.toMatchObject({ ok: false, error: { code: "APPLICATION_EXECUTABLE_PATH_INVALID" } });
    expect(invalid.realpath).not.toHaveBeenCalled();

    const missing = createLauncher({ realpath: vi.fn(async () => { throw new Error("missing"); }) });
    await expect(missing.launcher.launchResolvedTarget(target)).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_EXECUTABLE_NOT_FOUND" }
    });

    const nonFile = createLauncher({ stat: vi.fn(async () => ({ isFile: () => false })) });
    await expect(nonFile.launcher.launchResolvedTarget(target)).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_EXECUTABLE_NOT_FILE" }
    });

    const wrongExtension = createLauncher({ realpath: vi.fn(async () => "C:\\Canonical Apps\\launcher.txt") });
    await expect(wrongExtension.launcher.launchResolvedTarget(target)).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_EXECUTABLE_EXTENSION_INVALID" }
    });
  });

  it("maps synchronous and asynchronous spawn failures without technical leakage", async () => {
    const synchronous = createLauncher({
      spawn: vi.fn(() => {
        throw new Error(`failed ${executablePath}`);
      })
    });
    const syncResult = await synchronous.launcher.launchResolvedTarget(target);
    expect(syncResult).toMatchObject({ ok: false, error: { code: "APPLICATION_LAUNCH_FAILED" } });
    expect(JSON.stringify(syncResult)).not.toContain(executablePath);

    const child = createChild();
    const asynchronous = createLauncher({
      spawn: vi.fn(() => {
        queueMicrotask(() => child.emit("error"));
        return child.child;
      })
    });
    await expect(asynchronous.launcher.launchResolvedTarget(target)).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_LAUNCH_FAILED" }
    });
    expect(child.unref).not.toHaveBeenCalled();
  });
});
