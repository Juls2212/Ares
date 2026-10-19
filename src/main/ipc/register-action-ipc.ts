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
type SpeechResponseStore = Pick<typeof speechService, "clear" | "remember">;

const isSilentConfirmationFailure = (code: string): boolean =>
  code === ACTION_ERROR_CODES.confirmationInvalid || code === ACTION_ERROR_CODES.confirmationUnavailable;

const isTerminalActionOutcome = (value: unknown): value is import("../../shared/action-contracts").ActionOutcome =>
  typeof value === "object" && value !== null && "status" in value;

const isAwaitingConfirmation = (value: unknown): value is import("../../shared/action-contracts").AwaitingActionConfirmation =>
  typeof value === "object" && value !== null && "lifecycleState" in value;

/** Attaches speech only to completed, displayable outcomes; review and cancellation remain silent. */
export const attachSpokenActionResponse = (
  windowId: number,
  result: ActionOperationResult<import("../../shared/action-contracts").ActionLifecycleResult>,
  responses: SpeechResponseStore = speechService
): ActionOperationResult<import("../../shared/action-contracts").ActionLifecycleResult> => {
  responses.clear(windowId);
  if (!result.ok) {
    if (!isSilentConfirmationFailure(result.error.code)) {
      result.error.spokenResponse = responses.remember(windowId, result.error.userMessage);
    }
    return result;
  }
  if (isAwaitingConfirmation(result.data) || !isTerminalActionOutcome(result.data) || result.data.status === "CANCELLED") {
    return result;
  }
  const composed = composeFinalResponse(result.data);
  const text = composed ?? result.data.userSummary;
  if (composed) result.data.userSummary = composed;
  result.data.spokenResponse = responses.remember(windowId, text);
  return result;
};

const registerElectronHandler: ActionIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, async (event, input: unknown) => {
    if (!speechWindows.has(event.sender)) {
      const windowId = event.sender.id;
      speechWindows.add(event.sender);
      event.sender.once("destroyed", () => speechService.clear(windowId));
    }
    const result = await handler(input);
    if ([IPC_CHANNELS.actions.propose, IPC_CHANNELS.actions.confirm, IPC_CHANNELS.actions.cancel].includes(channel as never)) {
      return attachSpokenActionResponse(
        event.sender.id,
        result as ActionOperationResult<import("../../shared/action-contracts").ActionLifecycleResult>
      );
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
