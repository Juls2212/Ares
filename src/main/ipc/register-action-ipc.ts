import { ipcMain } from "electron";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  ACTION_ERROR_CODES,
  type ActionOperationResult
} from "../../shared/action-contracts";
import {
  getActionHistoryService,
  getActionOrchestrator
} from "../actions/action-composition";
import type { ActionHistoryService } from "../actions/action-history-service";
import type { ActionOrchestrator } from "../actions/action-orchestrator";

export type ActionIpcHandler = (input: unknown) => Promise<OperationResult<unknown>>;
export type ActionIpcHandlerRegistrar = (channel: string, handler: ActionIpcHandler) => void;

type ActionIpcDependencies = {
  registerHandler: ActionIpcHandlerRegistrar;
  getOrchestrator: () => ActionOrchestrator;
  getHistoryService: () => ActionHistoryService;
  logError: (message: string) => void;
};

const createUnexpectedFailure = <T>(): ActionOperationResult<T> => ({
  ok: false,
  error: {
    code: ACTION_ERROR_CODES.ipcUnavailable,
    userMessage: "No se pudo procesar la solicitud de acción."
  }
});

const createHandler = <T>(
  operation: (input: unknown) => Promise<ActionOperationResult<T>>,
  logError: (message: string) => void
): ActionIpcHandler => async (input) => {
  try {
    return await operation(input);
  } catch {
    logError("Action IPC handler failed.");
    return createUnexpectedFailure<T>();
  }
};

export const createActionIpcRegistration = (dependencies: ActionIpcDependencies): (() => void) => {
  let registered = false;

  return (): void => {
    if (registered) return;

    dependencies.registerHandler(
      IPC_CHANNELS.actions.propose,
      createHandler((input) => dependencies.getOrchestrator().propose(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.actions.confirm,
      createHandler((input) => dependencies.getOrchestrator().confirm(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.actions.cancel,
      createHandler((input) => dependencies.getOrchestrator().cancel(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.actions.history.list,
      createHandler((input) => dependencies.getHistoryService().list(input), dependencies.logError)
    );

    registered = true;
  };
};

const registerElectronHandler: ActionIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, (_event, input: unknown) => handler(input));
};

export const registerActionIpcHandlers = createActionIpcRegistration({
  registerHandler: registerElectronHandler,
  getOrchestrator: getActionOrchestrator,
  getHistoryService: getActionHistoryService,
  logError: (message) => {
    console.error(message);
  }
});
