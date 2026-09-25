import { ipcMain } from "electron";

import {
  ASSISTANT_ERROR_CODES,
  type AssistantContextData,
  type AssistantInterpretation,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  getAssistantInterpretationService,
  type AssistantInterpretationService
} from "../assistant/assistant-composition";
import {
  getAssistantContextService,
  type AssistantContextService
} from "../assistant/assistant-context-service";

export type AssistantIpcHandler = (input: unknown, webContentsId?: number) => Promise<OperationResult<unknown>>;
export type AssistantIpcHandlerRegistrar = (channel: string, handler: AssistantIpcHandler) => void;

type AssistantIpcDependencies = {
  registerHandler: AssistantIpcHandlerRegistrar;
  getService: () => AssistantInterpretationService;
  getContextService?: () => AssistantContextService;
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

const contextUnavailable = (): AssistantOperationResult<AssistantContextData> => ({
  ok: false,
  error: {
    code: ASSISTANT_ERROR_CODES.contextUnavailable,
    userMessage: "No se pudo validar la selección actual."
  }
});

export const createAssistantIpcRegistration = (
  dependencies: AssistantIpcDependencies
): (() => void) => {
  let registered = false;

  return (): void => {
    if (registered) return;
    dependencies.registerHandler(IPC_CHANNELS.assistant.interpret, async (input, webContentsId) => {
      try {
        return await dependencies.getService().interpret(input, webContentsId);
      } catch {
        dependencies.logError("Assistant IPC handler failed.");
        return unavailable();
      }
    });
    dependencies.registerHandler(IPC_CHANNELS.assistant.context.set, async (input, webContentsId) => {
      try {
        return webContentsId === undefined || !dependencies.getContextService
          ? contextUnavailable()
          : await dependencies.getContextService().set(webContentsId, input);
      } catch {
        dependencies.logError("Assistant context IPC handler failed.");
        return contextUnavailable();
      }
    });
    dependencies.registerHandler(IPC_CHANNELS.assistant.context.clear, async (_input, webContentsId) => {
      try {
        return webContentsId === undefined || !dependencies.getContextService
          ? contextUnavailable()
          : dependencies.getContextService().clear(webContentsId);
      } catch {
        dependencies.logError("Assistant context IPC handler failed.");
        return contextUnavailable();
      }
    });
    registered = true;
  };
};

const registerElectronHandler: AssistantIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, (event, input: unknown) => {
    const contextService = getAssistantContextService();
    contextService.bindWindow(event.sender.id, (listener) => event.sender.once("destroyed", listener));
    return handler(input, event.sender.id);
  });
};

export const registerAssistantIpcHandlers = createAssistantIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getAssistantInterpretationService,
  getContextService: getAssistantContextService,
  logError: (message) => console.error(message)
});
