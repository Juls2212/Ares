import { normalizeApplicationAlias } from "../applications/known-application-catalog";

/**
 * Deterministic classification of contact and message-draft phrases. It only classifies text: it never
 * reads a contact, never touches storage and never produces a number, a link or a send action.
 */
export type MessagingCommand =
  | { kind: "SAVE_CONTACT"; name: string }
  | { kind: "SAVE_CONTACT_INCOMPLETE" }
  | { kind: "PHONE_IN_VOICE" }
  | { kind: "LIST_CONTACTS" }
  | { kind: "DELETE_CONTACT"; name: string }
  | { kind: "PREPARE_DRAFT"; recipient: string; body: string; channel: "WHATSAPP" | "UNSUPPORTED" }
  | { kind: "DRAFT_INCOMPLETE"; missing: "RECIPIENT" | "BODY" }
  | { kind: "EDIT_DRAFT"; body: string }
  | { kind: "EDIT_INCOMPLETE" }
  | { kind: "DISCARD_DRAFT" }
  | { kind: "SEND_REQUEST" }
  | { kind: "OPEN_CHAT_REQUEST" }
  | { kind: "OPEN_CHAT_NAMED" }
  | { kind: "OTHER_CHANNEL_REQUEST" };

const POLITE_PREFIX = "(?:por\\s+favor,?\\s+)?";
const OTHER_CHANNELS = "discord|correo|e-?mail|sms|telegram|messenger|instagram";

const stripTrailingPunctuation = (value: string): string =>
  value
    .trim()
    .replace(/^[«"“'‘]+/u, "")
    .replace(/[»"”'’.,;:!?¡¿]+$/u, "")
    .trim();

const stripBodyQuotes = (value: string): string => {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^[«"“](.+)[»"”]$/su);
  return (quoted ? quoted[1] : trimmed).trim();
};

const SAVE_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `^${POLITE_PREFIX}(?:guarda|guardar|agrega|agregar|a[ñn]ade|a[ñn]adir|crea|crear|registra|registrar)\\s+(?:un|el|mi)?\\s*(?:nuevo\\s+)?contacto\\s+(?:llamad[oa]|que\\s+se\\s+llama|con\\s+el\\s+nombre(?:\\s+de)?|de)?\\s*:?\\s*(.+)$`,
    "iu"
  ),
  new RegExp(
    `^${POLITE_PREFIX}(?:guarda|guardar|agrega|agregar|a[ñn]ade|a[ñn]adir|crea|crear|registra|registrar)\\s+(?:a\\s+)?(.+?)\\s+(?:como|en)\\s+(?:mi\\s+|mis\\s+|un\\s+|el\\s+)?contactos?$`,
    "iu"
  ),
  new RegExp(`^${POLITE_PREFIX}nuevo\\s+contacto\\s*:?\\s+(.+)$`, "iu")
];

const SAVE_INCOMPLETE = new RegExp(
  `^${POLITE_PREFIX}(?:guarda|guardar|agrega|agregar|a[ñn]ade|a[ñn]adir|crea|crear|registra|registrar)\\s+(?:un\\s+|el\\s+)?(?:nuevo\\s+)?contacto$`,
  "iu"
);

const NOT_A_CONTACT_NAME = /^(?:este|esta|esto|ese|esa|eso)\b|\b(?:archivos?|carpetas?|documentos?|tareas?|eventos?|recordatorios?|h[aá]bitos?)\b/iu;

const PHONE_WORDS = /\s+(?:con|y|su|cuyo)\s+(?:el\s+|su\s+)?(?:n[uú]mero|tel[eé]fono|celular|cel|tel)\b/iu;

const DELETE_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `^${POLITE_PREFIX}(?:borra|borrar|elimina|eliminar|quita|quitar|suprime)\\s+(?:a\\s+)?(?:mi\\s+|el\\s+|al\\s+)?contacto\\s+(?:llamad[oa]\\s+|de\\s+)?(.+)$`,
    "iu"
  ),
  new RegExp(
    `^${POLITE_PREFIX}(?:borra|borrar|elimina|eliminar|quita|quitar)\\s+(?:a\\s+)?(.+?)\\s+de\\s+(?:mis\\s+)?contactos$`,
    "iu"
  )
];

const DRAFT_VERB = new RegExp(
  `^${POLITE_PREFIX}(?:(?:escr[ií]be|m[aá]nda|env[ií]a)le|d[ií]le|av[ií]sale|mensajea(?:le)?|(?:escr[ií]be|m[aá]nda|env[ií]a)(?=\\s+(?:un|el)\\s+(?:mensaje|mensajito|whatsapp|wasap|${OTHER_CHANNELS})\\b))\\s+(.*)$`,
  "iu"
);
// «diciendo que», «diciéndole que», «que» or a colon introduce the body.
const BODY_CONNECTOR = /(?:^|\s)(?:dici[eé]ndole|diciendo)(?:\s+que)?\s+|(?:^|\s)que\s+|:\s*/iu;
const CHANNEL_WORD = new RegExp(`\\b(${OTHER_CHANNELS})\\b`, "iu");
const MESSAGE_NOUN_PHRASE = new RegExp(
  `\\b(?:un|el)\\s+(?:mensaje|mensajito|whatsapp|wasap|${OTHER_CHANNELS})\\b(?:\\s+(?:de|por|en|via|vía)\\s+\\p{L}+)?`,
  "giu"
);
const BY_CHANNEL = new RegExp(`\\b(?:por|en|via|vía)\\s+(?:whatsapp|wasap|${OTHER_CHANNELS})\\b`, "giu");

const parseDraftCommand = (text: string): MessagingCommand | undefined => {
  const verb = text.match(DRAFT_VERB);
  if (!verb) return undefined;
  const rest = verb[1].trim();
  const connector = BODY_CONNECTOR.exec(rest);
  const head = (connector ? rest.slice(0, connector.index) : rest).trim();
  const body = connector ? stripBodyQuotes(rest.slice(connector.index + connector[0].length)) : "";
  const channel: "WHATSAPP" | "UNSUPPORTED" = CHANNEL_WORD.test(head) ? "UNSUPPORTED" : "WHATSAPP";
  const target = head.replace(MESSAGE_NOUN_PHRASE, " ").replace(BY_CHANNEL, " ").replace(/\s+/gu, " ").trim();
  const recipientMatch = target.match(/^(?:a|para)\s+(.+)$/iu);
  const recipient = recipientMatch ? stripTrailingPunctuation(recipientMatch[1]) : "";
  if (recipient.length === 0) return { kind: "DRAFT_INCOMPLETE", missing: "RECIPIENT" };
  if (body.length === 0) return channel === "UNSUPPORTED" ? { kind: "OTHER_CHANNEL_REQUEST" } : { kind: "DRAFT_INCOMPLETE", missing: "BODY" };
  return { kind: "PREPARE_DRAFT", recipient, body, channel };
};

const EDIT_PATTERN = new RegExp(
  `^${POLITE_PREFIX}(?:c[aá]mbialo\\s+(?:por|a)|(?:cambia|modifica|edita|corrige)\\s+el\\s+(?:mensaje|borrador)\\s+(?:por|a|para\\s+que\\s+diga|para\\s+decir)?)\\s*:?\\s*(.+)$`,
  "isu"
);
const EDIT_INCOMPLETE = new RegExp(
  `^${POLITE_PREFIX}(?:c[aá]mbialo|cambia\\s+el\\s+mensaje|modifica\\s+el\\s+mensaje|edita\\s+el\\s+mensaje)(?:\\s+(?:por|a))?$`,
  "iu"
);

const DISCARD_PATTERN =
  /^(?:por favor )?(?:descarta|descartar|cancela|cancelar|borra|borrar|elimina|eliminar|olvida|olvidar|quita|quitar)(?: el)?(?: mensaje| borrador)(?: de whatsapp)?(?: preparado| que prepare)?$|^no (?:lo )?(?:envies|mandes)$/u;
const SEND_PATTERN =
  /^(?:por favor )?(?:si )?(?:envia|manda|enviar|mandar|envialo|mandalo|enviala|mandala|enviale|mandale)(?: lo| la)?(?: ahora| ya)?(?: el| ese)?(?: mensaje)?(?: por whatsapp)?(?: ya| ahora)?$/u;
// «abre el chat con el mensaje» opens the active draft; «abre el chat con Mamá» names someone and is not handled.
const OPEN_CHAT_DRAFT_PATTERN =
  /^(?:por favor )?(?:abre|abrir|abreme|ve a|ir a) (?:el |un )?chat(?: de whatsapp)?(?: con (?:el|ese) (?:mensaje|borrador|texto))?$|^(?:por favor )?(?:abre|abrir) whatsapp con (?:el|ese) (?:mensaje|borrador|texto)$/u;
const OPEN_CHAT_NAMED_PATTERN =
  /^(?:por favor )?(?:abre|abrir|abreme|muestrame|ve a|ir a) (?:el |un )?chat (?:de whatsapp )?con .+$|^(?:por favor )?(?:abre|abrir) whatsapp (?:con|de|a) .+$/u;
const SEND_OTHER_CHANNEL_PATTERN =
  /^(?:por favor )?(?:si )?(?:envia|manda|enviar|mandar|envialo|mandalo|enviala|mandala|enviale|mandale)(?: el| ese)?(?: mensaje)? (?:por|en|via|a traves de) (?:discord|correo|e ?mail|sms|telegram|messenger|instagram)$/u;
const LIST_PATTERN =
  /^(?:por favor )?(?:(?:que|cuales|cuantos) (?:son )?(?:mis |los )?contactos(?: tengo| tengo guardados| guardados| hay)?|(?:mis|los) contactos(?: guardados)?|(?:muestrame|ensename|dime|lista|listame|listar|ver|muestra) (?:mis |los |todos mis |la lista de )?contactos(?: guardados)?|lista de contactos)$/u;
const OTHER_CHANNEL_PATTERN = new RegExp(
  `^${POLITE_PREFIX}(?:escr[ií]be(?:le)?|m[aá]nda(?:le)?|env[ií]a(?:le)?)\\s+(?:un\\s+)?(?:${OTHER_CHANNELS})\\b`,
  "iu"
);

export const parseMessagingCommand = (instruction: string): MessagingCommand | undefined => {
  const text = instruction.trim().replace(/[.!?¡¿]+$/u, "").trim();
  if (text.length === 0) return undefined;

  if (SAVE_INCOMPLETE.test(text)) return { kind: "SAVE_CONTACT_INCOMPLETE" };
  for (const pattern of SAVE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = match[1].trim();
    // A number said aloud never reaches the provider or the contact: the form is the only way to enter it.
    if (PHONE_WORDS.test(raw) || raw.replace(/[\s().-]/gu, "").match(/\d{7,}/u)) return { kind: "PHONE_IN_VOICE" };
    const name = stripTrailingPunctuation(raw);
    if (NOT_A_CONTACT_NAME.test(name)) return undefined;
    return name.length > 0 ? { kind: "SAVE_CONTACT", name } : { kind: "SAVE_CONTACT_INCOMPLETE" };
  }
  for (const pattern of DELETE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const name = stripTrailingPunctuation(match[1]);
    return name.length > 0 ? { kind: "DELETE_CONTACT", name } : undefined;
  }

  const bodyText = instruction.trim().replace(/\.+$/u, "").trim();
  const normalized = normalizeApplicationAlias(text);
  if (LIST_PATTERN.test(normalized)) return { kind: "LIST_CONTACTS" };
  if (DISCARD_PATTERN.test(normalized)) return { kind: "DISCARD_DRAFT" };
  if (SEND_OTHER_CHANNEL_PATTERN.test(normalized)) return { kind: "OTHER_CHANNEL_REQUEST" };
  if (OPEN_CHAT_DRAFT_PATTERN.test(normalized)) return { kind: "OPEN_CHAT_REQUEST" };
  if (OPEN_CHAT_NAMED_PATTERN.test(normalized)) return { kind: "OPEN_CHAT_NAMED" };
  if (SEND_PATTERN.test(normalized)) return { kind: "SEND_REQUEST" };

  if (EDIT_INCOMPLETE.test(bodyText)) return { kind: "EDIT_INCOMPLETE" };
  const edit = bodyText.match(EDIT_PATTERN);
  if (edit) {
    const body = stripBodyQuotes(edit[1]);
    return body.length > 0 ? { kind: "EDIT_DRAFT", body } : { kind: "EDIT_INCOMPLETE" };
  }

  const draft = parseDraftCommand(bodyText);
  if (draft) return draft;
  return OTHER_CHANNEL_PATTERN.test(bodyText) ? { kind: "OTHER_CHANNEL_REQUEST" } : undefined;
};
