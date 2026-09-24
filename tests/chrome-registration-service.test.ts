import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn() } }));

import { createChromeRegistrationService } from "../src/main/applications/chrome-registration-service";
import type { ApplicationService } from "../src/main/applications/application-service";
import type { ApplicationRecord } from "../src/shared/application-contracts";

const selectedPath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const chromeRecord: ApplicationRecord = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "Google Chrome",
  platform: "WINDOWS",
  isFavorite: false,
  isEnabled: true,
  lastLaunchedAt: null,
  aliases: [{ id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", applicationId: "550e8400-e29b-41d4-a716-446655440000", alias: "chrome", createdAt: "2026-09-20T00:00:00.000Z" }],
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z"
};

const createApplicationService = (items: ApplicationRecord[] = []) => {
  const listApplications = vi.fn(async () => ({ ok: true as const, data: { items, total: items.length } }));
  const registerApplication = vi.fn(async () => ({ ok: true as const, data: { record: chromeRecord } }));
  return { service: { listApplications, registerApplication } as unknown as ApplicationService, listApplications, registerApplication };
};

const createService = (overrides: Record<string, unknown> = {}) => {
  const application = createApplicationService();
  return {
    application,
    service: createChromeRegistrationService({
      applicationService: application.service,
      showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }),
      realpath: async () => selectedPath,
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn(),
      ...overrides
    })
  };
};

describe("Main-only Chrome registration", () => {
  it("registers only the selected canonical chrome.exe with fixed trusted catalog values", async () => {
    const { application, service } = createService();

    const result = await service.registerChrome();

    expect(result).toEqual({ ok: true, data: { status: "REGISTERED", record: chromeRecord } });
    expect(application.registerApplication).toHaveBeenCalledWith({
      name: "Google Chrome",
      executablePath: selectedPath,
      aliases: ["chrome"],
      platform: "WINDOWS",
      isEnabled: true
    });
    expect(JSON.stringify(result)).not.toContain(selectedPath);
  });

  it("does not write when the native selection is cancelled", async () => {
    const { application, service } = createService({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });

    await expect(service.registerChrome()).resolves.toEqual({ ok: true, data: { status: "CANCELLED" } });
    expect(application.registerApplication).not.toHaveBeenCalled();
  });

  it("rejects a non-Chrome selection or a non-regular file without forwarding a path", async () => {
    const invalidName = createService({
      realpath: async () => "C:\\Programs\\other.exe"
    });
    const nonFile = createService({
      stat: async () => ({ isFile: () => false })
    });

    for (const candidate of [invalidName, nonFile]) {
      const result = await candidate.service.registerChrome();
      expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CHROME_SELECTION_INVALID" } });
      expect(JSON.stringify(result)).not.toContain(selectedPath);
      expect(candidate.application.registerApplication).not.toHaveBeenCalled();
    }
  });

  it("returns an idempotent public result for an existing trusted Chrome record without opening the picker", async () => {
    const application = createApplicationService([chromeRecord]);
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [selectedPath] }));
    const service = createChromeRegistrationService({
      applicationService: application.service,
      showOpenDialog,
      realpath: async () => selectedPath,
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn()
    });

    await expect(service.registerChrome()).resolves.toEqual({
      ok: true,
      data: { status: "ALREADY_REGISTERED", record: chromeRecord }
    });
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(application.registerApplication).not.toHaveBeenCalled();
  });

  it("does not overwrite a conflicting application or alias", async () => {
    const conflictingRecord = {
      ...chromeRecord,
      id: "550e8400-e29b-41d4-a716-446655440001",
      name: "Another browser",
      aliases: [{ ...chromeRecord.aliases[0], applicationId: "550e8400-e29b-41d4-a716-446655440001" }]
    };
    const application = createApplicationService([conflictingRecord]);
    const service = createChromeRegistrationService({
      applicationService: application.service,
      showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }),
      realpath: async () => selectedPath,
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn()
    });

    await expect(service.registerChrome()).resolves.toMatchObject({
      ok: false,
      error: { code: "APPLICATION_CONFLICT" }
    });
    expect(application.registerApplication).not.toHaveBeenCalled();
  });

  it("redacts selected-path resolution failures", async () => {
    const logError = vi.fn();
    const { service } = createService({ realpath: async () => { throw new Error(selectedPath); }, logError });

    const result = await service.registerChrome();

    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_CHROME_SELECTION_INVALID" } });
    expect(JSON.stringify(result)).not.toContain(selectedPath);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(selectedPath);
  });
});
