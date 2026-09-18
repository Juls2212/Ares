import { ipcMain } from "electron";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  APPLICATION_ERROR_CODES,
  type ApplicationOperationResult
} from "../../shared/application-contracts";
import { getApplicationService } from "../applications/application-composition";
import type { ApplicationService } from "../applications/application-service";

export type ApplicationIpcHandler = (input: unknown) => Promise<OperationResult<unknown>>;
export type ApplicationIpcHandlerRegistrar = (
  channel: string,
  handler: ApplicationIpcHandler
) => void;

type ApplicationIpcDependencies = {
  registerHandler: ApplicationIpcHandlerRegistrar;
  getService: () => ApplicationService;
  logError: (message: string) => void;
};

const createUnexpectedFailure = <T>(): ApplicationOperationResult<T> => ({
  ok: false,
  error: {
    code: APPLICATION_ERROR_CODES.ipcUnavailable,
    userMessage: "No se pudo procesar la solicitud de aplicaciones."
  }
});

const createHandler = <T>(
  getService: () => ApplicationService,
  operation: (service: ApplicationService, input: unknown) => Promise<ApplicationOperationResult<T>>,
  logError: (message: string) => void
): ApplicationIpcHandler => async (input) => {
  try {
    return await operation(getService(), input);
  } catch {
    logError("Application catalog IPC handler failed.");
    return createUnexpectedFailure<T>();
  }
};

export const createApplicationIpcRegistration = (
  dependencies: ApplicationIpcDependencies
): (() => void) => {
  let registered = false;

  return (): void => {
    if (registered) return;

    dependencies.registerHandler(
      IPC_CHANNELS.applications.register,
      createHandler(
        dependencies.getService,
        (service, input) => service.registerApplication(input),
        dependencies.logError
      )
    );
    dependencies.registerHandler(
      IPC_CHANNELS.applications.list,
      createHandler(
        dependencies.getService,
        (service, input) => service.listApplications(input),
        dependencies.logError
      )
    );
    dependencies.registerHandler(
      IPC_CHANNELS.applications.update,
      createHandler(
        dependencies.getService,
        (service, input) => service.updateApplication(input),
        dependencies.logError
      )
    );

    registered = true;
  };
};

const registerElectronHandler: ApplicationIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, (_event, input: unknown) => handler(input));
};

export const registerApplicationIpcHandlers = createApplicationIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getApplicationService,
  logError: (message) => {
    console.error(message);
  }
});
