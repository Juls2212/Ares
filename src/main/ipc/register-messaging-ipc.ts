import { ipcMain } from "electron";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import { getContactFormBroker } from "../messaging/messaging-composition";
import type { ContactFormBroker } from "../messaging/contact-form-broker";
import { messagingFailure } from "../messaging/messaging-failures";

export type MessagingIpcHandler = (input: unknown) => Promise<OperationResult<unknown>>;
export type MessagingIpcHandlerRegistrar = (channel: string, handler: MessagingIpcHandler) => void;

type MessagingIpcDependencies = {
  registerHandler: MessagingIpcHandlerRegistrar;
  getBroker: () => ContactFormBroker;
  logError: (message: string) => void;
};

const createHandler = (
  operation: (input: unknown) => Promise<OperationResult<unknown>>,
  logError: (message: string) => void
): MessagingIpcHandler => async (input) => {
  try {
    return await operation(input);
  } catch {
    logError("Messaging IPC handler failed.");
    return messagingFailure("MESSAGING_OPERATION_FAILED");
  }
};

/**
 * Exactly two renderer-to-Main channels exist for contacts: the form submission, which is the only place a
 * phone number leaves the renderer, and the form cancellation. Neither can read, list or return a number.
 */
export const createMessagingIpcRegistration = (dependencies: MessagingIpcDependencies): (() => void) => {
  let registered = false;
  return (): void => {
    if (registered) return;
    dependencies.registerHandler(
      IPC_CHANNELS.messaging.submitContactForm,
      createHandler((input) => dependencies.getBroker().submit(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.messaging.cancelContactForm,
      createHandler((input) => dependencies.getBroker().cancel(input), dependencies.logError)
    );
    registered = true;
  };
};

export const registerMessagingIpcHandlers = createMessagingIpcRegistration({
  registerHandler: (channel, handler) => {
    ipcMain.handle(channel, async (_event, input: unknown) => handler(input));
  },
  getBroker: getContactFormBroker,
  logError: (message) => {
    console.error(message);
  }
});
