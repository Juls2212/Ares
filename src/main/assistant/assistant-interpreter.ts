import { clarificationInterpretation } from "../../shared/outcome-kit";
import {
  SPOTIFY_SEARCH_KINDS,
  type ActionSubmission
} from "../../shared/action-contracts";
import { validateWeatherInput } from "../weather/weather-validation";
import { validateSystemInfoInput } from "../system/system-info";
import {
  ASSISTANT_CURRENT_CONTEXT_TOKEN,
  ASSISTANT_ERROR_CODES,
  ASSISTANT_INSTRUCTION_MAX_LENGTH,
  type AssistantInterpretInput,
  type AssistantInterpretation,
  type AssistantInterpretationReference,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import { validateApplicationAlias, validateCustomApplicationDisplayName } from "../applications/application-validation";
import { parseFoundFileCommand, type OrdinalReference } from "./found-file-references";
import { parseFileMutationCommand, type FileMutationCommand, type OrdinalSelection } from "./found-file-mutations";
import type { FoundFileNameResolution } from "../files/supervised-file-service";
import {
  isFileSearchKind,
  isFoundOrdinal,
  isSupervisedFileRoot,
  parseSelection,
  validateFolderName,
  validateSearchQuery
} from "../files/supervised-file-validation";
import {
  KNOWN_APPLICATION_CATALOG,
  getKnownApplication,
  isKnownApplicationCatalogKey
} from "../applications/known-application-catalog";
import { foldEventTitle, foldForAlias, foldLooseText } from "../../shared/text-fold";
import { getOpenAiConfiguration, type OpenAiConfiguration } from "../config/openai-environment";
import {
  validateCompleteTaskInput,
  validateCreateEventInput,
  validateCreateReminderInput,
  validateCreateTaskInput,
  validateGetTodayScheduleInput,
  validateGetWeekScheduleInput,
  validateUpdateEventInput,
  validateUpdateTaskInput,
  validateDeleteEventInput,
  validateEventListInput
} from "../planner/planner-validation";
import {
  ASSISTANT_PROVIDER_TIMEOUT_MS,
  createOpenAiStructuredProvider,
  type StructuredInterpretationProvider
} from "./openai-structured-provider";
import {
  createPlannerTemporalResolver,
  type PlannerTemporalAction,
  type PlannerTemporalResolutionReason
} from "./planner-temporal-resolution";
import { isUnsafeAssistantDraftText, isUnsafeAssistantInstruction } from "./assistant-safety";
import type { ResolvedAssistantContext } from "./assistant-context-service";
import type { ResolveEventDeletion } from "./assistant-event-reference";
import {
  getAssistantProviderFailureDiagnostic,
  type AssistantProviderFailureDiagnostic
} from "./provider-failure-category";
import { isEnabledAssistantAction } from "../actions/capability-registry";
import { validateApprovedWebActionInput } from "../actions/approved-web-action-executor";
import { parseMessagingCommand } from "./messaging-phrases";
import { parseStreamingCommand } from "./streaming-phrases";
import { parseSpotifyControlCommand } from "./spotify-control-phrases";
import type { VariantPicker } from "../../shared/phrase-variation";
import {
  LOCAL_MODE_NOT_UNDERSTOOD,
  matchLocalIntent,
  toProviderOutput,
  type LocalContext,
  type LocalIntent,
  type LocalMatch,
  type LocalMode
} from "./local-intent-interpreter";
import { validateSpotifySearchQuery } from "../applications/spotify-search";
import type { ContactResolution } from "../messaging/messaging-service";
import { MESSAGING_FAILURES } from "../messaging/messaging-failures";
import {
  sanitizeMessageBody,
  toLookupKey,
  validateContactAliases,
  validateContactName
} from "../messaging/messaging-validation";

const MAX_INSTRUCTION_LENGTH = ASSISTANT_INSTRUCTION_MAX_LENGTH;
const MAX_DRAFTS = 8;
const MAX_PROVIDER_OUTPUT_LENGTH = 16_000;
const READY_SUMMARY = "Listo, esto es lo que preparé.";

type UnknownRecord = Record<string, unknown>;

export type AssistantInterpreterDependencies = {
  getConfiguration?: () => OpenAiConfiguration;
  createProvider?: (configuration: OpenAiConfiguration) => StructuredInterpretationProvider;
  now?: () => Date;
  timeZone?: () => string;
  timeoutMs?: number;
  logError?: (message: string) => void;
  resolveEventDeletion?: ResolveEventDeletion;
  /** Count-only view of the last file search, supplied by Main. */
  getActiveFileSearch?: () => { resultCount: number } | undefined;
  /** Main-side matching of a spoken name against the last search; names never reach the provider. */
  resolveFoundFileName?: (name: string) => FoundFileNameResolution;
  /** Main-side matching of a spoken folder name against FOLDER entries of the last search. */
  resolveFoundFolderName?: (name: string) => FoundFileNameResolution;
  /** Main-side matching of a spoken contact reference; contact names and numbers never reach the provider. */
  resolveMessagingContact?: (reference: string) => Promise<ContactResolution>;
  /** Whether a message draft is active; the draft itself is never exposed to the interpreter. */
  hasActiveMessageDraft?: () => boolean;
  /** Whether Spotify is registered and enabled; used only to choose between the app and the web search. */
  isSpotifyAppRegistered?: () => Promise<boolean>;
  /** Local connection state of the Spotify Web API; it decides whether «pon X» plays or asks to connect. */
  isSpotifyConnected?: () => Promise<boolean>;
  /**
   * The offline local brain. When absent the interpreter is cloud-only, exactly as before. When present, `localFirst` answers a
   * small set of exact-grammar commands without the provider, and a missing, failing or slow provider falls back to it.
   */
  localBrain?: { localFirst: boolean; pick?: VariantPicker };
  /** One closed-enum line per turn that reaches the local or cloud decision; defaults to the console. */
  logInfo?: (line: string) => void;
};

export type TrustedAssistantReference = {
  reference: Partial<AssistantInterpretationReference>;
  currentContext?: ResolvedAssistantContext;
};

export type TrustedAssistantReferenceResolver = (
  draftActions: readonly string[]
) => Promise<TrustedAssistantReference | undefined>;

const success = (data: AssistantInterpretation): AssistantOperationResult<AssistantInterpretation> => ({
  ok: true,
  data
});

const unavailableMessage = (
  code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES]
): string => {
  switch (code) {
    case ASSISTANT_ERROR_CODES.configuration:
      return "La interpretación requiere configurar OpenAI localmente.";
    case ASSISTANT_ERROR_CODES.authentication:
      return "Ares no pudo autenticarse con el servicio de interpretación.";
    case ASSISTANT_ERROR_CODES.authorization:
      return "La cuenta configurada no tiene acceso al servicio de interpretación.";
    case ASSISTANT_ERROR_CODES.modelAccess:
      return "El modelo configurado no está disponible para esta cuenta.";
    case ASSISTANT_ERROR_CODES.timeout:
      return "El servicio de interpretación tardó demasiado. Inténtalo de nuevo.";
    case ASSISTANT_ERROR_CODES.quota:
      return "La cuenta configurada no tiene cuota disponible para interpretar solicitudes.";
    case ASSISTANT_ERROR_CODES.rateLimited:
      return "El servicio de interpretación alcanzó su límite temporal. Inténtalo más tarde.";
    case ASSISTANT_ERROR_CODES.network:
      return "No se pudo conectar con el servicio de interpretación. Inténtalo de nuevo.";
    default:
      return "El servicio de interpretación no está disponible temporalmente. Inténtalo de nuevo más tarde.";
  }
};

const unavailable = (code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES]): AssistantOperationResult<AssistantInterpretation> =>
  success({
    state: "UNAVAILABLE",
    summary: unavailableMessage(code),
    drafts: [],
    clarifications: [],
    errorCode: code
  });

const clarification = (question = "¿Puedes indicar los datos necesarios de forma más específica?"): AssistantOperationResult<AssistantInterpretation> =>
  success(clarificationInterpretation(question));

/**
 * A bare application name or alias carries no verb, so it is neither small talk nor an action.
 * This deterministic Main-side check runs before the provider and returns a fixed clarification.
 */
const getAliasOnlyClarification = (
  instruction: string,
  registeredAliases: readonly string[] | undefined
): string | undefined => {
  const normalized = foldForAlias(instruction);
  if (normalized.length === 0) return undefined;
  const catalogEntry = KNOWN_APPLICATION_CATALOG.find((entry) =>
    [entry.defaultAlias, entry.displayName, ...entry.recognitionAliases].some(
      (alias) => foldForAlias(alias) === normalized
    )
  );
  if (catalogEntry) return `¿Quieres que abra o que registre ${catalogEntry.displayName}?`;
  return registeredAliases?.some((alias) => foldForAlias(alias) === normalized)
    ? "¿Quieres que abra esa aplicación registrada?"
    : undefined;
};

const FILE_NOUN = /\b(?:archivos?|carpetas?|ficheros?|documentos?|fotos?|imagenes|imagen|pdfs?)\b/u;
const NON_FILE_NOUN = /\b(?:eventos?|tareas?|recordatorios?|habitos?|horarios?|rutinas?)\b/u;

const DELETE_UNSUPPORTED_QUESTION =
  "Solo puedo enviar un elemento a la Papelera por solicitud, indicando su número. No puedo borrar varios a la vez, de forma permanente ni por ruta.";
const DELETE_NEEDS_ORDINAL = "Indica el número del resultado que quieres enviar a la Papelera, por ejemplo el tercero.";
const SELECTION_QUESTION = "¿Cuáles quieres? Puedes decir «todo» o «el primero y el segundo».";
const DESTINATION_QUESTION = "Indica el destino: Escritorio, Documentos, Descargas, Imágenes, Música o Videos.";
const FOLDER_AMBIGUOUS = "Hay varias carpetas con ese nombre. ¿Cuál es? Dime su número.";
const FOLDER_UNMATCHED = "No encontré esa carpeta en los últimos resultados. Dime una ubicación como Documentos, o búscala primero.";
const INVALID_ITEM_NAME = "Indica un nombre válido para el elemento.";

/**
 * «renombra el primero a X», «mueve el segundo a Documentos», «organiza estos archivos en una carpeta
 * llamada X en Documentos» and «elimina el tercero» are resolved in Main against the last search before
 * any provider call. Requests that stay unavailable (several deletions, permanent deletion, typed paths)
 * answer with a fixed clarification, so no action and no confirmation dialog can follow.
 */
const resolveFileMutationCommand = (
  instruction: string,
  activeFileSearch: { resultCount: number } | undefined,
  resolveFoundFolderName: AssistantInterpreterDependencies["resolveFoundFolderName"]
): AssistantOperationResult<AssistantInterpretation> | undefined => {
  const command: FileMutationCommand | undefined = parseFileMutationCommand(instruction);
  if (!command) return undefined;
  const normalized = foldForAlias(instruction);
  if (NON_FILE_NOUN.test(normalized)) return undefined;
  if (!activeFileSearch && !FILE_NOUN.test(normalized)) return undefined;
  if (command.kind === "DELETE_UNSUPPORTED") return clarification(DELETE_UNSUPPORTED_QUESTION);
  if (!activeFileSearch) return clarification(FOUND_FILE_NO_SEARCH);
  const count = activeFileSearch.resultCount;
  const ready = (action: string, input: unknown): AssistantOperationResult<AssistantInterpretation> =>
    success({
      state: "READY",
      summary: READY_SUMMARY,
      drafts: [{ action, input } as ActionSubmission],
      clarifications: []
    });
  const toOrdinal = (reference: OrdinalReference): number | undefined => {
    const ordinal = reference === "LAST" ? count : reference;
    return ordinal >= 1 && ordinal <= count ? ordinal : undefined;
  };
  const selectionInput = (selection: OrdinalSelection): { all: true } | { ordinals: number[] } | undefined => {
    if ("all" in selection) return { all: true };
    const ordinals: number[] = [];
    for (const reference of selection.ordinals) {
      const ordinal = toOrdinal(reference);
      if (ordinal === undefined) return undefined;
      if (!ordinals.includes(ordinal)) ordinals.push(ordinal);
    }
    return { ordinals };
  };

  switch (command.kind) {
    case "INCOMPLETE":
      return clarification(
        command.action === "DELETE" ? DELETE_NEEDS_ORDINAL
          : command.missing === "DESTINATION" ? DESTINATION_QUESTION
          : command.missing === "NAME" ? INVALID_ITEM_NAME
          : command.action === "RENAME" ? "Indica el número del resultado que quieres renombrar, por ejemplo el primero."
          : SELECTION_QUESTION
      );
    case "DELETE": {
      const ordinal = toOrdinal(command.ordinal);
      return ordinal === undefined ? clarification(outOfRangeQuestion(count)) : ready("DELETE_FOUND_ITEM", { ordinal });
    }
    case "RENAME": {
      const ordinal = toOrdinal(command.ordinal);
      if (ordinal === undefined) return clarification(outOfRangeQuestion(count));
      const newName = validateFolderName(command.newName);
      if (!newName || isUnsafeAssistantDraftText(newName)) return clarification(INVALID_ITEM_NAME);
      return ready("RENAME_FOUND_ITEM", { ordinal, newName });
    }
    case "MOVE": {
      const selection = selectionInput(command.selection);
      if (!selection) return clarification(outOfRangeQuestion(count));
      if ("root" in command.destination) {
        return ready("MOVE_FOUND_ITEMS", { ...selection, destinationRoot: command.destination.root });
      }
      const folder = resolveFoundFolderName?.(command.destination.folderName) ?? { state: "NONE" as const };
      if (folder.state === "AMBIGUOUS") return clarification(FOLDER_AMBIGUOUS);
      if (folder.state !== "RESOLVED") return clarification(FOLDER_UNMATCHED);
      return ready("MOVE_FOUND_ITEMS", { ...selection, destinationOrdinal: folder.ordinal });
    }
    case "ORGANIZE": {
      const selection = selectionInput(command.selection);
      if (!selection) return clarification(outOfRangeQuestion(count));
      const folderName = validateFolderName(command.folderName);
      if (!folderName || isUnsafeAssistantDraftText(folderName)) return clarification(INVALID_ITEM_NAME);
      return ready("ORGANIZE_FOUND_ITEMS", { ...selection, folderName, root: command.root });
    }
  }
};

const FOUND_FILE_NO_SEARCH = "Primero dime qué archivo buscar y luego eliges uno de los resultados.";
const FOUND_FILE_AMBIGUOUS = "Hay varios con ese nombre. ¿Cuál es? Dime su número, por ejemplo el segundo.";
const FOUND_FILE_UNMATCHED = "No encontré ese nombre en los últimos resultados. Dime el número del resultado.";

const outOfRangeQuestion = (resultCount: number): string =>
  resultCount === 1
    ? "Solo hay 1 resultado. Indica el número 1."
    : `Solo hay ${resultCount} resultados. Indica un número entre 1 y ${resultCount}.`;

/**
 * «abre el segundo (archivo)», «muéstrame el primero» and «abre <nombre del resultado>» are resolved
 * in Main against the last search before any provider call. A known application alias always wins,
 * and an unmatched name falls through to the provider so applications keep working.
 */
const resolveFoundFileCommand = (
  instruction: string,
  activeFileSearch: { resultCount: number } | undefined,
  knownAliases: readonly string[],
  resolveFoundFileName: AssistantInterpreterDependencies["resolveFoundFileName"]
): AssistantOperationResult<AssistantInterpretation> | undefined => {
  const command = parseFoundFileCommand(instruction);
  if (!command) return undefined;
  const readyDraft = (ordinal: number): AssistantOperationResult<AssistantInterpretation> =>
    success({
      state: "READY",
      summary: READY_SUMMARY,
      drafts: [{ action: command.action, input: { ordinal } }],
      clarifications: []
    });

  if (command.target.kind === "ORDINAL") {
    if (!activeFileSearch) return clarification(FOUND_FILE_NO_SEARCH);
    const ordinal = command.target.ordinal === "LAST" ? activeFileSearch.resultCount : command.target.ordinal;
    return ordinal >= 1 && ordinal <= activeFileSearch.resultCount
      ? readyDraft(ordinal)
      : clarification(outOfRangeQuestion(activeFileSearch.resultCount));
  }

  if (!activeFileSearch || !resolveFoundFileName) return undefined;
  const name = command.target.name;
  const catalogAlias = KNOWN_APPLICATION_CATALOG.some((entry) =>
    [entry.defaultAlias, entry.displayName, ...entry.recognitionAliases].some(
      (alias) => foldForAlias(alias) === name
    )
  );
  const registeredAlias = knownAliases.some((alias) => foldForAlias(alias) === name);
  if (catalogAlias || registeredAlias) return undefined;
  const resolution = resolveFoundFileName(name);
  if (resolution.state === "RESOLVED") return readyDraft(resolution.ordinal);
  return resolution.state === "AMBIGUOUS" ? clarification(FOUND_FILE_AMBIGUOUS) : undefined;
};

type MessagingInterpretationDependencies = Pick<
  AssistantInterpreterDependencies,
  "resolveMessagingContact" | "hasActiveMessageDraft"
>;

const MESSAGING_DRAFT_ACTIONS = [
  "SAVE_CONTACT",
  "LIST_CONTACTS",
  "DELETE_CONTACT",
  "PREPARE_MESSAGE_DRAFT",
  "EDIT_MESSAGE_DRAFT",
  "DISCARD_MESSAGE_DRAFT",
  "OPEN_WHATSAPP_CHAT_WITH_DRAFT"
] as const;

const isMessagingDraftAction = (action: unknown): boolean =>
  typeof action === "string" && (MESSAGING_DRAFT_ACTIONS as readonly string[]).includes(action);

const PHONE_IN_VOICE_QUESTION =
  "No me dictes el número por voz. Dime solo el nombre del contacto y escribirás el número en un formulario.";
const SAVE_NEEDS_NAME = "¿Cómo se llama el contacto que quieres guardar?";
const DRAFT_NEEDS_RECIPIENT = "¿A quién quieres escribirle?";
const DRAFT_NEEDS_BODY = "¿Qué quieres decirle? Solo lo dejo preparado; no lo envío.";
const EDIT_NEEDS_BODY = "¿Por qué texto quieres cambiar el mensaje?";
const OPEN_CHAT_NAMED_QUESTION =
  "Solo puedo abrir el chat del mensaje que preparaste. Di «envíalo» para abrirlo en WhatsApp y pulsar enviar tú.";

const PHONE_DIGITS_IN_TEXT = /\d(?:[\s().-]*\d){6,}/u;
const CONTACT_SAVE_INTENT =
  /\b(?:guarda|guardar|agrega|agregar|a[ñn]ade|a[ñn]adir|crea|crear|registra|registrar|anota|apunta)\b.*\b(?:contacto|n[uú]mero|tel[eé]fono|celular)\b/iu;

/** A number said aloud must not reach the provider: the contact form is the only place to enter it. */
const getPhoneInVoiceClarification = (instruction: string): AssistantOperationResult<AssistantInterpretation> | undefined =>
  PHONE_DIGITS_IN_TEXT.test(instruction) && CONTACT_SAVE_INTENT.test(instruction)
    ? clarification(PHONE_IN_VOICE_QUESTION)
    : undefined;

const resolveContactForDraft = async (
  reference: string,
  dependencies: MessagingInterpretationDependencies
): Promise<{ displayName: string } | { question: string }> => {
  if (!dependencies.resolveMessagingContact) return { displayName: reference };
  const resolution = await dependencies.resolveMessagingContact(reference);
  if (resolution.state === "RESOLVED") return { displayName: resolution.displayName };
  return {
    question:
      resolution.state === "AMBIGUOUS"
        ? MESSAGING_FAILURES.MESSAGING_CONTACT_AMBIGUOUS
        : resolution.state === "UNAVAILABLE"
          ? MESSAGING_FAILURES.MESSAGING_STORAGE_UNAVAILABLE
          : MESSAGING_FAILURES.MESSAGING_CONTACT_NOT_FOUND
  };
};

/**
 * «guarda un contacto llamado Mamá», «qué contactos tengo», «escríbele a Mamá que llego en diez minutos»,
 * «cámbialo por …» and «descarta el mensaje» are classified and resolved in Main before any provider call.
 * A request to send or to open the chat only receives the fixed notice that nothing is sent yet, and
 * another channel only receives the fixed notice that WhatsApp drafts are the only option.
 */
const resolveMessagingCommand = async (
  instruction: string,
  dependencies: MessagingInterpretationDependencies
): Promise<AssistantOperationResult<AssistantInterpretation> | undefined> => {
  const command = parseMessagingCommand(instruction);
  if (!command) return getPhoneInVoiceClarification(instruction);
  const ready = (action: string, input: unknown): AssistantOperationResult<AssistantInterpretation> =>
    success({
      state: "READY",
      summary: READY_SUMMARY,
      drafts: [{ action, input } as ActionSubmission],
      clarifications: []
    });
  const hasDraft = dependencies.hasActiveMessageDraft?.() ?? false;

  switch (command.kind) {
    case "PHONE_IN_VOICE":
      return clarification(PHONE_IN_VOICE_QUESTION);
    case "SAVE_CONTACT_INCOMPLETE":
      return clarification(SAVE_NEEDS_NAME);
    case "SAVE_CONTACT": {
      const name = validateContactName(command.name);
      return name.ok ? ready("SAVE_CONTACT", { contactName: name.data.displayName }) : clarification(name.error.userMessage);
    }
    case "LIST_CONTACTS":
      return ready("LIST_CONTACTS", {});
    case "DELETE_CONTACT": {
      const resolved = await resolveContactForDraft(command.name, dependencies);
      return "question" in resolved ? clarification(resolved.question) : ready("DELETE_CONTACT", { contactName: resolved.displayName });
    }
    case "DRAFT_INCOMPLETE":
      return clarification(command.missing === "RECIPIENT" ? DRAFT_NEEDS_RECIPIENT : DRAFT_NEEDS_BODY);
    case "OTHER_CHANNEL_REQUEST":
      return clarification(MESSAGING_FAILURES.MESSAGING_UNSUPPORTED_CHANNEL);
    case "PREPARE_DRAFT": {
      if (command.channel !== "WHATSAPP") return clarification(MESSAGING_FAILURES.MESSAGING_UNSUPPORTED_CHANNEL);
      const body = sanitizeMessageBody(command.body);
      if (!body.ok) return clarification(body.error.userMessage);
      const resolved = await resolveContactForDraft(command.recipient, dependencies);
      return "question" in resolved
        ? clarification(resolved.question)
        : ready("PREPARE_MESSAGE_DRAFT", { recipient: resolved.displayName, body: body.data, channel: "WHATSAPP" });
    }
    case "EDIT_INCOMPLETE":
      return clarification(hasDraft ? EDIT_NEEDS_BODY : MESSAGING_FAILURES.MESSAGING_NO_DRAFT);
    case "EDIT_DRAFT": {
      if (!hasDraft) return clarification(MESSAGING_FAILURES.MESSAGING_NO_DRAFT);
      const body = sanitizeMessageBody(command.body);
      return body.ok ? ready("EDIT_MESSAGE_DRAFT", { body: body.data }) : clarification(body.error.userMessage);
    }
    case "DISCARD_DRAFT":
      return hasDraft ? ready("DISCARD_MESSAGE_DRAFT", {}) : clarification(MESSAGING_FAILURES.MESSAGING_NO_DRAFT);
    case "SEND_REQUEST":
    case "OPEN_CHAT_REQUEST":
      return hasDraft
        ? ready("OPEN_WHATSAPP_CHAT_WITH_DRAFT", {})
        : clarification(MESSAGING_FAILURES.MESSAGING_NO_DRAFT);
    case "OPEN_CHAT_NAMED":
      return clarification(OPEN_CHAT_NAMED_QUESTION);
  }
};

const mentionsInInstruction = (instruction: string, value: string): boolean => {
  const key = toLookupKey(value);
  return key.length > 0 && toLookupKey(instruction).includes(key);
};

/**
 * Validates a provider draft for the MESSAGING actions with the same closed rules as the deterministic
 * path. Names and the message text must come from what the person said, and the provider never supplies
 * a number: the strict output schema has no field for one.
 */
const validateMessagingProviderDraft = async (
  candidate: UnknownRecord,
  instruction: string,
  dependencies: MessagingInterpretationDependencies
): Promise<DraftValidationResult> => {
  const action = candidate.action as (typeof MESSAGING_DRAFT_ACTIONS)[number];
  if (candidate.input != null || (candidate.messagingAction != null && !isRecord(candidate.messagingAction))) return null;
  const fields: UnknownRecord = isRecord(candidate.messagingAction)
    ? Object.fromEntries(Object.entries(candidate.messagingAction).filter(([, value]) => value !== null))
    : {};
  const only = (allowed: readonly string[]): boolean => hasOnlyKeys(fields, allowed);
  if (action === "OPEN_WHATSAPP_CHAT_WITH_DRAFT") {
    if (Object.keys(fields).length !== 0) return null;
    return dependencies.hasActiveMessageDraft?.() ?? false
      ? ({ action, input: {} } as ActionSubmission)
      : draftClarification(MESSAGING_FAILURES.MESSAGING_NO_DRAFT);
  }
  if ((action === "LIST_CONTACTS" || action === "DISCARD_MESSAGE_DRAFT") && Object.keys(fields).length === 0) {
    return { action, input: {} } as ActionSubmission;
  }
  if (action === "LIST_CONTACTS" || action === "DISCARD_MESSAGE_DRAFT") return null;

  if (action === "SAVE_CONTACT") {
    if (!only(["contactName", "aliases"])) return null;
    const name = validateContactName(fields.contactName);
    if (!name.ok) return draftClarification(SAVE_NEEDS_NAME);
    const aliases = validateContactAliases(fields.aliases);
    if (!aliases.ok) return draftClarification(aliases.error.userMessage);
    if (!mentionsInInstruction(instruction, name.data.displayName)) return draftClarification(SAVE_NEEDS_NAME);
    if (!aliases.data.every((alias) => mentionsInInstruction(instruction, alias.displayName))) return null;
    return {
      action,
      input: {
        contactName: name.data.displayName,
        ...(aliases.data.length === 0 ? {} : { aliases: aliases.data.map((alias) => alias.displayName) })
      }
    } as ActionSubmission;
  }
  if (action === "DELETE_CONTACT") {
    if (!only(["contactName"]) || typeof fields.contactName !== "string") return draftClarification(MESSAGING_FAILURES.MESSAGING_CONTACT_NOT_FOUND);
    const resolved = await resolveContactForDraft(fields.contactName, dependencies);
    return "question" in resolved
      ? draftClarification(resolved.question)
      : ({ action, input: { contactName: resolved.displayName } } as ActionSubmission);
  }
  if (action === "PREPARE_MESSAGE_DRAFT") {
    if (!only(["recipient", "body", "channel"])) return null;
    if (fields.channel !== undefined && fields.channel !== "WHATSAPP") return draftClarification(MESSAGING_FAILURES.MESSAGING_UNSUPPORTED_CHANNEL);
    if (typeof fields.recipient !== "string") return draftClarification(DRAFT_NEEDS_RECIPIENT);
    const body = sanitizeMessageBody(fields.body);
    if (!body.ok) return draftClarification(typeof fields.body === "string" ? body.error.userMessage : DRAFT_NEEDS_BODY);
    if (!mentionsInInstruction(instruction, body.data)) return draftClarification(DRAFT_NEEDS_BODY);
    const resolved = await resolveContactForDraft(fields.recipient, dependencies);
    return "question" in resolved
      ? draftClarification(resolved.question)
      : ({ action, input: { recipient: resolved.displayName, body: body.data, channel: "WHATSAPP" } } as ActionSubmission);
  }
  // EDIT_MESSAGE_DRAFT
  if (!only(["body"])) return null;
  if (!(dependencies.hasActiveMessageDraft?.() ?? false)) return draftClarification(MESSAGING_FAILURES.MESSAGING_NO_DRAFT);
  const body = sanitizeMessageBody(fields.body);
  if (!body.ok) return draftClarification(typeof fields.body === "string" ? body.error.userMessage : EDIT_NEEDS_BODY);
  if (!mentionsInInstruction(instruction, body.data)) return draftClarification(EDIT_NEEDS_BODY);
  return { action, input: { body: body.data } } as ActionSubmission;
};

const NOT_CONNECTED_QUESTION =
  "Para reproducir música necesito conectar tu cuenta de Spotify. Di «conecta Spotify».";
const APP_SEARCH_HINT = " Mientras tanto, «busca algo en Spotify» abre la búsqueda en la aplicación.";
const VOLUME_QUESTION = "El volumen debe estar entre 0 y 100.";

const isSpotifyConnected = async (dependencies: StreamingInterpretationDependencies): Promise<boolean> => {
  try {
    return (await dependencies.isSpotifyConnected?.()) ?? false;
  } catch {
    return false;
  }
};

/** Asks to connect instead of playing; it never falls back silently to another route. */
const notConnectedQuestion = async (dependencies: StreamingInterpretationDependencies): Promise<string> =>
  (await isSpotifyRegistered(dependencies)) ? `${NOT_CONNECTED_QUESTION}${APP_SEARCH_HINT}` : NOT_CONNECTED_QUESTION;

/** «conecta Spotify», «pausa», «siguiente», «sube el volumen», «qué está sonando»: classified in Main, no provider. */
const resolveSpotifyControlCommand = (instruction: string): AssistantOperationResult<AssistantInterpretation> | undefined => {
  const command = parseSpotifyControlCommand(instruction);
  if (!command) return undefined;
  const ready = (action: string, input: unknown): AssistantOperationResult<AssistantInterpretation> =>
    success({ state: "READY", summary: READY_SUMMARY, drafts: [{ action, input } as ActionSubmission], clarifications: [] });
  switch (command.kind) {
    case "CONNECT": return ready("CONNECT_SPOTIFY", {});
    case "DISCONNECT": return ready("DISCONNECT_SPOTIFY", {});
    case "STATUS": return ready("GET_SPOTIFY_STATUS", {});
    case "PAUSE": return ready("PAUSE_SPOTIFY", {});
    case "RESUME": return ready("RESUME_SPOTIFY", {});
    case "NEXT": return ready("NEXT_SPOTIFY_TRACK", {});
    case "PREVIOUS": return ready("PREVIOUS_SPOTIFY_TRACK", {});
    case "WHAT_IS_PLAYING": return ready("WHAT_IS_PLAYING", {});
    case "VOLUME_CHANGE": return ready("SET_SPOTIFY_VOLUME", { change: command.direction });
    case "VOLUME_LEVEL": return ready("SET_SPOTIFY_VOLUME", { level: command.level });
    case "VOLUME_INVALID": return clarification(VOLUME_QUESTION);
  }
};

type StreamingInterpretationDependencies = {
  isSpotifyAppRegistered?: () => Promise<boolean>;
  isSpotifyConnected?: () => Promise<boolean>;
};

const SPOTIFY_QUERY_QUESTION = "Indica qué canción, artista o álbum quieres buscar en Spotify.";
const WEB_QUERY_QUESTION = "Indica una búsqueda válida para Google, YouTube o Spotify.";

const isSpotifyRegistered = async (dependencies: StreamingInterpretationDependencies): Promise<boolean> => {
  try {
    return (await dependencies.isSpotifyAppRegistered?.()) ?? false;
  } catch {
    return false;
  }
};

/**
 * «busca/pon/reproduce X en Spotify» and «pon música de X» open the registered Spotify app on a search, or fall
 * back to the approved Spotify web search when the app is not registered; exactly one of them, never both.
 * «busca X en Google/YouTube», «pon X en YouTube» and «abre Google/YouTube» use the approved web actions. A
 * registered application alias with the same name keeps priority and falls through to the provider.
 */
const resolveStreamingCommand = async (
  instruction: string,
  knownAliases: readonly string[],
  dependencies: StreamingInterpretationDependencies
): Promise<AssistantOperationResult<AssistantInterpretation> | undefined> => {
  const command = parseStreamingCommand(instruction);
  if (!command) return undefined;
  const ready = (action: string, input: unknown): AssistantOperationResult<AssistantInterpretation> =>
    success({ state: "READY", summary: READY_SUMMARY, drafts: [{ action, input } as ActionSubmission], clarifications: [] });

  if (command.kind === "SPOTIFY_SEARCH") {
    const query = validateSpotifySearchQuery(command.query);
    if (!query) return clarification(SPOTIFY_QUERY_QUESTION);
    if (command.playRequested) {
      return (await isSpotifyConnected(dependencies))
        ? ready("PLAY_SPOTIFY_MUSIC", { query, ...(command.searchKind === "ANY" ? {} : { kind: command.searchKind }) })
        : clarification(await notConnectedQuestion(dependencies));
    }
    if (await isSpotifyRegistered(dependencies)) {
      return ready("SEARCH_SPOTIFY_APP", {
        query,
        ...(command.searchKind === "ANY" ? {} : { kind: command.searchKind }),
        ...(command.playRequested ? { playRequested: true } : {})
      });
    }
    const web = validateApprovedWebActionInput("SEARCH_APPROVED_SITE", { site: "SPOTIFY", query });
    return web ? ready("SEARCH_APPROVED_SITE", web.input) : clarification(WEB_QUERY_QUESTION);
  }

  const siteAlias = foldForAlias(command.site);
  if (knownAliases.some((alias) => foldForAlias(alias) === siteAlias)) return undefined;
  if (command.kind === "WEB_OPEN") return ready("OPEN_APPROVED_PAGE", { site: command.site });
  const web = validateApprovedWebActionInput("SEARCH_APPROVED_SITE", { site: command.site, query: command.query });
  return web ? ready("SEARCH_APPROVED_SITE", web.input) : clarification(WEB_QUERY_QUESTION);
};

/** The model may name either Spotify route; Main keeps it consistent with whether the app is registered. */
const reconcileSpotifyRouting = async (
  draft: ActionSubmission,
  dependencies: StreamingInterpretationDependencies
): Promise<ActionSubmission | { clarification: string }> => {
  if (draft.action === "PLAY_SPOTIFY_MUSIC") {
    return (await isSpotifyConnected(dependencies)) ? draft : { clarification: await notConnectedQuestion(dependencies) };
  }
  if (draft.action === "SEARCH_SPOTIFY_APP" && draft.input.playRequested === true) {
    if (!(await isSpotifyConnected(dependencies))) return { clarification: await notConnectedQuestion(dependencies) };
    return {
      action: "PLAY_SPOTIFY_MUSIC",
      input: { query: draft.input.query, ...(draft.input.kind && draft.input.kind !== "ANY" ? { kind: draft.input.kind } : {}) }
    };
  }
  if (draft.action === "SEARCH_SPOTIFY_APP") {
    if (await isSpotifyRegistered(dependencies)) return draft;
    const web = validateApprovedWebActionInput("SEARCH_APPROVED_SITE", { site: "SPOTIFY", query: draft.input.query });
    return web ? ({ action: web.action, input: web.input } as ActionSubmission) : draft;
  }
  if (draft.action === "SEARCH_APPROVED_SITE" && draft.input.site === "SPOTIFY" && (await isSpotifyRegistered(dependencies))) {
    const query = validateSpotifySearchQuery(draft.input.query);
    return query ? { action: "SEARCH_SPOTIFY_APP", input: { query } } : draft;
  }
  return draft;
};

const rejection = (
  code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES] =
    ASSISTANT_ERROR_CODES.rejected
): AssistantOperationResult<AssistantInterpretation> =>
  success({
    state: "REJECTED",
    summary: code === ASSISTANT_ERROR_CODES.malformed
      ? "La respuesta del servicio de interpretación no se pudo validar. Inténtalo de nuevo."
      : "No puedo preparar esa solicitud de forma segura.",
    drafts: [],
    clarifications: [],
    errorCode: code
  });

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: UnknownRecord, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const isSafeText = (value: unknown, maximumLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;

const createReference = (
  dependencies: AssistantInterpreterDependencies,
  overrides?: Partial<AssistantInterpretationReference>
): AssistantInterpretationReference => ({
  now: overrides?.now ?? (dependencies.now ?? (() => new Date()))().toISOString(),
  timeZone: overrides?.timeZone ?? (dependencies.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone))(),
  ...(overrides?.knownApplicationAliases
    ? { knownApplicationAliases: overrides.knownApplicationAliases }
    : {}),
  ...(overrides?.knownCatalogApplications ? { knownCatalogApplications: overrides.knownCatalogApplications } : {}),
  ...(overrides?.activeFileSearch ? { activeFileSearch: overrides.activeFileSearch } : {}),
  ...(overrides?.knownApplications ? { knownApplications: overrides.knownApplications } : {}),
  ...(overrides?.currentContext ? { currentContext: overrides.currentContext } : {})
});

type DraftClarification = { kind: "CLARIFICATION"; question: string };
type DraftValidationResult = ActionSubmission | ActionSubmission[] | DraftClarification | null;
type ContextTokenResolution = { input: unknown; usedToken: boolean } | DraftClarification | null;

const draftClarification = (question: string): DraftClarification => ({ kind: "CLARIFICATION", question });

const isDraftClarification = (value: DraftValidationResult): value is DraftClarification =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "CLARIFICATION";

const resolveCurrentContextToken = (
  action: string,
  value: unknown,
  context: ResolvedAssistantContext | undefined
): ContextTokenResolution => {
  if (!isRecord(value)) return { input: value, usedToken: false };
  const hasToken = Object.values(value).some((entry) => entry === ASSISTANT_CURRENT_CONTEXT_TOKEN);
  if (!hasToken) return { input: value, usedToken: false };
  if (!context) return draftClarification("Primero elige algo en la pantalla para eso.");
  const selection = context.selection;
  const replace = (key: string, kind: string, replacement: unknown): ContextTokenResolution =>
    value[key] === ASSISTANT_CURRENT_CONTEXT_TOKEN && context.providerContext.kind === kind
      ? { input: { ...value, [key]: replacement }, usedToken: true }
      : draftClarification("Eso no se puede hacer con lo que elegiste.");
  if (action === "UPDATE_TASK" || action === "COMPLETE_TASK") {
    return selection.section === "PLANNER" ? replace("taskId", "TASK", selection.id) : draftClarification("Elige primero una tarea.");
  }
  if (action === "UPDATE_EVENT" || action === "DELETE_EVENT") {
    return selection.section === "PLANNER" ? replace("eventId", "EVENT", selection.id) : draftClarification("Elige primero un evento.");
  }
  if (action === "CREATE_REMINDER") {
    if (selection.section !== "PLANNER") return draftClarification("Elige primero una tarea o un evento.");
    if (value.taskId === ASSISTANT_CURRENT_CONTEXT_TOKEN && selection.kind === "TASK") return { input: { ...value, taskId: selection.id }, usedToken: true };
    if (value.eventId === ASSISTANT_CURRENT_CONTEXT_TOKEN && selection.kind === "EVENT") return { input: { ...value, eventId: selection.id }, usedToken: true };
    return draftClarification("La selección actual no corresponde al recordatorio.");
  }
  if (action === "OPEN_APPLICATION") {
    return selection.section === "APPLICATIONS" ? replace("alias", "APPLICATION", selection.alias) : draftClarification("Elige primero una aplicación registrada.");
  }
  if (action === "CREATE_FOLDER") return selection.section === "FILES" ? replace("parentDirectory", "FOLDER", selection.reference) : draftClarification("Elige primero una carpeta.");
  if (action === "SEARCH_FILES") {
    if (selection.section === "FILES" && selection.kind === "FOLDER" && value.relativePath === ASSISTANT_CURRENT_CONTEXT_TOKEN) {
      return { input: { ...value, rootId: selection.reference.rootId, relativePath: selection.reference.relativePath }, usedToken: true };
    }
    return draftClarification("Elige primero una carpeta.");
  }
  return draftClarification("Eso no se puede hacer con lo que elegiste.");
};

const scheduleDateClarification = (reason: PlannerTemporalResolutionReason): string =>
  reason === "DATE_OUT_OF_RANGE" ? "Solo puedo consultar los próximos 14 días. ¿Qué día quieres?"
    : reason === "DATE_PAST" ? "Solo puedo consultar desde hoy en adelante. ¿Qué día quieres?"
      : reason === "WEEKDAY_AMBIGUOUS" ? "¿Hoy o el próximo? Dime la fecha exacta."
        : "¿De qué día quieres la agenda? Dime «hoy», «mañana» o una fecha.";

const plannerClarification = (
  action: PlannerTemporalAction,
  reason?: PlannerTemporalResolutionReason,
  hour?: number
): DraftClarification => {
  if (reason === "TIME_AMBIGUOUS") {
    // An hour from 1 to 12 said without a day period is never guessed.
    if (hour === 12) return draftClarification("¿A las 12 del mediodía o a medianoche?");
    return draftClarification(hour === undefined ? "¿Es de la mañana o de la tarde?" : `¿A las ${hour} de la mañana o de la tarde?`);
  }
  if (reason === "TIME_RANGE_INVALID") {
    return draftClarification("La hora final del evento debe ser posterior a la hora de inicio.");
  }
  if (action === "CREATE_EVENT") {
    return draftClarification("El evento necesita una fecha y hora locales válidas que no estén en el pasado.");
  }
  if (action === "CREATE_REMINDER") {
    return draftClarification("El recordatorio necesita una fecha y hora locales válidas que no estén en el pasado.");
  }
  return draftClarification("La tarea necesita una fecha u hora válidas que no estén en el pasado.");
};

const validateDraft = async (
  candidate: unknown,
  reference: AssistantInterpretationReference,
  temporalResolver: ReturnType<typeof createPlannerTemporalResolver>,
  currentContext?: ResolvedAssistantContext,
  resolveEventDeletion?: ResolveEventDeletion,
  instruction = ""
): Promise<DraftValidationResult> => {
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["action", "input"]) || typeof candidate.action !== "string") {
    return null;
  }

  const { action } = candidate;
  if (!isEnabledAssistantAction(action)) return null;
  const tokenResolution = resolveCurrentContextToken(action, candidate.input, currentContext);
  if (typeof tokenResolution === "object" && tokenResolution !== null && "kind" in tokenResolution) {
    return tokenResolution as DraftClarification;
  }
  if (!tokenResolution) return null;
  const { input } = tokenResolution;
  switch (action) {
    case "DELETE_EVENT": {
      if (tokenResolution.usedToken) {
        const validated = validateDeleteEventInput(input);
        return validated.ok ? { action, input: validated.data } : null;
      }
      if (!isRecord(input) || !hasOnlyKeys(input, ["eventTitle", "startAt"])) {
        return draftClarification("Indica el título del evento o selecciona un evento válido. Su eliminación requiere confirmación.");
      }
      if (!isSafeText(input.eventTitle, 200) || isUnsafeAssistantDraftText(input.eventTitle)) {
        return draftClarification("¿Cuál es el título del evento que quieres eliminar? Necesitará confirmación.");
      }
      if (!foldEventTitle(instruction).includes(foldEventTitle(input.eventTitle))) return null;
      const range = validateEventListInput(input.startAt === undefined ? {} : { startAt: input.startAt });
      if (!range.ok) return draftClarification("Indica la fecha y hora exactas del evento para distinguirlo.");
      if (range.data.startAt && !instruction.includes(range.data.startAt)) {
        return draftClarification("Indica la fecha y hora exactas con zona horaria o selecciona el evento. No puedo suponer cuál quieres eliminar.");
      }
      if (!resolveEventDeletion) return draftClarification("Selecciona un evento válido o indica su título exacto. Su eliminación requiere confirmación.");
      const resolution = await resolveEventDeletion({ title: input.eventTitle.trim(), ...range.data });
      if (resolution.state === "AMBIGUOUS") return draftClarification("Hay varios eventos con ese título. Indica su fecha y hora exactas o selecciona uno en el contexto.");
      if (resolution.state === "MISSING") return draftClarification("No encontré ese evento. Indica su título exacto o selecciona un evento existente.");
      if (resolution.state !== "RESOLVED") return draftClarification("No pude consultar tus eventos. Inténtalo de nuevo.");
      const validated = validateDeleteEventInput({ eventId: resolution.eventId });
      return validated.ok ? { action, input: validated.data } : null;
    }
    case "CREATE_TASK": {
      const temporal = temporalResolver.resolve(action as PlannerTemporalAction, input);
      if (!temporal.ok) return plannerClarification(action, temporal.reason, temporal.hour);
      if (!hasOnlyKeys(temporal.input, ["title", "description", "dueDate", "dueTime", "priority", "status", "categoryId", "completedAt"])) {
        return null;
      }
      const result = validateCreateTaskInput(temporal.input);
      if (!result.ok) return plannerClarification(action);
      if (result.data.categoryId !== undefined) return draftClarification("La categoría de la tarea necesita una referencia confiable.");
      return { action, input: result.data };
    }
    case "CREATE_EVENT": {
      const temporal = temporalResolver.resolve(action as PlannerTemporalAction, input);
      if (!temporal.ok) return plannerClarification(action, temporal.reason, temporal.hour);
      if (!hasOnlyKeys(temporal.input, ["title", "description", "startAt", "endAt", "categoryId", "location"])) {
        return null;
      }
      const result = validateCreateEventInput(temporal.input);
      if (!result.ok) return plannerClarification(action);
      if (result.data.categoryId !== undefined) return draftClarification("La categoría del evento necesita una referencia confiable.");
      return { action, input: result.data };
    }
    case "CREATE_REMINDER": {
      const temporal = temporalResolver.resolve(action as PlannerTemporalAction, input);
      if (!temporal.ok) return plannerClarification(action, temporal.reason, temporal.hour);
      if (!hasOnlyKeys(temporal.input, ["title", "remindAt", "taskId", "eventId", "status", "deliveredAt"])) {
        return null;
      }
      const result = validateCreateReminderInput(temporal.input);
      if (!result.ok) return plannerClarification(action);
      if (result.data.taskId !== undefined || result.data.eventId !== undefined) {
        return draftClarification("La relación del recordatorio necesita una referencia confiable.");
      }
      return { action, input: result.data };
    }
    case "GET_TODAY_SCHEDULE": {
      if (!isRecord(input)) return null;
      // The day (today, tomorrow, the day after, a weekday or a date) is resolved by Main's clock, never by the model.
      const temporal = temporalResolver.resolve("GET_TODAY_SCHEDULE", input);
      if (!temporal.ok) return draftClarification(scheduleDateClarification(temporal.reason));
      const result = validateGetTodayScheduleInput(temporal.input);
      return result.ok ? { action, input: result.data } : null;
    }
    case "GET_WEEK_SCHEDULE": {
      const result = validateGetWeekScheduleInput(input);
      return result.ok ? { action, input: result.data } : null;
    }
    case "GET_CURRENT_DATE_TIME": {
      return isRecord(input) && hasOnlyKeys(input, []) ? { action, input: {} } : null;
    }
    case "GET_SYSTEM_INFO": {
      // A closed topic from a closed list; nothing the person said is copied into the draft.
      const result = validateSystemInfoInput(input);
      return result.ok ? { action, input: result.data } : null;
    }
    case "GET_WEATHER": {
      const result = validateWeatherInput(input);
      if (!result.ok) return null;
      const { location } = result.data;
      if (location !== undefined) {
        // The place is copied from the person's own words; an invented or injected place is never forwarded.
        if (isUnsafeAssistantDraftText(location) || !foldLooseText(instruction).includes(foldLooseText(location))) {
          return draftClarification("¿De qué lugar quieres saber el clima?");
        }
      }
      return { action, input: result.data };
    }
    case "OPEN_APPLICATION": {
      const alias = isRecord(input) ? input.alias : undefined;
      const result = isRecord(input) && hasOnlyKeys(input, ["alias"])
        ? validateApplicationAlias(alias)
        : { ok: false as const };
      if (!result.ok || isUnsafeAssistantDraftText(alias)) return null;
      const known = reference.knownApplicationAliases?.some(
        (alias) => alias.trim().toLocaleLowerCase() === result.data.toLocaleLowerCase()
      );
      return known
        ? { action, input: { alias: result.data } }
        : draftClarification("Aún no tengo esa aplicación registrada. Pídeme que la registre primero.");
    }
    case "REGISTER_CATALOG_APPLICATION": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["catalogKey", "alias"]) || !isKnownApplicationCatalogKey(input.catalogKey)) {
        return draftClarification("Indica una aplicación aprobada que quieras registrar.");
      }
      const catalogApplication = getKnownApplication(input.catalogKey);
      const known = reference.knownCatalogApplications?.some((entry) => entry.key === input.catalogKey);
      if (!catalogApplication || !known) return draftClarification("Indica una aplicación aprobada que quieras registrar.");
      if (input.alias === undefined) return { action, input: { catalogKey: catalogApplication.key } };
      const alias = validateApplicationAlias(input.alias);
      if (!alias.ok || isUnsafeAssistantDraftText(input.alias)) {
        return draftClarification("Indica un alias válido para la aplicación.");
      }
      return { action, input: { catalogKey: catalogApplication.key, alias: alias.data } };
    }
    case "REQUEST_CUSTOM_APPLICATION_REGISTRATION": {
      // The model may only carry an optional friendly name; the executable is chosen in a native picker.
      const requested = input === undefined ? {} : input;
      if (!isRecord(requested) || !hasOnlyKeys(requested, ["displayName"])) return null;
      if (requested.displayName === undefined) return { action, input: {} };
      const displayName = validateCustomApplicationDisplayName(requested.displayName);
      if (!displayName.ok || isUnsafeAssistantDraftText(requested.displayName)) {
        return draftClarification("Indica un nombre válido para la aplicación.");
      }
      return { action, input: { displayName: displayName.data } };
    }
    case "OPEN_APPROVED_PAGE":
    case "SEARCH_APPROVED_SITE": {
      const validated = validateApprovedWebActionInput(action, input);
      if (!validated) {
        return draftClarification(
          action === "OPEN_APPROVED_PAGE"
            ? "Solo puedo abrir Google, YouTube o Spotify."
            : "Indica una búsqueda válida para Google, YouTube o Spotify."
        );
      }
      return validated;
    }
    case "CONNECT_SPOTIFY":
    case "DISCONNECT_SPOTIFY":
    case "GET_SPOTIFY_STATUS":
    case "PAUSE_SPOTIFY":
    case "RESUME_SPOTIFY":
    case "NEXT_SPOTIFY_TRACK":
    case "PREVIOUS_SPOTIFY_TRACK":
    case "WHAT_IS_PLAYING":
      return isRecord(input) && hasOnlyKeys(input, []) ? { action, input: {} } : null;
    case "PLAY_SPOTIFY_MUSIC": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["query", "kind"])) return null;
      const query = validateSpotifySearchQuery(input.query);
      if (!query) return draftClarification(SPOTIFY_QUERY_QUESTION);
      if (input.kind !== undefined && !(SPOTIFY_SEARCH_KINDS as readonly unknown[]).includes(input.kind)) return null;
      if (!foldForAlias(instruction).includes(foldForAlias(query))) {
        return draftClarification(SPOTIFY_QUERY_QUESTION);
      }
      return {
        action,
        input: {
          query,
          ...(input.kind === undefined || input.kind === "ANY" ? {} : { kind: input.kind as (typeof SPOTIFY_SEARCH_KINDS)[number] })
        }
      };
    }
    case "SET_SPOTIFY_VOLUME": {
      if (!isRecord(input) || Object.keys(input).length !== 1) return draftClarification(VOLUME_QUESTION);
      if (typeof input.level === "number" && Number.isInteger(input.level) && input.level >= 0 && input.level <= 100) {
        return { action, input: { level: input.level } };
      }
      if (input.change === "UP" || input.change === "DOWN") return { action, input: { change: input.change } };
      return draftClarification(VOLUME_QUESTION);
    }
    case "SEARCH_SPOTIFY_APP": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["query", "kind", "playRequested"])) return null;
      const query = validateSpotifySearchQuery(input.query);
      if (!query) return draftClarification(SPOTIFY_QUERY_QUESTION);
      if (input.kind !== undefined && !(SPOTIFY_SEARCH_KINDS as readonly unknown[]).includes(input.kind)) return null;
      if (input.playRequested !== undefined && typeof input.playRequested !== "boolean") return null;
      // The query must come from what the person said, not from the model.
      if (!foldForAlias(instruction).includes(foldForAlias(query))) {
        return draftClarification(SPOTIFY_QUERY_QUESTION);
      }
      return {
        action,
        input: {
          query,
          ...(input.kind === undefined || input.kind === "ANY" ? {} : { kind: input.kind as (typeof SPOTIFY_SEARCH_KINDS)[number] }),
          ...(input.playRequested === true ? { playRequested: true } : {})
        }
      };
    }
    case "SEARCH_FILES": {
      // Only a short name fragment plus closed enums; the model never supplies a path or root location.
      if (!isRecord(input) || !hasOnlyKeys(input, ["query", "root", "kind"])) return null;
      const query = validateSearchQuery(input.query);
      if (!query || isUnsafeAssistantDraftText(query)) {
        return draftClarification("Indica qué nombre de archivo o carpeta quieres buscar.");
      }
      if (input.root !== undefined && !isSupervisedFileRoot(input.root)) return null;
      if (input.kind !== undefined && !isFileSearchKind(input.kind)) return null;
      return {
        action,
        input: {
          query,
          ...(input.root === undefined ? {} : { root: input.root }),
          ...(input.kind === undefined ? {} : { kind: input.kind })
        }
      };
    }
    case "REVEAL_FOUND_FILE":
    case "OPEN_FOUND_FILE": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["ordinal"]) || !isFoundOrdinal(input.ordinal)) {
        return draftClarification("Indica el número del resultado, por ejemplo el primero o el segundo.");
      }
      return { action, input: { ordinal: input.ordinal } };
    }
    case "RENAME_FOUND_ITEM": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["ordinal", "newName"]) || !isFoundOrdinal(input.ordinal)) {
        return draftClarification("Indica el número del resultado que quieres renombrar, por ejemplo el primero.");
      }
      const newName = validateFolderName(input.newName);
      if (!newName || isUnsafeAssistantDraftText(newName)) return draftClarification(INVALID_ITEM_NAME);
      return { action, input: { ordinal: input.ordinal, newName } };
    }
    case "DELETE_FOUND_ITEM": {
      // Exactly one explicit ordinal: a name, a batch, or any extra field is never turned into a deletion.
      if (!isRecord(input) || !hasOnlyKeys(input, ["ordinal"]) || !isFoundOrdinal(input.ordinal)) {
        return draftClarification(DELETE_NEEDS_ORDINAL);
      }
      return { action, input: { ordinal: input.ordinal } };
    }
    case "MOVE_FOUND_ITEMS": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["ordinals", "all", "destinationRoot", "destinationOrdinal"])) return null;
      const selection = parseSelection(input);
      if (!selection) return draftClarification(SELECTION_QUESTION);
      if (input.destinationRoot !== undefined && !isSupervisedFileRoot(input.destinationRoot)) return null;
      if (input.destinationOrdinal !== undefined && !isFoundOrdinal(input.destinationOrdinal)) return null;
      if (input.destinationRoot === undefined && input.destinationOrdinal === undefined) return draftClarification(DESTINATION_QUESTION);
      return {
        action,
        input: {
          ...selection,
          ...(input.destinationRoot === undefined ? {} : { destinationRoot: input.destinationRoot }),
          ...(input.destinationOrdinal === undefined ? {} : { destinationOrdinal: input.destinationOrdinal })
        }
      };
    }
    case "ORGANIZE_FOUND_ITEMS": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["ordinals", "all", "folderName", "root"])) return null;
      const selection = parseSelection(input);
      if (!selection) return draftClarification(SELECTION_QUESTION);
      const folderName = validateFolderName(input.folderName);
      if (!folderName || isUnsafeAssistantDraftText(folderName)) return draftClarification(INVALID_ITEM_NAME);
      if (!isSupervisedFileRoot(input.root)) return draftClarification(DESTINATION_QUESTION);
      return { action, input: { ...selection, folderName, root: input.root } };
    }
    case "CREATE_FOLDER": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["folderName", "root", "parentOrdinal"])) return null;
      const folderName = validateFolderName(input.folderName);
      if (!folderName || isUnsafeAssistantDraftText(folderName)) {
        return draftClarification("Indica un nombre válido para la carpeta.");
      }
      if (input.root !== undefined && !isSupervisedFileRoot(input.root)) return null;
      if (input.parentOrdinal !== undefined && !isFoundOrdinal(input.parentOrdinal)) return null;
      if (input.root === undefined && input.parentOrdinal === undefined) {
        return draftClarification("¿En qué ubicación quieres crear la carpeta? Puedo usar Escritorio, Documentos, Descargas, Imágenes, Música o Videos.");
      }
      return {
        action,
        input: {
          folderName,
          ...(input.root === undefined ? {} : { root: input.root }),
          ...(input.parentOrdinal === undefined ? {} : { parentOrdinal: input.parentOrdinal })
        }
      };
    }
    case "UPDATE_TASK": {
      const result = validateUpdateTaskInput(input);
      return result.ok && tokenResolution.usedToken
        ? { action, input: result.data }
        : result.ok ? draftClarification("La tarea necesita una referencia confiable para actualizarse.") : null;
    }
    case "COMPLETE_TASK": {
      const result = validateCompleteTaskInput(input);
      return result.ok && tokenResolution.usedToken
        ? { action, input: result.data }
        : result.ok ? draftClarification("La tarea necesita una referencia confiable para completarse.") : null;
    }
    case "UPDATE_EVENT": {
      const result = validateUpdateEventInput(input);
      return result.ok && tokenResolution.usedToken
        ? { action, input: result.data }
        : result.ok ? draftClarification("El evento necesita una referencia confiable para actualizarse.") : null;
    }
    default:
      return null;
  }
};

const parseDraftInput = (value: unknown): unknown => {
  if (typeof value !== "string" || value.length === 0 || value.length > 6_000) return undefined;

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const SUPERVISED_FILE_DRAFT_ACTIONS = [
  "SEARCH_FILES",
  "REVEAL_FOUND_FILE",
  "OPEN_FOUND_FILE",
  "CREATE_FOLDER",
  "RENAME_FOUND_ITEM",
  "MOVE_FOUND_ITEMS",
  "ORGANIZE_FOUND_ITEMS",
  "DELETE_FOUND_ITEM"
];

const parseCandidateInput = (candidate: UnknownRecord): unknown => {
  if (SUPERVISED_FILE_DRAFT_ACTIONS.includes(candidate.action as string)) {
    if (candidate.input !== null || !isRecord(candidate.filesAction)) return undefined;
    // A null or false optional is "not given"; the closed validators then see only what was really supplied.
    return Object.fromEntries(Object.entries(candidate.filesAction).filter(([key, value]) => value !== null && !(key === "all" && value === false)));
  }
  if (candidate.action === "GET_WEATHER") {
    if (candidate.input !== null || !isRecord(candidate.weatherQuery)) return undefined;
    return Object.fromEntries(Object.entries(candidate.weatherQuery).filter(([, value]) => value !== null));
  }
  if (candidate.action === "GET_SYSTEM_INFO") {
    if (candidate.input !== null || !isRecord(candidate.systemInfo)) return undefined;
    // Passed on whole: the closed validator rejects an extra field instead of dropping it silently.
    return candidate.systemInfo;
  }
  if (candidate.action === "SET_SPOTIFY_VOLUME") {
    if (candidate.input !== null || !isRecord(candidate.spotifyControl)) return undefined;
    return Object.fromEntries(Object.entries(candidate.spotifyControl).filter(([, value]) => value !== null));
  }
  if (candidate.action === "SEARCH_SPOTIFY_APP" || candidate.action === "PLAY_SPOTIFY_MUSIC") {
    if (candidate.input !== null || !isRecord(candidate.spotifySearch)) return undefined;
    return Object.fromEntries(Object.entries(candidate.spotifySearch).filter(([, value]) => value !== null));
  }
  if (candidate.action === "REGISTER_CATALOG_APPLICATION") {
    if (candidate.input !== null || !isRecord(candidate.catalogApplication)) return undefined;
    const { catalogKey, alias } = candidate.catalogApplication;
    return { catalogKey, ...(alias === null ? {} : { alias }) };
  }
  if (["OPEN_APPROVED_PAGE", "SEARCH_APPROVED_SITE"].includes(candidate.action as string)) {
    if (candidate.input !== null || !isRecord(candidate.approvedWeb)) return undefined;
    const { site, query } = candidate.approvedWeb;
    return candidate.action === "OPEN_APPROVED_PAGE" ? { site } : { site, query };
  }

  if (
    (candidate.approvedWeb !== undefined && candidate.approvedWeb !== null)
    || (candidate.catalogApplication !== undefined && candidate.catalogApplication !== null)
    || (candidate.filesAction !== undefined && candidate.filesAction !== null)
    || (candidate.messagingAction !== undefined && candidate.messagingAction !== null)
    || (candidate.weatherQuery !== undefined && candidate.weatherQuery !== null)
    || (candidate.systemInfo !== undefined && candidate.systemInfo !== null)
    || (candidate.spotifySearch !== undefined && candidate.spotifySearch !== null)
    || (candidate.spotifyControl !== undefined && candidate.spotifyControl !== null)
  ) return undefined;
  return parseDraftInput(candidate.input);
};

/** Deferred action names carry no input; every other draft does. */
const draftInput = (draft: ActionSubmission): unknown => ("input" in draft ? draft.input : undefined);

const parseProviderOutput = async (
  raw: unknown,
  reference: AssistantInterpretationReference,
  temporalResolver: ReturnType<typeof createPlannerTemporalResolver>,
  currentContext?: ResolvedAssistantContext,
  resolveEventDeletion?: ResolveEventDeletion,
  instruction = "",
  resolveTrustedReference?: TrustedAssistantReferenceResolver,
  resolveFoundFileName?: AssistantInterpreterDependencies["resolveFoundFileName"],
  resolveFoundFolderName?: AssistantInterpreterDependencies["resolveFoundFolderName"],
  messagingDependencies: MessagingInterpretationDependencies = {},
  streamingDependencies: StreamingInterpretationDependencies = {}
): Promise<AssistantOperationResult<AssistantInterpretation>> => {
  if (typeof raw !== "string") {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (raw.length > MAX_PROVIDER_OUTPUT_LENGTH) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ["state", "summary", "responseText", "drafts", "clarifications"])) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (
    !isSafeText(parsed.summary, 500) ||
    typeof parsed.responseText !== "string" ||
    parsed.responseText.length > 400 ||
    /[\u0000-\u001f]/.test(parsed.responseText) ||
    !Array.isArray(parsed.drafts) ||
    !Array.isArray(parsed.clarifications)
  ) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (!parsed.clarifications.every((item) => isRecord(item) && hasOnlyKeys(item, ["question"]) && isSafeText(item.question, 300))) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (parsed.state === "CONVERSATIONAL") {
    return parsed.drafts.length === 0 && parsed.clarifications.length === 0 && isSafeText(parsed.responseText, 400)
      ? success({ state: "CONVERSATIONAL", summary: parsed.responseText.trim(), drafts: [], clarifications: [] })
      : rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (parsed.state === "NEEDS_CLARIFICATION") {
    return parsed.responseText.trim().length === 0 && parsed.drafts.length === 0
      ? clarification()
      : rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (parsed.state === "REJECTED") {
    return parsed.responseText.trim().length === 0 && parsed.drafts.length === 0 && parsed.clarifications.length === 0
      ? rejection(ASSISTANT_ERROR_CODES.rejected)
      : rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (
    parsed.state !== "READY" ||
    parsed.responseText.trim().length !== 0 ||
    parsed.drafts.length === 0 ||
    parsed.drafts.length > MAX_DRAFTS ||
    parsed.clarifications.length !== 0
  ) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  let trustedReference = reference;
  let trustedContext = currentContext;
  if (resolveTrustedReference) {
    try {
      const resolved = await resolveTrustedReference(
        parsed.drafts.map((draft) => isRecord(draft) && typeof draft.action === "string" ? draft.action : "")
      );
      if (!resolved) return unavailable(ASSISTANT_ERROR_CODES.ipcUnavailable);
      trustedReference = { ...reference, ...resolved.reference };
      trustedContext = resolved.currentContext;
    } catch {
      return unavailable(ASSISTANT_ERROR_CODES.ipcUnavailable);
    }
  }
  const drafts: ActionSubmission[] = [];
  for (const candidate of parsed.drafts) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["action", "input", "approvedWeb", "catalogApplication", "filesAction", "messagingAction", "weatherQuery", "systemInfo", "spotifySearch", "spotifyControl"])) {
      return rejection(ASSISTANT_ERROR_CODES.malformed);
    }
    let effective: UnknownRecord = candidate;
    if (
      candidate.action === "MOVE_FOUND_ITEMS" &&
      isRecord(candidate.filesAction) &&
      typeof candidate.filesAction.destinationName === "string"
    ) {
      const folderName = candidate.filesAction.destinationName;
      if (isUnsafeAssistantDraftText(folderName)) return rejection(ASSISTANT_ERROR_CODES.rejected);
      const folder = resolveFoundFolderName?.(folderName) ?? { state: "NONE" as const };
      if (folder.state === "AMBIGUOUS") return clarification(FOLDER_AMBIGUOUS);
      if (folder.state !== "RESOLVED") return clarification(FOLDER_UNMATCHED);
      const { destinationName: _resolved, ...rest } = candidate.filesAction;
      effective = { ...candidate, filesAction: { ...rest, destinationOrdinal: folder.ordinal } };
    }
    if (
      (candidate.action === "OPEN_FOUND_FILE" || candidate.action === "REVEAL_FOUND_FILE") &&
      isRecord(candidate.filesAction) &&
      hasOnlyKeys(candidate.filesAction, ["fileName"]) &&
      typeof candidate.filesAction.fileName === "string"
    ) {
      const fileName = candidate.filesAction.fileName;
      if (isUnsafeAssistantDraftText(fileName)) return rejection(ASSISTANT_ERROR_CODES.rejected);
      const resolution = resolveFoundFileName?.(fileName) ?? { state: "NONE" as const };
      if (resolution.state === "AMBIGUOUS") return clarification(FOUND_FILE_AMBIGUOUS);
      if (resolution.state !== "RESOLVED") return clarification(FOUND_FILE_UNMATCHED);
      effective = { ...candidate, filesAction: { ordinal: resolution.ordinal } };
    }
    const messagingDraft = isMessagingDraftAction(effective.action)
      ? await validateMessagingProviderDraft(effective, instruction, messagingDependencies)
      : undefined;
    const draft = messagingDraft !== undefined ? messagingDraft : await validateDraft(
      { action: effective.action, input: parseCandidateInput(effective) },
      trustedReference,
      temporalResolver,
      trustedContext,
      resolveEventDeletion,
      instruction
    );
    if (isDraftClarification(draft)) return clarification(draft.question);
    if (!draft) return rejection(ASSISTANT_ERROR_CODES.rejected);
    for (const providerDraft of Array.isArray(draft) ? draft : [draft]) {
      const reconciled = await reconcileSpotifyRouting(providerDraft, streamingDependencies);
      if ("clarification" in reconciled) return clarification(reconciled.clarification);
      const expandedDraft = reconciled;
      if (!drafts.some((existing) => existing.action === expandedDraft.action && JSON.stringify(draftInput(existing)) === JSON.stringify(draftInput(expandedDraft)))) {
        drafts.push(expandedDraft);
      }
    }
    if (drafts.length > MAX_DRAFTS) return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  return success({ state: "READY", summary: drafts.some((draft) => draft.action === "DELETE_EVENT")
    ? "Preparé la eliminación del evento. Revisa la propuesta: requiere confirmación explícita y no se puede deshacer."
    : READY_SUMMARY, drafts, clarifications: [] });
};

const getProviderFailureCode = (
  diagnostic: AssistantProviderFailureDiagnostic
): (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES] => {
  const { category } = diagnostic;
  if (category === "TIMEOUT") return ASSISTANT_ERROR_CODES.timeout;
  if (category === "NETWORK") return ASSISTANT_ERROR_CODES.network;
  if (category === "AUTHENTICATION") return ASSISTANT_ERROR_CODES.authentication;
  if (category === "AUTHORIZATION") return ASSISTANT_ERROR_CODES.authorization;
  if (category === "MODEL_UNAVAILABLE" || category === "MODEL_REQUEST_INCOMPATIBLE") {
    return ASSISTANT_ERROR_CODES.modelAccess;
  }
  if (category === "QUOTA") return ASSISTANT_ERROR_CODES.quota;
  if (category === "RATE_LIMIT") return ASSISTANT_ERROR_CODES.rateLimited;
  return ASSISTANT_ERROR_CODES.provider;
};

const formatProviderFailureDiagnostic = (diagnostic: AssistantProviderFailureDiagnostic): string =>
  `Assistant provider failure category [${diagnostic.category}] status [${diagnostic.status ?? "NONE"}] retryable [${diagnostic.retryable}].`;

const isDevelopmentDiagnosticEnabled = (): boolean => process.env.NODE_ENV !== "production";

/** Main-only interpreter. It validates drafts but never calls an action service or executor. */
export const createAssistantInterpreter = (dependencies: AssistantInterpreterDependencies = {}) => {
  const getConfiguration = dependencies.getConfiguration ?? getOpenAiConfiguration;
  const createProvider = dependencies.createProvider ?? createOpenAiStructuredProvider;
  const timeoutMs = dependencies.timeoutMs ?? ASSISTANT_PROVIDER_TIMEOUT_MS;
  const logError =
    dependencies.logError ??
    ((message: string) => {
      console.error(message);
    });

  const brain = dependencies.localBrain;
  const logInfo = dependencies.logInfo ?? ((line: string) => { console.info(line); });
  /** Only a closed intent name and a closed route name: never the text. */
  const logTurn = (intent: LocalIntent | "none", route: "local" | "cloud" | "local-fallback"): void => {
    try { logInfo(`local-brain intent=${intent} route=${route}`); } catch { /* diagnostics never affect the turn */ }
  };

  const reportUnavailable = (
    code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES]
  ): AssistantOperationResult<AssistantInterpretation> => {
    logError(`Assistant interpretation failed [${code}].`);
    return unavailable(code);
  };

  return {
    async interpret(
      input: unknown,
      referenceOverrides?: Partial<AssistantInterpretationReference>,
      currentContext?: ResolvedAssistantContext,
      resolveTrustedReference?: TrustedAssistantReferenceResolver
    ): Promise<AssistantOperationResult<AssistantInterpretation>> {
      if (!isRecord(input) || !hasOnlyKeys(input, ["instruction"]) || !isSafeText(input.instruction, MAX_INSTRUCTION_LENGTH)) {
        return clarification();
      }

      const normalizedInput: AssistantInterpretInput = { instruction: input.instruction.trim() };
      if (isUnsafeAssistantInstruction(normalizedInput.instruction)) {
        return rejection(ASSISTANT_ERROR_CODES.rejected);
      }
      const aliasOnlyQuestion = getAliasOnlyClarification(
        normalizedInput.instruction,
        referenceOverrides?.knownApplicationAliases
      );
      if (aliasOnlyQuestion) return clarification(aliasOnlyQuestion);
      const messagingResult = await resolveMessagingCommand(normalizedInput.instruction, {
        resolveMessagingContact: dependencies.resolveMessagingContact,
        hasActiveMessageDraft: dependencies.hasActiveMessageDraft
      });
      if (messagingResult) return messagingResult;
      const spotifyControlResult = resolveSpotifyControlCommand(normalizedInput.instruction);
      if (spotifyControlResult) return spotifyControlResult;
      const mutationResult = resolveFileMutationCommand(
        normalizedInput.instruction,
        referenceOverrides?.activeFileSearch ?? dependencies.getActiveFileSearch?.(),
        dependencies.resolveFoundFolderName
      );
      if (mutationResult) return mutationResult;
      const foundFileResult = resolveFoundFileCommand(
        normalizedInput.instruction,
        referenceOverrides?.activeFileSearch ?? dependencies.getActiveFileSearch?.(),
        referenceOverrides?.knownApplicationAliases ?? [],
        dependencies.resolveFoundFileName
      );
      if (foundFileResult) return foundFileResult;
      const streamingResult = await resolveStreamingCommand(
        normalizedInput.instruction,
        referenceOverrides?.knownApplicationAliases ?? [],
        { isSpotifyAppRegistered: dependencies.isSpotifyAppRegistered, isSpotifyConnected: dependencies.isSpotifyConnected }
      );
      if (streamingResult) return streamingResult;
      const isKeyAvailable = (): boolean => {
        try { getConfiguration(); return true; } catch { return false; }
      };
      const localContext = (): LocalContext => ({
        registeredAliases: referenceOverrides?.knownApplicationAliases ?? [],
        isKeyAvailable,
        pick: brain?.pick
      });
      /**
       * Runs a local match through the SAME parser and validators the cloud output goes through, so a draft is exactly as
       * trusted as a provider draft. Anything that does not end as a draft, an answer or a question is dropped.
       */
      const runLocal = async (match: LocalMatch): Promise<AssistantOperationResult<AssistantInterpretation> | undefined> => {
        try {
          if (match.kind === "none") return undefined;
          if (match.kind === "clarify") return clarification(match.question);
          const localReference = createReference(dependencies, referenceOverrides);
          const result = await parseProviderOutput(
            toProviderOutput(match),
            localReference,
            createPlannerTemporalResolver({ now: () => new Date(localReference.now), timeZone: () => localReference.timeZone }),
            currentContext,
            dependencies.resolveEventDeletion,
            normalizedInput.instruction,
            resolveTrustedReference,
            dependencies.resolveFoundFileName,
            dependencies.resolveFoundFolderName,
            { resolveMessagingContact: dependencies.resolveMessagingContact, hasActiveMessageDraft: dependencies.hasActiveMessageDraft },
            { isSpotifyAppRegistered: dependencies.isSpotifyAppRegistered, isSpotifyConnected: dependencies.isSpotifyConnected }
          );
          return result.ok && ["READY", "CONVERSATIONAL", "NEEDS_CLARIFICATION"].includes(result.data.state) ? result : undefined;
        } catch {
          return undefined;
        }
      };
      const matchLocally = (mode: LocalMode): LocalMatch => matchLocalIntent(normalizedInput.instruction, localContext(), mode);
      const intentOf = (match: LocalMatch): LocalIntent | "none" => (match.kind === "none" ? "none" : match.intent);

      if (brain?.localFirst) {
        const match = matchLocally("strict");
        const local = await runLocal(match);
        if (local) {
          logTurn(intentOf(match), "local");
          return local;
        }
      }

      /** The provider is missing, failed or was too slow: the local brain answers alone, or says it did not understand. */
      const failOrFallBack = async (
        code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES]
      ): Promise<AssistantOperationResult<AssistantInterpretation>> => {
        const failure = reportUnavailable(code);
        if (!brain) return failure;
        const match = matchLocally("lenient");
        const local = await runLocal(match);
        if (local) {
          logTurn(intentOf(match), "local-fallback");
          return local;
        }
        logTurn("none", "local-fallback");
        return success({ state: "CONVERSATIONAL", summary: LOCAL_MODE_NOT_UNDERSTOOD, drafts: [], clarifications: [] });
      };

      let provider: StructuredInterpretationProvider;
      try {
        provider = createProvider(getConfiguration());
      } catch {
        return failOrFallBack(ASSISTANT_ERROR_CODES.configuration);
      }

      let reference: AssistantInterpretationReference;
      try {
        reference = createReference(dependencies, referenceOverrides);
        if (Number.isNaN(Date.parse(reference.now))) {
          return reportUnavailable(ASSISTANT_ERROR_CODES.unavailable);
        }
        Intl.DateTimeFormat("en-US", { timeZone: reference.timeZone });
      } catch {
        return reportUnavailable(ASSISTANT_ERROR_CODES.unavailable);
      }
      if (brain) logTurn("none", "cloud");
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      let output: string;
      try {
        output = await provider.interpret({
          instruction: normalizedInput.instruction,
          reference,
          signal: controller.signal
        });
      } catch (error) {
        if (timedOut) return failOrFallBack(ASSISTANT_ERROR_CODES.timeout);
        const diagnostic = getAssistantProviderFailureDiagnostic(error);
        if (isDevelopmentDiagnosticEnabled()) logError(formatProviderFailureDiagnostic(diagnostic));
        return failOrFallBack(getProviderFailureCode(diagnostic));
      } finally {
        clearTimeout(timeout);
      }

      try {
        const temporalResolver = createPlannerTemporalResolver({
          now: () => new Date(reference.now),
          timeZone: () => reference.timeZone
        });
        const result = await parseProviderOutput(
          output,
          reference,
          temporalResolver,
          currentContext,
          dependencies.resolveEventDeletion,
          normalizedInput.instruction,
          resolveTrustedReference,
          dependencies.resolveFoundFileName,
          dependencies.resolveFoundFolderName,
          {
            resolveMessagingContact: dependencies.resolveMessagingContact,
            hasActiveMessageDraft: dependencies.hasActiveMessageDraft
          },
          { isSpotifyAppRegistered: dependencies.isSpotifyAppRegistered, isSpotifyConnected: dependencies.isSpotifyConnected }
        );
        if (result.ok && result.data.errorCode === ASSISTANT_ERROR_CODES.malformed) {
          logError(`Assistant interpretation failed [${ASSISTANT_ERROR_CODES.malformed}].`);
        }
        return result;
      } catch {
        logError(`Assistant interpretation response validation failed [${ASSISTANT_ERROR_CODES.malformed}].`);
        return rejection(ASSISTANT_ERROR_CODES.malformed);
      }
    }
  };
};
