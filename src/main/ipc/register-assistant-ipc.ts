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
import { speechService } from "../voice/speech-composition";

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

const speechWindows = new WeakSet<Electron.WebContents>();
export const attachSpokenAssistantResponse = (
  webContentsId: number,
  result: AssistantOperationResult<AssistantInterpretation>
): AssistantOperationResult<AssistantInterpretation> => {
  if (!result.ok) return result;
  speechService.clear(webContentsId);
  result.data.spokenResponse = speechService.remember(webContentsId, result.data.summary);
  return result;
};

const registerElectronHandler: AssistantIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, async (event, input: unknown) => {
    const contextService = getAssistantContextService();
    contextService.bindWindow(event.sender.id, (listener) => event.sender.once("destroyed", listener));
    if (!speechWindows.has(event.sender)) {
      const windowId = event.sender.id;
      speechWindows.add(event.sender);
      event.sender.once("destroyed", () => speechService.clear(windowId));
    }
    const result = await handler(input, event.sender.id);
    if (channel === IPC_CHANNELS.assistant.interpret && result.ok) {
      return attachSpokenAssistantResponse(
        event.sender.id,
        result as AssistantOperationResult<AssistantInterpretation>
      );
    }
    return result;
  });
};

export const registerAssistantIpcHandlers = createAssistantIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getAssistantInterpretationService,
  getContextService: getAssistantContextService,
  logError: (message) => console.error(message)
});
