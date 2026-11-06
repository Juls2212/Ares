import type { ActionOutcome } from "../../shared/action-contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasConfirmedPlannerRecord = (outcome: ActionOutcome): boolean =>
  isRecord(outcome.data) && "record" in outcome.data && isRecord(outcome.data.record);

const hasConfirmedDeletion = (outcome: ActionOutcome): boolean =>
  isRecord(outcome.data) && "deleted" in outcome.data && outcome.data.deleted === true;

const getResolvedApplicationName = (outcome: ActionOutcome): string | undefined => {
  if (!isRecord(outcome.data) || !("applicationName" in outcome.data) || typeof outcome.data.applicationName !== "string") return undefined;
  const name = outcome.data.applicationName.trim();
  return name.length > 0 && name.length <= 160 && !/[\\/\r\n\0]/.test(name) ? name : undefined;
};

const getApprovedWebSiteName = (outcome: ActionOutcome): string | undefined => {
  if (!isRecord(outcome.data) || !("site" in outcome.data) || typeof outcome.data.site !== "string") return undefined;
  return ({ GOOGLE: "Google", YOUTUBE: "YouTube", SPOTIFY: "Spotify" } as const)[outcome.data.site as "GOOGLE" | "YOUTUBE" | "SPOTIFY"];
};

const MAX_SPOKEN_CONTACT_NAME_LENGTH = 40;
const MAX_SPOKEN_CONTACT_NAMES = 3;

const toSpokenName = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_SPOKEN_CONTACT_NAME_LENGTH && !/[\p{C}«»]/u.test(name) ? name : undefined;
};

/**
 * Actions whose on-screen text must stay as written by Main because it shows content the speech text
 * deliberately leaves out: the list of contacts and the exact draft text.
 */
export const preservesDisplaySummary = (action: ActionOutcome["action"]): boolean =>
  action === "LIST_CONTACTS" || action === "PREPARE_MESSAGE_DRAFT" || action === "EDIT_MESSAGE_DRAFT";

/**
 * Spoken text for the MESSAGING actions. It may name a contact (and, for a list, up to three names) but it
 * never includes a phone number or the message text, because this text is sent to the speech provider.
 */
const composeMessagingResponse = (outcome: ActionOutcome): string | undefined => {
  if (!isRecord(outcome.data)) return undefined;
  const data = outcome.data as Record<string, unknown>;
  if (typeof data.kind !== "string") return undefined;
  if (data.kind === "CONTACT_SAVED") {
    const name = toSpokenName(data.contactName);
    return name ? `Listo, guardé el contacto ${name}.` : undefined;
  }
  if (data.kind === "CONTACT_DELETED") {
    const name = toSpokenName(data.contactName);
    return name ? `Listo, eliminé el contacto ${name}.` : undefined;
  }
  if (data.kind === "CONTACT_LIST") {
    if (typeof data.contactCount !== "number" || !Array.isArray(data.contactNames)) return undefined;
    if (data.contactCount === 0) return "Aún no tienes contactos guardados.";
    const names = data.contactNames.slice(0, MAX_SPOKEN_CONTACT_NAMES).map(toSpokenName).filter((name): name is string => name !== undefined);
    const noun = data.contactCount === 1 ? "contacto" : "contactos";
    if (names.length === 0) return `Tienes ${data.contactCount} ${noun}.`;
    const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
    const more = data.contactCount > names.length ? `, entre otros` : "";
    return `Tienes ${data.contactCount} ${noun}: ${joined}${more}.`;
  }
  if (data.kind === "DRAFT_READY") {
    const name = toSpokenName(data.recipientName);
    if (!name) return undefined;
    return outcome.action === "EDIT_MESSAGE_DRAFT"
      ? `Cambié el mensaje para ${name}. Aún no lo envié.`
      : `Preparé un mensaje para ${name}. Aún no lo envié.`;
  }
  if (data.kind === "CHAT_OPENED") {
    const name = toSpokenName(data.recipientName);
    return name ? `Abrí el chat con ${name}. Revisa el mensaje y pulsa enviar.` : undefined;
  }
  return data.kind === "DRAFT_DISCARDED" ? "Listo, descarté el mensaje." : undefined;
};

/** Uses only completed Main-side outcome data; it never consumes provider prose or launch targets. */
export const composeFinalResponse = (outcome: ActionOutcome): string | undefined => {
  if (outcome.status !== "SUCCEEDED") return undefined;
  if (
    outcome.action === "SAVE_CONTACT" || outcome.action === "LIST_CONTACTS" || outcome.action === "DELETE_CONTACT" ||
    outcome.action === "PREPARE_MESSAGE_DRAFT" || outcome.action === "EDIT_MESSAGE_DRAFT" ||
    outcome.action === "DISCARD_MESSAGE_DRAFT" || outcome.action === "OPEN_WHATSAPP_CHAT_WITH_DRAFT"
  ) {
    return composeMessagingResponse(outcome);
  }
  if (outcome.action === "OPEN_APPLICATION") {
    const name = getResolvedApplicationName(outcome);
    return name ? `Listo, abrí ${name}.` : undefined;
  }
  if (outcome.action === "REGISTER_CATALOG_APPLICATION") {
    const name = getResolvedApplicationName(outcome);
    return name ? `Listo, registré ${name}. Ya puedes pedirme que lo abra.` : undefined;
  }
  if (outcome.action === "REQUEST_CUSTOM_APPLICATION_REGISTRATION") {
    const name = getResolvedApplicationName(outcome);
    return name ? `Listo, registré ${name}. Ya puedes pedirme que la abra.` : undefined;
  }
  if (outcome.action === "OPEN_APPROVED_PAGE") {
    const site = getApprovedWebSiteName(outcome);
    return site ? `Listo, abrí ${site}.` : undefined;
  }
  if (outcome.action === "SEARCH_APPROVED_SITE") {
    const site = getApprovedWebSiteName(outcome);
    if (isRecord(outcome.data) && (outcome.data as Record<string, unknown>).site === "SPOTIFY") {
      return "Busqué en Spotify en la web. Pulsa reproducir cuando quieras. Si registras la app de Spotify, el resultado es mejor.";
    }
    return site ? `Listo, busqué en ${site}.` : undefined;
  }

  if (outcome.action === "CREATE_TASK") return hasConfirmedPlannerRecord(outcome) ? "Listo, agregué la tarea." : undefined;
  if (outcome.action === "UPDATE_TASK") return hasConfirmedPlannerRecord(outcome) ? "Listo, actualicé la tarea." : undefined;
  if (outcome.action === "COMPLETE_TASK") return hasConfirmedPlannerRecord(outcome) ? "Listo, marqué la tarea como completada." : undefined;
  if (outcome.action === "CREATE_EVENT") return hasConfirmedPlannerRecord(outcome) ? "Listo, agregué el evento." : undefined;
  if (outcome.action === "UPDATE_EVENT") return hasConfirmedPlannerRecord(outcome) ? "Listo, actualicé el evento." : undefined;
  if (outcome.action === "CREATE_REMINDER") return hasConfirmedPlannerRecord(outcome) ? "Listo, agregué el recordatorio." : undefined;
  if (outcome.action === "DELETE_TASK") return hasConfirmedDeletion(outcome) ? "Listo, eliminé la tarea." : undefined;
  if (outcome.action === "DELETE_EVENT") return hasConfirmedDeletion(outcome) ? "Listo, eliminé el evento." : undefined;

  const messages: Partial<Record<ActionOutcome["action"], string>> = {
    OPEN_WEB_PAGE: "Listo, abrí la página.",
    CREATE_FOLDER: "Listo, creé la carpeta.",
    RENAME_FILE: "Listo, cambié el nombre del archivo.",
    RENAME_FOLDER: "Listo, cambié el nombre de la carpeta.",
    MOVE_FILE: "Listo, moví el archivo."
  };
  return messages[outcome.action];
};
