import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import {
  createApplicationIpcRegistration,
  type ApplicationIpcHandler,
  type ApplicationIpcHandlerRegistrar
} from "../src/main/ipc/register-application-ipc";
import type { ApplicationService } from "../src/main/applications/application-service";
import type { ChromeRegistrationService } from "../src/main/applications/chrome-registration-service";
import { IPC_CHANNELS, type OperationResult } from "../src/shared/contracts";

const successResult: OperationResult<never> = { ok: true, data: undefined as never };

const createService = (): {
  service: ApplicationService;
  methods: Record<"registerApplication" | "listApplications" | "updateApplication", ReturnType<typeof vi.fn>>;
  chromeService: ChromeRegistrationService;
} => {
  const methods = {
    registerApplication: vi.fn(async () => successResult),
    listApplications: vi.fn(async () => successResult),
    updateApplication: vi.fn(async () => successResult)
  };
  return {
    service: methods as unknown as ApplicationService,
    methods,
    chromeService: { registerChrome: vi.fn(async () => successResult) } as unknown as ChromeRegistrationService
  };
};

const channelDelegations: ReadonlyArray<{
  channel: string;
  method: "registerApplication" | "listApplications" | "updateApplication";
  input: unknown;
}> = [
  {
    channel: IPC_CHANNELS.applications.register,
    method: "registerApplication",
    input: { name: "Notepad", executablePath: "C:\\Windows\\System32\\notepad.exe", aliases: ["Notepad"] }
  },
  { channel: IPC_CHANNELS.applications.list, method: "listApplications", input: { enabled: true } },
  {
    channel: IPC_CHANNELS.applications.update,
    method: "updateApplication",
    input: { applicationId: "550e8400-e29b-41d4-a716-446655440000", isEnabled: false }
  }
];

describe("application catalog IPC registration", () => {
  it("registers exactly the three approved application catalog channels once", () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, chromeService } = createService();
    const register = createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getChromeRegistrationService: () => chromeService,
      logError: vi.fn()
    });

    register();
    register();

    expect(IPC_CHANNELS.applications).toEqual({
      registerChrome: "applications:register-chrome",
      register: "applications:register",
      list: "applications:list",
      update: "applications:update"
    });
    expect([...handlers.keys()]).toEqual(["applications:register-chrome", ...channelDelegations.map(({ channel }) => channel)]);
    expect(handlers.size).toBe(4);
  });

  it.each(channelDelegations)("delegates $channel only to $method", async ({ channel, method, input }) => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, methods, chromeService } = createService();
    createApplicationIpcRegistration({
      registerHandler: (registeredChannel, handler) => handlers.set(registeredChannel, handler),
      getService: () => service,
      getChromeRegistrationService: () => chromeService,
      logError: vi.fn()
    })();

    const result = await handlers.get(channel)?.(input);

    expect(result).toEqual(successResult);
    expect(methods[method]).toHaveBeenCalledWith(input);
  });

  it("maps unexpected handler failures without leaking application details", async () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, methods, chromeService } = createService();
    const secret = "C:\\private\\application.exe";
    methods.registerApplication.mockRejectedValueOnce(new Error(secret));
    const logError = vi.fn();
    createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getChromeRegistrationService: () => chromeService,
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.applications.register)?.({});

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

  it("delegates the input-free Chrome registration channel without a generic picker payload", async () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, chromeService } = createService();
    createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getChromeRegistrationService: () => chromeService,
      logError: vi.fn()
    })();

    await expect(handlers.get(IPC_CHANNELS.applications.registerChrome)?.({ executablePath: "forbidden" })).resolves.toEqual(successResult);
    expect(chromeService.registerChrome).toHaveBeenCalledWith();
  });

  it("maps Chrome registration handler failures without leaking selection details", async () => {
    const handlers = new Map<string, ApplicationIpcHandler>();
    const { service, chromeService } = createService();
    const secret = "C:\\private\\chrome.exe";
    vi.mocked(chromeService.registerChrome).mockRejectedValueOnce(new Error(secret));
    const logError = vi.fn();
    createApplicationIpcRegistration({
      registerHandler: (channel, handler) => handlers.set(channel, handler),
      getService: () => service,
      getChromeRegistrationService: () => chromeService,
      logError
    })();

    const result = await handlers.get(IPC_CHANNELS.applications.registerChrome)?.(undefined);
    expect(result).toMatchObject({ ok: false, error: { code: "APPLICATION_IPC_UNAVAILABLE" } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(logError).toHaveBeenCalledWith("Chrome registration IPC handler failed.");
  });
});
