import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() } }));

import { createCustomApplicationRegistrationService } from "../src/main/applications/custom-application-registration-service";
import type { ApplicationService } from "../src/main/applications/application-service";
import type {
  ApplicationMutationData,
  ApplicationOperationResult,
  ApplicationRecord
} from "../src/shared/application-contracts";

const selectedPath = "C:\\Program Files\\Example Tools\\Example App.exe";
const canonicalPath = "C:\\Program Files\\Example Tools\\Example App.exe";

const existingRecord = (name = "Example App", alias = "example-app"): ApplicationRecord => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  name,
  platform: "WINDOWS",
  isFavorite: false,
  isEnabled: true,
  lastLaunchedAt: null,
  aliases: [{ id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8", applicationId: "550e8400-e29b-41d4-a716-446655440000", alias, createdAt: "2026-09-20T00:00:00.000Z" }],
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z"
});

const applicationServiceFor = (
  items: ApplicationRecord[] = [],
  registerResult: ApplicationOperationResult<ApplicationMutationData> = {
    ok: true,
    data: { record: existingRecord() }
  }
) => {
  const listApplications = vi.fn(async () => ({ ok: true as const, data: { items, total: items.length } }));
  const registerApplication = vi.fn(async () => registerResult);
  return {
    service: { listApplications, registerApplication } as unknown as ApplicationService,
    listApplications,
    registerApplication
  };
};

const createService = (overrides: Record<string, unknown> = {}) => {
  const application = applicationServiceFor();
  const showConfirmation = vi.fn(async () => ({ response: 1 }));
  return {
    application,
    showConfirmation,
    service: createCustomApplicationRegistrationService({
      applicationService: application.service,
      showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }),
      showConfirmation,
      realpath: async () => canonicalPath,
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn(),
      ...overrides
    })
  };
};

describe("Main-only custom application registration", () => {
  it("registers a valid display name with a deterministic Main-derived alias", async () => {
    const { application, showConfirmation, service } = createService();

    await expect(service.registerCustomApplication({ displayName: "  Example App  " })).resolves.toEqual({
      ok: true,
      data: { status: "REGISTERED" }
    });
    expect(showConfirmation).toHaveBeenCalledWith("Example App", "Example App.exe");
    expect(application.registerApplication).toHaveBeenCalledWith({
      name: "Example App",
      executablePath: canonicalPath,
      aliases: ["example-app"],
      platform: "WINDOWS",
      isEnabled: true
    });
  });

  it("rejects blank, unsafe, overlong, and unknown-field input before opening a picker", async () => {
    const { application, service } = createService();
    for (const input of [
      { displayName: "   " },
      { displayName: "Example && cmd" },
      { displayName: "A".repeat(161) },
      { displayName: "Example", executablePath: selectedPath }
    ]) {
      await expect(service.registerCustomApplication(input)).resolves.toMatchObject({ ok: false });
    }
    expect(application.registerApplication).not.toHaveBeenCalled();
  });

  it("does not persist when the picker or Main confirmation is cancelled", async () => {
    const pickerCancelled = createService({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
    const confirmationCancelled = createService({ showConfirmation: async () => ({ response: 0 }) });

    await expect(pickerCancelled.service.registerCustomApplication({ displayName: "Example App" })).resolves.toEqual({ ok: true, data: { status: "CANCELLED" } });
    await expect(confirmationCancelled.service.registerCustomApplication({ displayName: "Example App" })).resolves.toEqual({ ok: true, data: { status: "CANCELLED" } });
    expect(pickerCancelled.application.registerApplication).not.toHaveBeenCalled();
    expect(confirmationCancelled.application.registerApplication).not.toHaveBeenCalled();
  });

  it("rejects non-executables, non-regular files, and canonicalization failures without exposing paths", async () => {
    const nonExecutable = createService({ realpath: async () => "C:\\Programs\\example.txt" });
    const nonRegular = createService({ stat: async () => ({ isFile: () => false }) });
    const logError = vi.fn();
    const unresolvable = createService({
      realpath: async () => {
        throw new Error(selectedPath);
      },
      logError
    });
    for (const candidate of [nonExecutable, nonRegular, unresolvable]) {
      const result = await candidate.service.registerCustomApplication({ displayName: "Example App" });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "APPLICATION_CUSTOM_SELECTION_INVALID" }
      });
      expect(JSON.stringify(result)).not.toContain(selectedPath);
      expect(candidate.application.registerApplication).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(logError.mock.calls)).not.toContain(selectedPath);
  });

  it("returns an idempotent outcome for an exact existing custom application without opening a picker", async () => {
    const application = applicationServiceFor([existingRecord()]);
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [selectedPath] }));
    const service = createCustomApplicationRegistrationService({
      applicationService: application.service,
      showOpenDialog,
      showConfirmation: async () => ({ response: 1 }),
      realpath: async () => canonicalPath,
      stat: async () => ({ isFile: () => true }),
      logError: vi.fn()
    });

    await expect(service.registerCustomApplication({ displayName: "Example App" })).resolves.toEqual({
      ok: true,
      data: { status: "ALREADY_REGISTERED" }
    });
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(application.registerApplication).not.toHaveBeenCalled();
  });

  it("rejects display-name, alias, and executable-path conflicts without overwriting data", async () => {
    const nameConflict = applicationServiceFor([existingRecord("Example App", "other")]);
    const aliasConflict = applicationServiceFor([existingRecord("Other App", "example-app")]);
    const executableConflict = applicationServiceFor([], {
      ok: false as const,
      error: { code: "APPLICATION_CONFLICT", userMessage: "private" }
    });
    const candidates = [
      createCustomApplicationRegistrationService({ applicationService: nameConflict.service, showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }), showConfirmation: async () => ({ response: 1 }), realpath: async () => canonicalPath, stat: async () => ({ isFile: () => true }), logError: vi.fn() }),
      createCustomApplicationRegistrationService({ applicationService: aliasConflict.service, showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }), showConfirmation: async () => ({ response: 1 }), realpath: async () => canonicalPath, stat: async () => ({ isFile: () => true }), logError: vi.fn() }),
      createCustomApplicationRegistrationService({ applicationService: executableConflict.service, showOpenDialog: async () => ({ canceled: false, filePaths: [selectedPath] }), showConfirmation: async () => ({ response: 1 }), realpath: async () => canonicalPath, stat: async () => ({ isFile: () => true }), logError: vi.fn() })
    ];

    for (const service of candidates) {
      const result = await service.registerCustomApplication({ displayName: "Example App" });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "APPLICATION_CONFLICT" }
      });
      expect(JSON.stringify(result)).not.toContain("private");
    }
    expect(nameConflict.registerApplication).not.toHaveBeenCalled();
    expect(aliasConflict.registerApplication).not.toHaveBeenCalled();
  });
});
