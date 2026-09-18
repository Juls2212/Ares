import { describe, expect, it, vi } from "vitest";
import {
  createApplicationService
} from "../src/main/applications/application-service";
import {
  ApplicationRepositoryError,
  type ApplicationRepositories,
  type ResolvedApplicationTarget
} from "../src/main/applications/application-repositories";
import type { ApplicationRecord } from "../src/shared/application-contracts";

const applicationId = "550e8400-e29b-41d4-a716-446655440000";
const executablePath = "C:\\Program Files\\Microsoft Office\\WINWORD.EXE";

const application: ApplicationRecord = {
  id: applicationId,
  name: "Microsoft Word",
  platform: "WINDOWS",
  isFavorite: false,
  isEnabled: true,
  lastLaunchedAt: null,
  aliases: [
    {
      id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
      applicationId,
      alias: "Word",
      createdAt: "2026-09-17T14:30:00.000Z"
    }
  ],
  createdAt: "2026-09-17T14:30:00.000Z",
  updatedAt: "2026-09-17T14:30:00.000Z"
};

const resolvedTarget: ResolvedApplicationTarget = {
  id: applicationId,
  name: application.name,
  platform: "WINDOWS",
  executablePath,
  isEnabled: true
};

const createRepositories = (): ApplicationRepositories => ({
  registerApplication: vi.fn(async () => application),
  listApplications: vi.fn(async () => [application]),
  updateApplication: vi.fn(async () => application),
  findApplicationIdByNormalizedName: vi.fn(async () => undefined),
  resolveApplicationByAlias: vi.fn(async () => resolvedTarget)
});

const validRegistration = {
  name: "Microsoft Word",
  executablePath,
  aliases: ["Word"]
};

const expectFailureCode = <T>(result: { ok: boolean; error?: { code: string } }, code: string): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error?.code).toBe(code);
};

describe("application service", () => {
  it("registers and lists only safe public records", async () => {
    const repositories = createRepositories();
    const service = createApplicationService({ repositories, logError: vi.fn() });

    await expect(service.registerApplication(validRegistration)).resolves.toEqual({
      ok: true,
      data: { record: application }
    });
    await expect(service.listApplications({})).resolves.toEqual({
      ok: true,
      data: { items: [application], total: 1 }
    });
    expect(JSON.stringify(application)).not.toContain(executablePath);
  });

  it("maps duplicate conflicts, missing records, disabled records, and database failures safely", async () => {
    const repositories = createRepositories();
    const logError = vi.fn();
    const service = createApplicationService({ repositories, logError });

    vi.mocked(repositories.findApplicationIdByNormalizedName).mockResolvedValueOnce(applicationId);
    expectFailureCode(await service.registerApplication(validRegistration), "APPLICATION_CONFLICT");
    expect(repositories.registerApplication).not.toHaveBeenCalled();

    vi.mocked(repositories.registerApplication).mockRejectedValueOnce(
      new ApplicationRepositoryError("CONFLICT")
    );
    expectFailureCode(await service.registerApplication(validRegistration), "APPLICATION_CONFLICT");

    vi.mocked(repositories.updateApplication).mockResolvedValueOnce(undefined);
    expectFailureCode(
      await service.updateApplication({ applicationId, name: "Nuevo nombre" }),
      "APPLICATION_NOT_FOUND"
    );

    vi.mocked(repositories.resolveApplicationByAlias).mockResolvedValueOnce({
      ...resolvedTarget,
      isEnabled: false
    });
    expectFailureCode(await service.resolveEnabledApplicationByAlias("Word"), "APPLICATION_DISABLED");

    const password = "must-not-leak-password";
    vi.mocked(repositories.listApplications).mockRejectedValueOnce(
      new Error(`database failure for ${password}`)
    );
    const result = await service.listApplications({});
    expectFailureCode(result, "APPLICATION_DATABASE_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(password);
  });

  it("keeps resolved executable targets Main-only and validates aliases before repository access", async () => {
    const repositories = createRepositories();
    const service = createApplicationService({ repositories, logError: vi.fn() });

    await expect(service.resolveEnabledApplicationByAlias("  Word  ")).resolves.toEqual({
      ok: true,
      data: resolvedTarget
    });
    expect(repositories.resolveApplicationByAlias).toHaveBeenCalledWith("Word");

    expectFailureCode(
      await service.resolveEnabledApplicationByAlias("   "),
      "APPLICATION_TEXT_INVALID"
    );
    expect(repositories.resolveApplicationByAlias).toHaveBeenCalledTimes(1);
  });
});
