import type {
  ActionOutcome,
  ActionPolicy,
  MessagingActionProposal
} from "../../shared/action-contracts";
import type {
  MessagingActionData,
  PreparedDeleteContactInput,
  PreparedOpenWhatsAppChatInput,
  PreparedSaveContactInput
} from "../../shared/messaging-contracts";
import { getMessagingService } from "../messaging/messaging-composition";
import {
  MESSAGING_EXECUTION_FAILURE_CODES,
  MESSAGING_FAILURES,
  messagingFailure,
  messagingSuccess,
  type MessagingResult
} from "../messaging/messaging-failures";
import type { MessagingService } from "../messaging/messaging-service";

/** What the orchestrator needs to hold a confirmed proposal: the Main-issued reference plus review text. */
export type PreparedMessagingAction = {
  input: PreparedSaveContactInput | PreparedDeleteContactInput | PreparedOpenWhatsAppChatInput;
  confirmationSummary: string;
  scopeSummary: string;
};

export type MessagingActionExecutor = {
  prepare: (proposal: MessagingActionProposal) => Promise<MessagingResult<PreparedMessagingAction>>;
  execute: (proposal: MessagingActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
  /** Drops the Main-held snapshot of a proposal that was cancelled or expired without running. */
  release: (proposal: MessagingActionProposal) => void;
};

type Dependencies = {
  service?: MessagingService;
  logError: (message: string) => void;
};

const NOT_SENT = "Aún no lo envié.";

/** The review text shows the name and only the last four digits of the number. */
const describeSave = (displayName: string, maskedNumber: string): string =>
  `Se guardará el contacto «${displayName}» con el número ${maskedNumber}.`;

const describeDelete = (displayName: string, maskedNumber: string): string =>
  `Se eliminará el contacto «${displayName}» (número ${maskedNumber}). Esta acción no se puede deshacer.`;

/** The review shows the recipient, the masked number and the exact text, and says who presses send. */
const describeOpenChat = (displayName: string, maskedNumber: string, body: string): string =>
  `Se abrirá un chat de WhatsApp con «${displayName}» (número ${maskedNumber}) con este mensaje: «${body}». WhatsApp se abrirá y tendrás que pulsar enviar tú; Ares no envía nada.`;

export const createMessagingActionExecutor = (
  overrides: Partial<Dependencies> = {}
): MessagingActionExecutor => {
  const logError = overrides.logError ?? ((message: string) => console.error(message));
  let service = overrides.service;
  const getService = (): MessagingService => {
    service ??= getMessagingService();
    return service;
  };

  const failureOutcome = (
    proposal: MessagingActionProposal,
    policy: ActionPolicy,
    code: keyof typeof MESSAGING_FAILURES
  ): ActionOutcome => ({
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: MESSAGING_EXECUTION_FAILURE_CODES.includes(code) ? "EXECUTION_FAILED" : "VALIDATION_FAILED",
    errorCode: code,
    userSummary: MESSAGING_FAILURES[code]
  });

  const successOutcome = (
    proposal: MessagingActionProposal,
    policy: ActionPolicy,
    userSummary: string,
    data: MessagingActionData,
    errorCode?: string
  ): ActionOutcome => ({
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: "SUCCEEDED",
    userSummary,
    data,
    ...(errorCode ? { errorCode } : {})
  });

  return {
    release: (proposal) => {
      if (proposal.action !== "SAVE_CONTACT" && proposal.action !== "DELETE_CONTACT" && proposal.action !== "OPEN_WHATSAPP_CHAT_WITH_DRAFT") return;
      const reference = "pendingId" in proposal.input
        ? proposal.input.pendingId
        : "preparedId" in proposal.input
          ? proposal.input.preparedId
          : undefined;
      if (reference !== undefined) getService().releasePrepared(reference);
    },
    prepare: async (proposal) => {
      try {
        if (proposal.action === "SAVE_CONTACT") {
          const { contactName, aliases } = proposal.input;
          const prepared = await getService().prepareSaveContact({ contactName, aliases });
          if (!prepared.ok) return prepared;
          return messagingSuccess({
            input: {
              contactName: prepared.data.displayName,
              ...(aliases === undefined ? {} : { aliases }),
              pendingId: prepared.data.pendingId
            },
            confirmationSummary: describeSave(prepared.data.displayName, prepared.data.maskedNumber),
            scopeSummary: "Contacto nuevo"
          });
        }
        if (proposal.action === "DELETE_CONTACT") {
          const prepared = await getService().prepareDeleteContact({ contactName: proposal.input.contactName });
          if (!prepared.ok) return prepared;
          return messagingSuccess({
            input: { contactName: prepared.data.displayName, preparedId: prepared.data.preparedId },
            confirmationSummary: describeDelete(prepared.data.displayName, prepared.data.maskedNumber),
            scopeSummary: "Contacto guardado"
          });
        }
        if (proposal.action === "OPEN_WHATSAPP_CHAT_WITH_DRAFT") {
          const prepared = await getService().prepareOpenChat();
          if (!prepared.ok) return prepared;
          return messagingSuccess({
            input: { preparedId: prepared.data.preparedId },
            confirmationSummary: describeOpenChat(prepared.data.recipientName, prepared.data.maskedNumber, prepared.data.body),
            scopeSummary: "Chat de WhatsApp"
          });
        }
        return messagingFailure("MESSAGING_OPERATION_FAILED");
      } catch {
        logError("Messaging proposal preparation failed.");
        return messagingFailure("MESSAGING_OPERATION_FAILED");
      }
    },
    execute: async (proposal, policy) => {
      try {
        if (proposal.action === "SAVE_CONTACT") {
          const pendingId = "pendingId" in proposal.input ? proposal.input.pendingId : undefined;
          const result = await getService().commitSaveContact(pendingId);
          return result.ok
            ? successOutcome(proposal, policy, `Listo, guardé el contacto «${result.data.displayName}».`, {
                kind: "CONTACT_SAVED",
                contactName: result.data.displayName
              })
            : failureOutcome(proposal, policy, result.error.code);
        }
        if (proposal.action === "DELETE_CONTACT") {
          const preparedId = "preparedId" in proposal.input ? proposal.input.preparedId : undefined;
          const result = await getService().commitDeleteContact(preparedId);
          return result.ok
            ? successOutcome(proposal, policy, `Listo, eliminé el contacto «${result.data.displayName}».`, {
                kind: "CONTACT_DELETED",
                contactName: result.data.displayName
              })
            : failureOutcome(proposal, policy, result.error.code);
        }
        if (proposal.action === "LIST_CONTACTS") {
          const result = await getService().listContacts();
          if (!result.ok) return failureOutcome(proposal, policy, result.error.code);
          const { contactCount, contactNames } = result.data;
          if (contactCount === 0) {
            return successOutcome(
              proposal,
              policy,
              MESSAGING_FAILURES.MESSAGING_NO_CONTACTS,
              { kind: "CONTACT_LIST", contactCount, contactNames },
              "MESSAGING_NO_CONTACTS"
            );
          }
          const remaining = contactCount - contactNames.length;
          const suffix = remaining > 0 ? ` y ${remaining} más` : "";
          return successOutcome(
            proposal,
            policy,
            `Tienes ${contactCount} ${contactCount === 1 ? "contacto" : "contactos"}: ${contactNames.join(", ")}${suffix}.`,
            { kind: "CONTACT_LIST", contactCount, contactNames }
          );
        }
        if (proposal.action === "PREPARE_MESSAGE_DRAFT") {
          const result = await getService().prepareDraft(proposal.input);
          return result.ok
            ? successOutcome(
                proposal,
                policy,
                `Borrador para ${result.data.recipientName}: «${result.data.body}». ${NOT_SENT}`,
                { kind: "DRAFT_READY", ...result.data }
              )
            : failureOutcome(proposal, policy, result.error.code);
        }
        if (proposal.action === "EDIT_MESSAGE_DRAFT") {
          const result = await getService().editDraft(proposal.input);
          return result.ok
            ? successOutcome(
                proposal,
                policy,
                `Borrador actualizado para ${result.data.recipientName}: «${result.data.body}». ${NOT_SENT}`,
                { kind: "DRAFT_READY", ...result.data }
              )
            : failureOutcome(proposal, policy, result.error.code);
        }
        if (proposal.action === "DISCARD_MESSAGE_DRAFT") {
          const result = getService().discardDraft();
          return result.ok
            ? successOutcome(proposal, policy, "Listo, descarté el borrador del mensaje.", { kind: "DRAFT_DISCARDED" })
            : failureOutcome(proposal, policy, result.error.code);
        }
        if (proposal.action === "OPEN_WHATSAPP_CHAT_WITH_DRAFT") {
          const preparedId = "preparedId" in proposal.input ? proposal.input.preparedId : undefined;
          const result = await getService().commitOpenChat(preparedId);
          return result.ok
            ? successOutcome(
                proposal,
                policy,
                `Abrí el chat con ${result.data.recipientName}. Revisa el mensaje y pulsa enviar.`,
                { kind: "CHAT_OPENED", recipientName: result.data.recipientName }
              )
            : failureOutcome(proposal, policy, result.error.code);
        }
        return failureOutcome(proposal, policy, "MESSAGING_OPERATION_FAILED");
      } catch {
        logError("Messaging action execution failed.");
        return failureOutcome(proposal, policy, "MESSAGING_OPERATION_FAILED");
      }
    }
  };
};
