import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createApplicationIpcRegistration,
  type ApplicationIpcHandler,
  type ApplicationIpcHandlerRegistrar
} from "../src/main/ipc/register-application-ipc";
import type { ApplicationService } from "../src/main/applications/application-service";
import type { CatalogApplicationRegistrationService } from "../src/main/applications/catalog-application-registration-service";
import type { CustomApplicationRegistrationService } from "../src/main/applications/custom-application-registration-service";
import { IPC_CHANNELS, type OperationResult } from "../src/shared/contracts";

const successResult: OperationResult<never> = { ok: true, data: undefined as never };

const createService = (): {
  service: ApplicationService;
  methods: Record<"listApplications" | "updateApplication", ReturnType<typeof vi.fn>>;
  catalogRegistrationService: CatalogApplicationRegistrationService;
  customRegistrationService: CustomApplicationRegistrationService;
} => {
  const methods = {
    listApplications: vi.fn(async () => successResult),
    updateApplication: vi.fn(async () => successResult)
  };
  return {
    service: methods as unknown as ApplicationService,
    methods,
    catalogRegistrationService: {
      registerCatalogApplication: vi.fn(async () => successResult)
    } as unknown as CatalogApplicationRegistrationService,
    customRegistrationService: {
      registerCustomApplication: vi.fn(async () => successResult)
    } as unknown as CustomApplicationRegistrationService
  };
};

const channelDelegations: ReadonlyArray<{
  channel: string;
  method: "listApplications" | "updateApplication";
  input: unknown;
}> = [
  { channel: IPC_CHANNELS.applications.list, method: "listApplications", input: { enabled: true } },
  {
    channel: IPC_CHANNELS.applications.update,
    method: "updateApplication",
    input: { applicationId: "550e8400-e29b-41d4-a716-446655440000", isEnabled: false }
  }
];

describe("application catalog IPC registration", () => {
  it("registers exactly the approved application catalog channels once", () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, catalogRegistrationService, customRegistrationService } = createService();
    const register = createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getCatalogApplicationRegistrationService: () => catalogRegistrationService,
      getCustomApplicationRegistrationService: () => customRegistrationService,
      logError: vi.fn()
    });

    register();
    register();

    expect(IPC_CHANNELS.applications).toEqual({
      registerCatalogApplication: "applications:register-catalog-application",
      registerCustomApplication: "applications:register-custom-application",
      list: "applications:list",
      update: "applications:update"
    });
    expect([...handlers.keys()]).toEqual([
      "applications:register-catalog-application",
      "applications:register-custom-application",
      ...channelDelegations.map(({ channel }) => channel)
    ]);
    expect(handlers.size).toBe(4);
  });

  it.each(channelDelegations)("delegates $channel only to $method", async ({ channel, method, input }) => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, methods, catalogRegistrationService, customRegistrationService } = createService();
    createApplicationIpcRegistration({
      registerHandler: (registeredChannel, handler) => handlers.set(registeredChannel, handler),
      getService: () => service,
      getCatalogApplicationRegistrationService: () => catalogRegistrationService,
      getCustomApplicationRegistrationService: () => customRegistrationService,
      logError: vi.fn()
    })();

    const result = await handlers.get(channel)?.(input);

    expect(result).toEqual(successResult);
    expect(methods[method]).toHaveBeenCalledWith(input);
  });

  it("maps unexpected handler failures without leaking application details", async () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, methods, catalogRegistrationService, customRegistrationService } = createService();
    const secret = "C:\\private\\application.exe";
    methods.updateApplication.mockRejectedValueOnce(new Error(secret));
    const logError = vi.fn();
    createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getCatalogApplicationRegistrationService: () => catalogRegistrationService,
      getCustomApplicationRegistrationService: () => customRegistrationService,
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.applications.update)?.({});

    expect(result).toEqual({
      ok: false,
      error: {
        code: "APPLICATION_IPC_UNAVAILABLE",
        userMessage: "No se pudo procesar la solicitud de aplicaciones."
      }
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Application catalog IPC handler failed.");
  });

  it("delegates the closed catalog registration input without a generic picker payload", async () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, catalogRegistrationService, customRegistrationService } = createService();
    createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getCatalogApplicationRegistrationService: () => catalogRegistrationService,
      getCustomApplicationRegistrationService: () => customRegistrationService,
      logError: vi.fn()
    })();

    const input = { application: "SPOTIFY" };
    await expect(handlers.get(IPC_CHANNELS.applications.registerCatalogApplication)?.(input)).resolves.toEqual(successResult);
    expect(catalogRegistrationService.registerCatalogApplication).toHaveBeenCalledWith(input);
  });

  it("maps catalog registration handler failures without leaking selection details", async () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, catalogRegistrationService, customRegistrationService } = createService();
    const secret = "C:\\private\\chrome.exe";
    vi.mocked(catalogRegistrationService.registerCatalogApplication).mockRejectedValueOnce(new Error(secret));
    const logError = vi.fn();
    createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getCatalogApplicationRegistrationService: () => catalogRegistrationService,
      getCustomApplicationRegistrationService: () => customRegistrationService,
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.applications.registerCatalogApplication)?.({ application: "GOOGLE_CHROME" });
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Catalog application registration IPC handler failed.");
  });

  it("delegates the display-name-only custom registration request", async () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, catalogRegistrationService, customRegistrationService } = createService();
    createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getCatalogApplicationRegistrationService: () => catalogRegistrationService,
      getCustomApplicationRegistrationService: () => customRegistrationService,
      logError: vi.fn()
    })();

    const input = { displayName: "My Application" };
    await expect(handlers.get(IPC_CHANNELS.applications.registerCustomApplication)?.(input)).resolves.toEqual(successResult);
    expect(customRegistrationService.registerCustomApplication).toHaveBeenCalledWith(input);
  });
});
