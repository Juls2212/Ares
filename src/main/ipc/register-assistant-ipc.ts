import { ipcMain } from "electron";

import {
  ASSISTANT_ERROR_CODES,
  type AssistantInterpretation,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  getAssistantInterpretationService,
  type AssistantInterpretationService
} from "../assistant/assistant-composition";

export type AssistantIpcHandler = (input: unknown) => Promise<OperationResult<unknown>>;
export type AssistantIpcHandlerRegistrar = (channel: string, handler: AssistantIpcHandler) => void;

type AssistantIpcDependencies = {
  registerHandler: AssistantIpcHandlerRegistrar;
  getService: () => AssistantInterpretationService;
  logError: (message: string) => void;
};

const unavailable = (): AssistantOperationResult<AssistantInterpretation> => ({
  ok: true,
  data: {
    state: "UNAVAILABLE",
    summary: "La interpretación no está disponible en este momento.",
    drafts: [],
    clarifications: [],
    errorCode: ASSISTANT_ERROR_CODES.ipcUnavailable
  }
});

export const createAssistantIpcRegistration = (
  dependencies: AssistantIpcDependencies
): (() => void) => {
  let registered = false;

  return (): void => {
    if (registered) return;
    dependencies.registerHandler(IPC_CHANNELS.assistant.interpret, async (input) => {
      try {
        return await dependencies.getService().interpret(input);
      } catch {
        dependencies.logError("Assistant IPC handler failed.");
        return unavailable();
      }
    });
    registered = true;
  };
};

const registerElectronHandler: AssistantIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, (_event, input: unknown) => handler(input));
};

export const registerAssistantIpcHandlers = createAssistantIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getAssistantInterpretationService,
  logError: (message) => console.error(message)
});
