import type { ContactFormRequest } from "../../shared/messaging-contracts";
import { createContactFormBroker, type ContactFormBroker } from "./contact-form-broker";
import { createMessagingContactRepository } from "./messaging-contact-repository";
import { createWhatsAppChatLauncher } from "./whatsapp-chat-launcher";
import { createMessagingService, type MessagingService } from "./messaging-service";

type ContactFormSender = (request: ContactFormRequest) => boolean;

let contactFormSender: ContactFormSender | undefined;
let contactFormBroker: ContactFormBroker | undefined;
let messagingService: MessagingService | undefined;

/** Main registers how the trusted window receives the form request; without it the form is unavailable. */
export const configureContactFormSender = (sender: ContactFormSender | undefined): void => {
  contactFormSender = sender;
};

export const getContactFormBroker = (): ContactFormBroker => {
  contactFormBroker ??= createContactFormBroker({ notify: (request) => contactFormSender?.(request) ?? false });
  return contactFormBroker;
};

export const getMessagingService = (): MessagingService => {
  messagingService ??= createMessagingService({
    repository: createMessagingContactRepository(),
    contactForm: getContactFormBroker(),
    chatLauncher: createWhatsAppChatLauncher()
  });
  return messagingService;
};

/** Drops pending contacts, prepared deletions and the draft when the application quits. */
export const shutdownMessaging = (): void => {
  messagingService?.shutdown();
  contactFormBroker?.shutdown();
};
