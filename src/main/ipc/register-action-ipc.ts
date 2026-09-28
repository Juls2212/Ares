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
import { speechService } from "../voice/speech-composition";
import { composeFinalResponse } from "../voice/final-response-composer";

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

const speechWindows = new WeakSet<Electron.WebContents>();
const registerElectronHandler: ActionIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, async (event, input: unknown) => {
    if (!speechWindows.has(event.sender)) {
      const windowId = event.sender.id;
      speechWindows.add(event.sender);
      event.sender.once("destroyed", () => speechService.clear(windowId));
    }
    speechService.clear(event.sender.id);
    const result = await handler(input);
    if (!result.ok) {
      result.error.spokenResponse = speechService.remember(event.sender.id, result.error.userMessage);
    } else if (result.data && typeof result.data === "object") {
      if ("lifecycleState" in result.data) {
        const awaiting = result.data as import("../../shared/action-contracts").AwaitingActionConfirmation;
        awaiting.spokenResponse = speechService.remember(event.sender.id, awaiting.confirmation.summary);
      } else if ("status" in result.data) {
        const outcome = result.data as import("../../shared/action-contracts").ActionOutcome;
        const text = composeFinalResponse(outcome) ?? outcome.userSummary;
        if (composeFinalResponse(outcome)) outcome.userSummary = text;
        outcome.spokenResponse = speechService.remember(event.sender.id, text);
      }
    }
    return result;
  });
};

export const registerActionIpcHandlers = createActionIpcRegistration({
  registerHandler: registerElectronHandler,
  getOrchestrator: getActionOrchestrator,
  getHistoryService: getActionHistoryService,
  logError: (message) => {
    console.error(message);
  }
});
