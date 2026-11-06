/**
 * Closed failure taxonomy for the MESSAGING domain. Every message is a fixed Spanish sentence: it never
 * contains a phone number, a contact name, a message body, a SQL error or a raw exception.
 */
export const MESSAGING_FAILURES = {
  MESSAGING_CONTACT_NOT_FOUND: "No encontré ese contacto. Indica el nombre de uno de tus contactos guardados.",
  MESSAGING_CONTACT_AMBIGUOUS: "Hay varios contactos que coinciden. Indica el nombre completo de uno de ellos.",
  MESSAGING_CONTACT_EXISTS: "Ya tienes un contacto con ese nombre.",
  MESSAGING_ALIAS_EXISTS: "Ese apodo ya lo usa otro contacto.",
  MESSAGING_INVALID_NAME:
    "Indica un nombre válido para el contacto: hasta 40 caracteres, sin números de teléfono ni nombres de aplicaciones.",
  MESSAGING_INVALID_PHONE:
    "El número no es válido. Escríbelo con el código de país, por ejemplo +57 300 123 4567, o con 10 dígitos si es un celular colombiano.",
  MESSAGING_INVALID_BODY: "El mensaje debe tener entre 1 y 1000 caracteres.",
  MESSAGING_NO_DRAFT: "No hay ningún mensaje preparado. Dime a quién quieres escribirle y qué decirle.",
  MESSAGING_FORM_CANCELLED: "Se canceló el guardado del contacto.",
  MESSAGING_PENDING_EXPIRED: "El contacto pendiente expiró. Vuelve a pedirme que lo guarde.",
  MESSAGING_UNSUPPORTED_CHANNEL: "Por ahora solo puedo preparar borradores de mensajes para WhatsApp.",
  MESSAGING_OPEN_FAILED: "No pude abrir WhatsApp. Revisa que esté instalado.",
  MESSAGING_DRAFT_CHANGED:
    "El mensaje cambió después de la revisión, así que no abrí nada. Vuelve a pedirme que abra el chat.",
  MESSAGING_BODY_TOO_LONG_FOR_LINK:
    "El mensaje es demasiado largo para abrirlo en WhatsApp desde Ares. Acórtalo con «cámbialo por …».",
  MESSAGING_NO_CONTACTS: "Aún no tienes contactos guardados.",
  MESSAGING_STORAGE_UNAVAILABLE: "No pude acceder a tus contactos. Revisa que la base de datos esté actualizada.",
  MESSAGING_OPERATION_FAILED: "No se pudo completar la operación con contactos."
} as const;

export type MessagingFailureCode = keyof typeof MESSAGING_FAILURES;

/** Failures caused by the system rather than by what the person asked for. */
export const MESSAGING_EXECUTION_FAILURE_CODES: readonly string[] = [
  "MESSAGING_OPERATION_FAILED",
  "MESSAGING_OPEN_FAILED",
  "MESSAGING_STORAGE_UNAVAILABLE"
];

export type MessagingFailure = {
  ok: false;
  error: { code: MessagingFailureCode; userMessage: string };
};

export type MessagingResult<T> = { ok: true; data: T } | MessagingFailure;

export const messagingFailure = (code: MessagingFailureCode): MessagingFailure => ({
  ok: false,
  error: { code, userMessage: MESSAGING_FAILURES[code] }
});

export const messagingSuccess = <T>(data: T): MessagingResult<T> => ({ ok: true, data });
