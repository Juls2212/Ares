import {
  WEB_BROWSERS,
  WEB_DESTINATIONS,
  type ActionSubmission
} from "../../shared/action-contracts";
import {
  ASSISTANT_CURRENT_CONTEXT_TOKEN,
  ASSISTANT_ERROR_CODES,
  type AssistantInterpretInput,
  type AssistantInterpretation,
  type AssistantInterpretationReference,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import type { SafeFileReference } from "../../shared/file-contracts";
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
  isKnownApplicationCatalogKey,
  normalizeApplicationAlias
} from "../applications/known-application-catalog";
import { getOpenAiConfiguration, type OpenAiConfiguration } from "../config/openai-environment";
import {
  validateCreateFolderInput,
  validateFileSearchInput,
  validateMoveFileInput,
  validateOrganizeFilesInput,
  validateRenameFileInput,
  validateRenameFolderInput
} from "../files/file-validation";
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
  validateEventListInput,
  validateCreateWeeklyRoutineInput,
  validateCreateWeeklyScheduleInput,
  validateUpdateWeeklyRoutineInput,
  validateUpdateWeeklyScheduleInput
} from "../planner/planner-validation";
import { WEEKDAYS } from "../../shared/planner-contracts";
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
import { normalizeEventTitle, type ResolveEventDeletion } from "./assistant-event-reference";
import {
  getAssistantProviderFailureDiagnostic,
  type AssistantProviderFailureDiagnostic
} from "./provider-failure-category";
import type { WeeklyScheduleReferenceResolution } from "../actions/weekly-schedule-analysis";
import type { WeeklyScheduleMutationReferences } from "../actions/weekly-schedule-mutation-references";
import type { HabitMutationReferences } from "../actions/habit-mutation-references";
import { validateCreateHabitInput, validateUpdateHabitInput } from "../habits/habit-validation";
import { isEnabledAssistantAction } from "../actions/capability-registry";
import { validateApprovedWebActionInput } from "../actions/approved-web-action-executor";

const MAX_INSTRUCTION_LENGTH = 2_000;
const MAX_DRAFTS = 8;
const MAX_PROVIDER_OUTPUT_LENGTH = 16_000;
const READY_SUMMARY = "Preparé los borradores solicitados.";

type UnknownRecord = Record<string, unknown>;

export type AssistantInterpreterDependencies = {
  getConfiguration?: () => OpenAiConfiguration;
  createProvider?: (configuration: OpenAiConfiguration) => StructuredInterpretationProvider;
  now?: () => Date;
  timeZone?: () => string;
  timeoutMs?: number;
  logError?: (message: string) => void;
  resolveEventDeletion?: ResolveEventDeletion;
  resolveWeeklyScheduleTitle?: (title: string) => Promise<WeeklyScheduleReferenceResolution>;
  resolveWeeklyScheduleMutationReferences?: WeeklyScheduleMutationReferences;
  resolveHabitMutationReferences?: HabitMutationReferences;
  /** Count-only view of the last file search, supplied by Main. */
  getActiveFileSearch?: () => { resultCount: number } | undefined;
  /** Main-side matching of a spoken name against the last search; names never reach the provider. */
  resolveFoundFileName?: (name: string) => FoundFileNameResolution;
  /** Main-side matching of a spoken folder name against FOLDER entries of the last search. */
  resolveFoundFolderName?: (name: string) => FoundFileNameResolution;
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
  success({
    state: "NEEDS_CLARIFICATION",
    summary: question,
    drafts: [],
    clarifications: [{ question }]
  });

/**
 * A bare application name or alias carries no verb, so it is neither small talk nor an action.
 * This deterministic Main-side check runs before the provider and returns a fixed clarification.
 */
const getAliasOnlyClarification = (
  instruction: string,
  registeredAliases: readonly string[] | undefined
): string | undefined => {
  const normalized = normalizeApplicationAlias(instruction);
  if (normalized.length === 0) return undefined;
  const catalogEntry = KNOWN_APPLICATION_CATALOG.find((entry) =>
    [entry.defaultAlias, entry.displayName, ...entry.recognitionAliases].some(
      (alias) => normalizeApplicationAlias(alias) === normalized
    )
  );
  if (catalogEntry) return `¿Quieres que abra o que registre ${catalogEntry.displayName}?`;
  return registeredAliases?.some((alias) => normalizeApplicationAlias(alias) === normalized)
    ? "¿Quieres que abra esa aplicación registrada?"
    : undefined;
};

const FILE_NOUN = /\b(?:archivos?|carpetas?|ficheros?|documentos?|fotos?|imagenes|imagen|pdfs?)\b/u;
const NON_FILE_NOUN = /\b(?:eventos?|tareas?|recordatorios?|habitos?|horarios?|rutinas?)\b/u;

const DELETE_UNSUPPORTED_QUESTION =
  "Solo puedo enviar un elemento a la Papelera por solicitud, indicando su número. No puedo borrar varios a la vez, de forma permanente ni por ruta.";
const DELETE_NEEDS_ORDINAL = "Indica el número del resultado que quieres enviar a la Papelera, por ejemplo el tercero.";
const SELECTION_QUESTION = "Indica qué resultados, por ejemplo «todo» o el primero y el segundo.";
const DESTINATION_QUESTION = "Indica el destino: Escritorio, Documentos, Descargas, Imágenes, Música o Videos.";
const FOLDER_AMBIGUOUS = "Hay varias carpetas con ese nombre. Indica cuál por su número.";
const FOLDER_UNMATCHED = "No encontré esa carpeta entre los últimos resultados. Indica una ubicación como Documentos o busca primero la carpeta.";
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
  const normalized = normalizeApplicationAlias(instruction);
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

const FOUND_FILE_NO_SEARCH = "Primero haz una búsqueda de archivos para poder elegir un resultado.";
const FOUND_FILE_AMBIGUOUS = "Hay varios resultados con ese nombre. Indica cuál por su número, por ejemplo el segundo.";
const FOUND_FILE_UNMATCHED = "No encontré ese nombre entre los últimos resultados. Indica el número del resultado.";

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
      (alias) => normalizeApplicationAlias(alias) === name
    )
  );
  const registeredAlias = knownAliases.some((alias) => normalizeApplicationAlias(alias) === name);
  if (catalogAlias || registeredAlias) return undefined;
  const resolution = resolveFoundFileName(name);
  if (resolution.state === "RESOLVED") return readyDraft(resolution.ordinal);
  return resolution.state === "AMBIGUOUS" ? clarification(FOUND_FILE_AMBIGUOUS) : undefined;
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

const getRequestedAvailabilityTime = (instruction: string): string | undefined => {
  const explicit = instruction.match(/\b(?:después\s+de\s+las?|a\s+partir\s+de\s+las?)\s+([01]?\d|2[0-3]):([0-5]\d)\b/iu);
  if (explicit) return `${explicit[1].padStart(2, "0")}:${explicit[2]}`;
  const named = instruction.match(/\b(?:después\s+de\s+las?|a\s+partir\s+de\s+las?)\s+(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s+de\s+la\s+(mañana|tarde|noche))?\b/iu);
  if (!named) return undefined;
  const hours: Record<string, number> = { una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
  const hour = hours[named[1].toLocaleLowerCase("es-CO")];
  const period = named[2]?.toLocaleLowerCase("es-CO");
  const normalizedHour = period === "tarde" && hour < 12
    ? hour + 12
    : period === "noche" && hour < 12
      ? hour + 12
      : period === undefined && hour < 8
        ? hour + 12
        : hour;
  return `${String(normalizedHour).padStart(2, "0")}:00`;
};

const normalizeScheduleTitle = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-CO");

const INTERNAL_REFERENCE_ID = "00000000-0000-4000-8000-000000000001";
const isMentioned = (instruction: string, value: string): boolean =>
  normalizeScheduleTitle(instruction).includes(normalizeScheduleTitle(value));

const explicitlyRequestsRemoval = (instruction: string): boolean =>
  /\b(?:quita|quitar|elimina|eliminar|borra|borrar|sin)\b/iu.test(instruction);

const isLocalTime = (value: unknown): value is string =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Accepts only an explicitly supplied local clock value and returns strict HH:mm. */
const normalizeWeeklyLocalTime = (value: unknown): string | undefined => {
  if (isLocalTime(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^([0-9]|1\d|2[0-3])(?::([0-5]\d))?$/u);
  if (!match) return undefined;
  return `${match[1].padStart(2, "0")}:${match[2] ?? "00"}`;
};

const isWeekday = (value: unknown): value is (typeof WEEKDAYS)[number] =>
  typeof value === "string" && WEEKDAYS.includes(value as (typeof WEEKDAYS)[number]);

const spanishWeekdayValues: Record<string, (typeof WEEKDAYS)[number]> = {
  lunes: "MONDAY",
  martes: "TUESDAY",
  miercoles: "WEDNESDAY",
  jueves: "THURSDAY",
  viernes: "FRIDAY",
  sabado: "SATURDAY",
  domingo: "SUNDAY"
};

const normalizeWeekday = (value: unknown): (typeof WEEKDAYS)[number] | undefined => {
  if (isWeekday(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-CO");
  return spanishWeekdayValues[normalized];
};

const getExplicitWeekdays = (instruction: string): Array<(typeof WEEKDAYS)[number]> => {
  const normalizedInstruction = instruction
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO");
  return WEEKDAYS.filter((weekday) => {
    const spanishName = Object.entries(spanishWeekdayValues).find(([, value]) => value === weekday)?.[0];
    return spanishName !== undefined && new RegExp(`\\b${spanishName}\\b`, "u").test(normalizedInstruction);
  });
};

const getProviderWeekdays = (input: UnknownRecord): Array<(typeof WEEKDAYS)[number]> | undefined => {
  const value = input.weekdays ?? input.weekday;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > WEEKDAYS.length) return undefined;
  const weekdays = values.map(normalizeWeekday);
  if (weekdays.some((weekday) => weekday === undefined)) return undefined;
  const resolved = weekdays as Array<(typeof WEEKDAYS)[number]>;
  return new Set(resolved).size === resolved.length ? resolved : undefined;
};

const weeklyReferenceClarification = (
  state: "MISSING" | "AMBIGUOUS" | "UNAVAILABLE",
  kind: "schedule" | "routine" | "category"
): DraftClarification => {
  const messages = {
    schedule: state === "MISSING" ? "No encontré ese horario. Indica el nombre exacto de uno existente." : state === "AMBIGUOUS" ? "Encontré varios horarios con ese nombre. Indica uno más específico." : "No se pudieron consultar los horarios. Inténtalo de nuevo.",
    routine: state === "MISSING" ? "No encontré ese bloque semanal." : state === "AMBIGUOUS" ? "Encontré varios bloques que coinciden. Indica el día u horario exacto." : "No se pudieron consultar los bloques semanales. Inténtalo de nuevo.",
    category: state === "MISSING" ? "No encontré esa categoría." : state === "AMBIGUOUS" ? "Encontré varias categorías con ese nombre. Indica una más específica." : "No se pudieron consultar las categorías. Inténtalo de nuevo."
  } as const;
  return draftClarification(messages[kind]);
};

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
  ...(overrides?.knownWeeklyScheduleTitles ? { knownWeeklyScheduleTitles: overrides.knownWeeklyScheduleTitles } : {}),
  ...(overrides?.knownFileReferences ? { knownFileReferences: overrides.knownFileReferences } : {}),
  ...(overrides?.currentContext ? { currentContext: overrides.currentContext } : {})
});

const hasKnownReference = (
  reference: SafeFileReference,
  knownReferences: readonly SafeFileReference[] | undefined
): boolean =>
  !!knownReferences?.some(
    (known) =>
      known.rootId === reference.rootId &&
      known.relativePath.localeCompare(reference.relativePath, undefined, { sensitivity: "accent" }) === 0
  );

const fileReferencesAreKnown = (
  action: string,
  input: UnknownRecord,
  knownReferences: readonly SafeFileReference[] | undefined
): boolean => {
  const references: unknown[] = [];
  if (action === "CREATE_FOLDER") references.push(input.parentDirectory);
  if (action === "RENAME_FILE" || action === "RENAME_FOLDER") references.push(input.source);
  if (action === "MOVE_FILE") references.push(input.source, input.destinationDirectory);
  if (action === "ORGANIZE_FILES") references.push(input.folder, ...(Array.isArray(input.exclusions) ? input.exclusions : []));
  if (action === "SEARCH_FILES" && input.relativePath !== undefined) {
    references.push({ rootId: input.rootId, relativePath: input.relativePath });
  }
  return references.every((candidate) => {
    if (!isRecord(candidate) || typeof candidate.rootId !== "string" || typeof candidate.relativePath !== "string") {
      return false;
    }
    return hasKnownReference(
      { rootId: candidate.rootId as SafeFileReference["rootId"], relativePath: candidate.relativePath },
      knownReferences
    );
  });
};

const hasUnsafeFileDraftText = (input: UnknownRecord): boolean =>
  [input.query, input.name, input.newName].some((value) => isUnsafeAssistantDraftText(value));

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
  if (!context) return draftClarification("Necesito una selección actual válida para esa acción.");
  const selection = context.selection;
  const replace = (key: string, kind: string, replacement: unknown): ContextTokenResolution =>
    value[key] === ASSISTANT_CURRENT_CONTEXT_TOKEN && context.providerContext.kind === kind
      ? { input: { ...value, [key]: replacement }, usedToken: true }
      : draftClarification("La selección actual no corresponde a esa acción.");
  if (action === "UPDATE_TASK" || action === "COMPLETE_TASK") {
    return selection.section === "PLANNER" ? replace("taskId", "TASK", selection.id) : draftClarification("Selecciona una tarea válida primero.");
  }
  if (action === "UPDATE_EVENT" || action === "DELETE_EVENT") {
    return selection.section === "PLANNER" ? replace("eventId", "EVENT", selection.id) : draftClarification("Selecciona un evento válido primero.");
  }
  if (action === "CREATE_REMINDER") {
    if (selection.section !== "PLANNER") return draftClarification("Selecciona una tarea o evento válida primero.");
    if (value.taskId === ASSISTANT_CURRENT_CONTEXT_TOKEN && selection.kind === "TASK") return { input: { ...value, taskId: selection.id }, usedToken: true };
    if (value.eventId === ASSISTANT_CURRENT_CONTEXT_TOKEN && selection.kind === "EVENT") return { input: { ...value, eventId: selection.id }, usedToken: true };
    return draftClarification("La selección actual no corresponde al recordatorio.");
  }
  if (action === "OPEN_APPLICATION") {
    return selection.section === "APPLICATIONS" ? replace("alias", "APPLICATION", selection.alias) : draftClarification("Selecciona una aplicación registrada válida primero.");
  }
  if (action === "CREATE_FOLDER") return selection.section === "FILES" ? replace("parentDirectory", "FOLDER", selection.reference) : draftClarification("Selecciona una carpeta válida primero.");
  if (action === "RENAME_FILE") return selection.section === "FILES" ? replace("source", "FILE", selection.reference) : draftClarification("Selecciona un archivo válido primero.");
  if (action === "RENAME_FOLDER" || action === "ORGANIZE_FILES") return selection.section === "FILES" ? replace(action === "ORGANIZE_FILES" ? "folder" : "source", "FOLDER", selection.reference) : draftClarification("Selecciona una carpeta válida primero.");
  if (action === "MOVE_FILE") {
    if (selection.section !== "FILES") return draftClarification("Selecciona un archivo o carpeta válida primero.");
    if (value.source === ASSISTANT_CURRENT_CONTEXT_TOKEN && selection.kind === "FILE") return { input: { ...value, source: selection.reference }, usedToken: true };
    if (value.destinationDirectory === ASSISTANT_CURRENT_CONTEXT_TOKEN && selection.kind === "FOLDER") return { input: { ...value, destinationDirectory: selection.reference }, usedToken: true };
    return draftClarification("La selección actual no corresponde al movimiento.");
  }
  if (action === "SEARCH_FILES") {
    if (selection.section === "FILES" && selection.kind === "FOLDER" && value.relativePath === ASSISTANT_CURRENT_CONTEXT_TOKEN) {
      return { input: { ...value, rootId: selection.reference.rootId, relativePath: selection.reference.relativePath }, usedToken: true };
    }
    return draftClarification("Selecciona una carpeta válida primero.");
  }
  return draftClarification("La selección actual no puede usarse para esa acción.");
};

const plannerClarification = (
  action: PlannerTemporalAction,
  reason?: PlannerTemporalResolutionReason
): DraftClarification => {
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
  resolveWeeklyScheduleTitle?: (title: string) => Promise<WeeklyScheduleReferenceResolution>,
  resolveWeeklyScheduleMutationReferences?: WeeklyScheduleMutationReferences,
  resolveHabitMutationReferences?: HabitMutationReferences,
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
      if (!normalizeEventTitle(instruction).includes(normalizeEventTitle(input.eventTitle))) return null;
      const range = validateEventListInput(input.startAt === undefined ? {} : { startAt: input.startAt });
      if (!range.ok) return draftClarification("Indica la fecha y hora exactas del evento para distinguirlo.");
      if (range.data.startAt && !instruction.includes(range.data.startAt)) {
        return draftClarification("Indica la fecha y hora exactas con zona horaria o selecciona el evento. No puedo suponer cuál quieres eliminar.");
      }
      if (!resolveEventDeletion) return draftClarification("Selecciona un evento válido o indica su título exacto. Su eliminación requiere confirmación.");
      const resolution = await resolveEventDeletion({ title: input.eventTitle.trim(), ...range.data });
      if (resolution.state === "AMBIGUOUS") return draftClarification("Hay varios eventos con ese título. Indica su fecha y hora exactas o selecciona uno en el contexto.");
      if (resolution.state === "MISSING") return draftClarification("No encontré ese evento. Indica su título exacto o selecciona un evento existente.");
      if (resolution.state !== "RESOLVED") return draftClarification("No se pudieron consultar los eventos. Inténtalo de nuevo antes de solicitar la eliminación.");
      const validated = validateDeleteEventInput({ eventId: resolution.eventId });
      return validated.ok ? { action, input: validated.data } : null;
    }
    case "CREATE_TASK": {
      const temporal = temporalResolver.resolve(action as PlannerTemporalAction, input);
      if (!temporal.ok) return plannerClarification(action, temporal.reason);
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
      if (!temporal.ok) return plannerClarification(action, temporal.reason);
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
      if (!temporal.ok) return plannerClarification(action, temporal.reason);
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
      const result = validateGetTodayScheduleInput(input);
      return result.ok ? { action, input: result.data } : null;
    }
    case "GET_WEEK_SCHEDULE": {
      const result = validateGetWeekScheduleInput(input);
      return result.ok ? { action, input: result.data } : null;
    }
    case "GET_CURRENT_DATE_TIME": {
      return isRecord(input) && hasOnlyKeys(input, []) ? { action, input: {} } : null;
    }
    case "GET_WEATHER": {
      return isRecord(input) && hasOnlyKeys(input, []) ? { action, input: {} } : null;
    }
    case "GET_WEEKLY_SCHEDULE_DETAILS": {
      if (!isRecord(input)) return null;
      if (input.allSchedules === true && hasOnlyKeys(input, ["allSchedules"])) {
        return /\b(todos|todas)\s+(mis\s+)?horarios\b/iu.test(instruction) ? { action, input: { allSchedules: true } } : draftClarification("Indica cuál de tus horarios quieres consultar.");
      }
      if (!hasOnlyKeys(input, ["scheduleTitle"]) || !isSafeText(input.scheduleTitle, 160) || !resolveWeeklyScheduleTitle) return draftClarification("¿Cuál de tus horarios quieres consultar?");
      const resolution = await resolveWeeklyScheduleTitle(input.scheduleTitle);
      if (resolution.state === "MISSING") return draftClarification("No encontré ese horario. Indica el nombre exacto de uno de tus horarios.");
      if (resolution.state === "AMBIGUOUS") return draftClarification("Encontré varios horarios con ese nombre. Indica un nombre más específico.");
      if (resolution.state !== "RESOLVED") return draftClarification("No se pudieron consultar los horarios. Inténtalo de nuevo.");
      if (!normalizeScheduleTitle(instruction).includes(normalizeScheduleTitle(resolution.title))) {
        return draftClarification("¿Cuál de tus horarios quieres consultar?");
      }
      return { action, input: { scheduleTitle: resolution.title } };
    }
    case "ANALYZE_WEEKLY_SCHEDULE": {
      if (!isRecord(input) || typeof input.analysis !== "string" || !["AVAILABILITY", "BUSIEST_DAY", "OVERLAPS"].includes(input.analysis)) return null;
      const referenceInput = { ...input }; delete referenceInput.analysis;
      const detail = await validateDraft(
        { action: "GET_WEEKLY_SCHEDULE_DETAILS", input: referenceInput },
        reference,
        temporalResolver,
        currentContext,
        resolveEventDeletion,
        resolveWeeklyScheduleTitle,
        resolveWeeklyScheduleMutationReferences,
        resolveHabitMutationReferences,
        instruction
      );
      if (!detail || Array.isArray(detail) || isDraftClarification(detail) || detail.action !== "GET_WEEKLY_SCHEDULE_DETAILS") return detail;
      return { action, input: { ...detail.input, analysis: input.analysis as "AVAILABILITY" | "BUSIEST_DAY" | "OVERLAPS" } };
    }
    case "GET_TODAY_AVAILABILITY": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["afterTime"])) return null;
      const requestedTime = getRequestedAvailabilityTime(instruction);
      if (input.afterTime === undefined) return requestedTime === undefined ? { action, input: {} } : draftClarification("Indica la hora desde la que quieres consultar la disponibilidad de hoy.");
      if (typeof input.afterTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.afterTime)) return null;
      if (requestedTime !== input.afterTime) return draftClarification("Indica una hora válida para consultar la disponibilidad de hoy.");
      return { action, input: { afterTime: input.afterTime } };
    }
    case "GET_HABIT_PROGRESS": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["scope", "habitTitle"]) || (input.scope !== "TODAY" && input.scope !== "WEEK")) {
        return draftClarification("Indica si quieres consultar el progreso de hoy o de esta semana.");
      }
      if (input.habitTitle === undefined) return { action, input: { scope: input.scope } };
      if (!isSafeText(input.habitTitle, 240) || !resolveHabitMutationReferences || !isMentioned(instruction, input.habitTitle)) {
        return draftClarification("Indica el nombre exacto del hábito que quieres consultar.");
      }
      const habit = await resolveHabitMutationReferences.resolveHabit(input.habitTitle);
      if (habit.state === "MISSING") return draftClarification("No encontré ese hábito activo. Indica su nombre exacto.");
      if (habit.state === "AMBIGUOUS") return draftClarification("Encontré varios hábitos con ese nombre. Indica uno más específico.");
      if (habit.state !== "RESOLVED") return draftClarification("No se pudieron consultar los hábitos. Inténtalo de nuevo.");
      return { action, input: { scope: input.scope, habitTitle: habit.habit.title } };
    }
    case "CREATE_HABIT": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["title", "description", "frequency", "targetCount", "categoryName", "icon"]) || !resolveHabitMutationReferences) {
        return draftClarification("Indica el título y la frecuencia del hábito que quieres crear.");
      }
      const { categoryName, ...habitInput } = input;
      const validated = validateCreateHabitInput(habitInput);
      if (!validated.ok || !isMentioned(instruction, validated.data.title) || (validated.data.description && !isMentioned(instruction, validated.data.description))) {
        return draftClarification("Indica un título, una frecuencia y una meta válidos para el hábito.");
      }
      if (categoryName !== undefined && (!isSafeText(categoryName, 160) || !isMentioned(instruction, categoryName))) {
        return draftClarification("Indica una categoría válida para el hábito.");
      }
      if (categoryName !== undefined) {
        const category = await resolveHabitMutationReferences.resolveCategory(categoryName);
        if (category.state === "MISSING") return draftClarification("No encontré esa categoría.");
        if (category.state === "AMBIGUOUS") return draftClarification("Encontré varias categorías con ese nombre. Indica una más específica.");
        if (category.state !== "RESOLVED") return draftClarification("No se pudieron consultar las categorías.");
      }
      return { action, input: { ...validated.data, ...(typeof categoryName === "string" ? { categoryName } : {}) } };
    }
    case "UPDATE_HABIT": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["habitTitle", "title", "description", "frequency", "targetCount", "categoryName", "icon"]) || !isSafeText(input.habitTitle, 240) || !resolveHabitMutationReferences) {
        return draftClarification("Indica qué hábito quieres actualizar y los cambios que deseas aplicar.");
      }
      const { habitTitle, categoryName, ...changes } = input;
      const validated = validateUpdateHabitInput({ habitId: INTERNAL_REFERENCE_ID, ...changes });
      if (!validated.ok || !isMentioned(instruction, habitTitle) || (validated.data.title && !isMentioned(instruction, validated.data.title)) || (typeof validated.data.description === "string" && !isMentioned(instruction, validated.data.description))) {
        return draftClarification("Indica el hábito y los cambios válidos que quieres aplicar.");
      }
      const habit = await resolveHabitMutationReferences.resolveHabit(habitTitle);
      if (habit.state === "MISSING") return draftClarification("No encontré ese hábito activo. Indica su nombre exacto.");
      if (habit.state === "AMBIGUOUS") return draftClarification("Encontré varios hábitos con ese nombre. Indica uno más específico.");
      if (habit.state !== "RESOLVED") return draftClarification("No se pudieron consultar los hábitos.");
      if (categoryName !== undefined && categoryName !== null) {
        if (!isSafeText(categoryName, 160) || !isMentioned(instruction, categoryName)) return draftClarification("Indica una categoría válida para el hábito.");
        const category = await resolveHabitMutationReferences.resolveCategory(categoryName);
        if (category.state !== "RESOLVED") return draftClarification(category.state === "AMBIGUOUS" ? "Encontré varias categorías con ese nombre. Indica una más específica." : "No encontré esa categoría.");
      }
      const { habitId: _habitId, ...validatedChanges } = validated.data;
      return { action, input: { habitTitle: habit.habit.title, ...validatedChanges, ...(categoryName !== undefined ? { categoryName } : {}) } };
    }
    case "COMPLETE_HABIT": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["habitTitle"]) || !isSafeText(input.habitTitle, 240) || !resolveHabitMutationReferences || !isMentioned(instruction, input.habitTitle)) {
        return draftClarification("Indica el nombre exacto del hábito que quieres completar.");
      }
      const habit = await resolveHabitMutationReferences.resolveHabit(input.habitTitle);
      if (habit.state === "MISSING") return draftClarification("No encontré ese hábito activo. Indica su nombre exacto.");
      if (habit.state === "AMBIGUOUS") return draftClarification("Encontré varios hábitos con ese nombre. Indica uno más específico.");
      if (habit.state !== "RESOLVED") return draftClarification("No se pudieron consultar los hábitos.");
      return { action, input: { habitTitle: habit.habit.title } };
    }
    case "CREATE_WEEKLY_SCHEDULE": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["title", "description", "color"])) return null;
      const validated = validateCreateWeeklyScheduleInput(input);
      if (!validated.ok || !isMentioned(instruction, validated.data.title) || (validated.data.description && !isMentioned(instruction, validated.data.description)) || (validated.data.color && !instruction.includes(validated.data.color))) {
        return draftClarification("Indica el nombre del horario y solo los cambios que quieres aplicar.");
      }
      if (!resolveWeeklyScheduleMutationReferences) return draftClarification("No se pudieron consultar los horarios. Inténtalo de nuevo.");
      const existing = await resolveWeeklyScheduleMutationReferences.resolveSchedule(validated.data.title);
      if (existing.state === "RESOLVED") return draftClarification("Ya existe un horario con ese nombre. Indica otro nombre.");
      if (existing.state === "UNAVAILABLE") return weeklyReferenceClarification(existing.state, "schedule");
      return { action, input: validated.data };
    }
    case "UPDATE_WEEKLY_SCHEDULE": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["scheduleTitle", "title", "description", "color"]) || !isSafeText(input.scheduleTitle, 240) || !resolveWeeklyScheduleMutationReferences) return draftClarification("Indica qué horario quieres actualizar.");
      const { scheduleTitle, ...changes } = input;
      const validated = validateUpdateWeeklyScheduleInput({ weeklyScheduleId: INTERNAL_REFERENCE_ID, ...changes });
      if (!validated.ok || !isMentioned(instruction, scheduleTitle) || (validated.data.title && !isMentioned(instruction, validated.data.title)) || (typeof validated.data.description === "string" && !isMentioned(instruction, validated.data.description)) || (typeof validated.data.color === "string" && !instruction.includes(validated.data.color)) || ((validated.data.description === null || validated.data.color === null) && !explicitlyRequestsRemoval(instruction))) return draftClarification("Indica el horario y los cambios que quieres aplicar.");
      const schedule = await resolveWeeklyScheduleMutationReferences.resolveSchedule(scheduleTitle);
      if (schedule.state !== "RESOLVED") return weeklyReferenceClarification(schedule.state, "schedule");
      const { weeklyScheduleId: _weeklyScheduleId, ...validatedChanges } = validated.data;
      return { action, input: { scheduleTitle: schedule.schedule.title, ...validatedChanges } };
    }
    case "CREATE_WEEKLY_ROUTINE": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["scheduleTitle", "title", "weekday", "weekdays", "startTime", "endTime", "location", "categoryName"]) || !isSafeText(input.scheduleTitle, 240) || !resolveWeeklyScheduleMutationReferences) return draftClarification("Indica el horario, bloque, día y horas que quieres agregar.");
      const providerWeekdays = getProviderWeekdays(input);
      const explicitWeekdays = getExplicitWeekdays(instruction);
      if (!providerWeekdays || explicitWeekdays.length === 0 || providerWeekdays.some((weekday) => !explicitWeekdays.includes(weekday))) return draftClarification("Indica uno o más días válidos para el bloque semanal.");
      const { scheduleTitle, categoryName, weekday: _weekday, weekdays: _weekdays, ...routine } = input;
      const startTime = normalizeWeeklyLocalTime(routine.startTime);
      const endTime = normalizeWeeklyLocalTime(routine.endTime);
      if (!startTime || !endTime) return draftClarification("Indica las horas de inicio y final del bloque semanal.");
      const validated = validateCreateWeeklyRoutineInput({ ...routine, weekday: explicitWeekdays[0], startTime, endTime, weeklyScheduleId: INTERNAL_REFERENCE_ID });
      if (!validated.ok || !isMentioned(instruction, scheduleTitle) || !isMentioned(instruction, validated.data.title) || (validated.data.location && !isMentioned(instruction, validated.data.location)) || (categoryName !== undefined && (!isSafeText(categoryName, 160) || !isMentioned(instruction, categoryName)))) return draftClarification("Indica el horario, bloque, día y horas válidos que quieres agregar.");
      const schedule = await resolveWeeklyScheduleMutationReferences.resolveSchedule(scheduleTitle);
      if (schedule.state !== "RESOLVED") return weeklyReferenceClarification(schedule.state, "schedule");
      if (categoryName !== undefined) {
        const category = await resolveWeeklyScheduleMutationReferences.resolveCategory(categoryName);
        if (category.state !== "RESOLVED") return weeklyReferenceClarification(category.state, "category");
      }
      return explicitWeekdays.map((weekday) => ({
        action,
        input: {
          scheduleTitle: schedule.schedule.title,
          title: validated.data.title,
          weekday,
          startTime: validated.data.startTime,
          endTime: validated.data.endTime,
          ...(validated.data.location === undefined ? {} : { location: validated.data.location }),
          ...(typeof categoryName === "string" ? { categoryName } : {})
        }
      }));
    }
    case "UPDATE_WEEKLY_ROUTINE": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["scheduleTitle", "routineTitle", "targetWeekday", "targetStartTime", "targetEndTime", "title", "weekday", "startTime", "endTime", "location", "categoryName"]) || !isSafeText(input.scheduleTitle, 240) || !isSafeText(input.routineTitle, 240) || !resolveWeeklyScheduleMutationReferences) return draftClarification("Indica el bloque semanal que quieres actualizar.");
      const { scheduleTitle, routineTitle, targetWeekday, targetStartTime, targetEndTime, categoryName, ...changes } = input;
      const validated = validateUpdateWeeklyRoutineInput({ routineId: INTERNAL_REFERENCE_ID, weeklyScheduleId: INTERNAL_REFERENCE_ID, ...changes });
      if (!validated.ok || !isMentioned(instruction, scheduleTitle) || !isMentioned(instruction, routineTitle) || (validated.data.title && !isMentioned(instruction, validated.data.title)) || (typeof validated.data.location === "string" && !isMentioned(instruction, validated.data.location)) || (validated.data.location === null && !explicitlyRequestsRemoval(instruction)) || (categoryName !== undefined && (!isSafeText(categoryName, 160) || !isMentioned(instruction, categoryName)))) return draftClarification("Indica el bloque y los cambios válidos que quieres aplicar.");
      const trustedTargetWeekday = isWeekday(targetWeekday) ? targetWeekday : undefined;
      const trustedTargetStartTime = isLocalTime(targetStartTime) ? targetStartTime : undefined;
      const trustedTargetEndTime = isLocalTime(targetEndTime) ? targetEndTime : undefined;
      if ((targetWeekday !== undefined && trustedTargetWeekday === undefined) || (targetStartTime !== undefined && trustedTargetStartTime === undefined) || (targetEndTime !== undefined && trustedTargetEndTime === undefined)) return draftClarification("Indica una referencia de día y hora válida para el bloque.");
      const schedule = await resolveWeeklyScheduleMutationReferences.resolveSchedule(scheduleTitle);
      if (schedule.state !== "RESOLVED") return weeklyReferenceClarification(schedule.state, "schedule");
      const routine = await resolveWeeklyScheduleMutationReferences.resolveRoutine({ scheduleTitle: schedule.schedule.title, routineTitle, ...(trustedTargetWeekday === undefined ? {} : { weekday: trustedTargetWeekday }), ...(trustedTargetStartTime === undefined ? {} : { startTime: trustedTargetStartTime }), ...(trustedTargetEndTime === undefined ? {} : { endTime: trustedTargetEndTime }) });
      if (routine.state !== "RESOLVED") return weeklyReferenceClarification(routine.state, "routine");
      if (categoryName !== undefined) {
        const category = await resolveWeeklyScheduleMutationReferences.resolveCategory(categoryName);
        if (category.state !== "RESOLVED") return weeklyReferenceClarification(category.state, "category");
      }
      const { routineId: _routineId, weeklyScheduleId: _weeklyScheduleId, ...validatedChanges } = validated.data;
      return {
        action,
        input: {
          scheduleTitle: schedule.schedule.title,
          routineTitle: routine.routine.title,
          ...(trustedTargetWeekday === undefined ? {} : { targetWeekday: trustedTargetWeekday }),
          ...(trustedTargetStartTime === undefined ? {} : { targetStartTime: trustedTargetStartTime }),
          ...(trustedTargetEndTime === undefined ? {} : { targetEndTime: trustedTargetEndTime }),
          ...validatedChanges,
          ...(typeof categoryName === "string" ? { categoryName } : {})
        }
      };
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
        : draftClarification("Primero debes registrar esa aplicación para poder abrirla.");
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
    case "OPEN_WEB_PAGE": {
      if (!isRecord(input) || !hasOnlyKeys(input, ["destination", "browser"])) return null;
      if (
        typeof input.destination !== "string" ||
        typeof input.browser !== "string" ||
        !WEB_DESTINATIONS.includes(input.destination as (typeof WEB_DESTINATIONS)[number]) ||
        !WEB_BROWSERS.includes(input.browser as (typeof WEB_BROWSERS)[number])
      ) {
        return null;
      }
      const hasRegisteredChrome = reference.knownApplicationAliases?.some(
        (alias) => alias.trim().toLocaleLowerCase("en-US") === "chrome"
      );
      if (!hasRegisteredChrome) {
        return draftClarification("Google Chrome necesita estar registrado y habilitado.");
      }
      return { action, input: { destination: "YOUTUBE", browser: "CHROME" } };
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
    case "RENAME_FILE": {
      const result = validateRenameFileInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      return tokenResolution.usedToken || fileReferencesAreKnown(action, input, reference.knownFileReferences)
        ? { action, input: result.data }
        : null;
    }
    case "RENAME_FOLDER": {
      const result = validateRenameFolderInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      return tokenResolution.usedToken || fileReferencesAreKnown(action, input, reference.knownFileReferences)
        ? { action, input: result.data }
        : null;
    }
    case "MOVE_FILE": {
      const result = validateMoveFileInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      return fileReferencesAreKnown(action, input, reference.knownFileReferences)
        ? { action, input: result.data }
        : null;
    }
    case "ORGANIZE_FILES": {
      const result = validateOrganizeFilesInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      return tokenResolution.usedToken && (result.data.exclusions?.length ?? 0) === 0
        ? { action, input: result.data }
        : fileReferencesAreKnown(action, input, reference.knownFileReferences)
        ? { action, input: result.data }
        : null;
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
  if (candidate.action === "REGISTER_CATALOG_APPLICATION") {
    if (candidate.input !== null || !isRecord(candidate.catalogApplication)) return undefined;
    const { catalogKey, alias } = candidate.catalogApplication;
    return { catalogKey, ...(alias === null ? {} : { alias }) };
  }
  if (candidate.action === "CREATE_WEEKLY_ROUTINE") {
    if (candidate.input !== null || !isRecord(candidate.weeklyRoutine)) return undefined;
    const { location, categoryName, ...weeklyRoutine } = candidate.weeklyRoutine;
    return {
      ...weeklyRoutine,
      ...(location == null ? {} : { location }),
      ...(categoryName == null ? {} : { categoryName })
    };
  }

  if (["GET_HABIT_PROGRESS", "CREATE_HABIT", "UPDATE_HABIT", "COMPLETE_HABIT"].includes(candidate.action as string)) {
    if (candidate.input !== null || !isRecord(candidate.habitAction)) return undefined;
    const { habitTitle, title, description, frequency, targetCount, categoryName, icon, scope } = candidate.habitAction;
    if (candidate.action === "GET_HABIT_PROGRESS") {
      return { ...(scope === null ? {} : { scope }), ...(habitTitle === null ? {} : { habitTitle }) };
    }
    if (candidate.action === "CREATE_HABIT") {
      return {
        ...(title === null ? {} : { title }),
        ...(description === null ? {} : { description }),
        ...(frequency === null ? {} : { frequency }),
        ...(targetCount === null ? {} : { targetCount }),
        ...(categoryName === null ? {} : { categoryName }),
        ...(icon === null ? {} : { icon })
      };
    }
    if (candidate.action === "UPDATE_HABIT") {
      return {
        ...(habitTitle === null ? {} : { habitTitle }),
        ...(title === null ? {} : { title }),
        ...(description === null ? {} : { description }),
        ...(frequency === null ? {} : { frequency }),
        ...(targetCount === null ? {} : { targetCount }),
        ...(categoryName === null ? {} : { categoryName }),
        ...(icon === null ? {} : { icon })
      };
    }
    return { ...(habitTitle === null ? {} : { habitTitle }) };
  }

  if (["OPEN_APPROVED_PAGE", "SEARCH_APPROVED_SITE"].includes(candidate.action as string)) {
    if (candidate.input !== null || !isRecord(candidate.approvedWeb)) return undefined;
    const { site, query } = candidate.approvedWeb;
    return candidate.action === "OPEN_APPROVED_PAGE" ? { site } : { site, query };
  }

  if (
    (candidate.weeklyRoutine !== undefined && candidate.weeklyRoutine !== null) ||
    (candidate.habitAction !== undefined && candidate.habitAction !== null) ||
    (candidate.approvedWeb !== undefined && candidate.approvedWeb !== null)
    || (candidate.catalogApplication !== undefined && candidate.catalogApplication !== null)
    || (candidate.filesAction !== undefined && candidate.filesAction !== null)
  ) return undefined;
  return parseDraftInput(candidate.input);
};

const parseProviderOutput = async (
  raw: unknown,
  reference: AssistantInterpretationReference,
  temporalResolver: ReturnType<typeof createPlannerTemporalResolver>,
  currentContext?: ResolvedAssistantContext,
  resolveEventDeletion?: ResolveEventDeletion,
  resolveWeeklyScheduleTitle?: (title: string) => Promise<WeeklyScheduleReferenceResolution>,
  resolveWeeklyScheduleMutationReferences?: WeeklyScheduleMutationReferences,
  resolveHabitMutationReferences?: HabitMutationReferences,
  instruction = "",
  resolveTrustedReference?: TrustedAssistantReferenceResolver,
  resolveFoundFileName?: AssistantInterpreterDependencies["resolveFoundFileName"],
  resolveFoundFolderName?: AssistantInterpreterDependencies["resolveFoundFolderName"]
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
  for (const [index, candidate] of parsed.drafts.entries()) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["action", "input", "weeklyRoutine", "habitAction", "approvedWeb", "catalogApplication", "filesAction"])) {
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
      if (folder.state === "AMBIGUOUS") return clarification(`El borrador ${index + 1}: ${FOLDER_AMBIGUOUS}`);
      if (folder.state !== "RESOLVED") return clarification(`El borrador ${index + 1}: ${FOLDER_UNMATCHED}`);
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
      if (resolution.state === "AMBIGUOUS") return clarification(`El borrador ${index + 1}: ${FOUND_FILE_AMBIGUOUS}`);
      if (resolution.state !== "RESOLVED") return clarification(`El borrador ${index + 1}: ${FOUND_FILE_UNMATCHED}`);
      effective = { ...candidate, filesAction: { ordinal: resolution.ordinal } };
    }
    const draft = await validateDraft(
      { action: effective.action, input: parseCandidateInput(effective) },
      trustedReference,
      temporalResolver,
      trustedContext,
      resolveEventDeletion,
      resolveWeeklyScheduleTitle,
      resolveWeeklyScheduleMutationReferences,
      resolveHabitMutationReferences,
      instruction
    );
    if (isDraftClarification(draft)) return clarification(`El borrador ${index + 1}: ${draft.question}`);
    if (!draft) return rejection(ASSISTANT_ERROR_CODES.rejected);
    for (const expandedDraft of Array.isArray(draft) ? draft : [draft]) {
      if (!drafts.some((existing) => existing.action === expandedDraft.action && JSON.stringify(existing.input) === JSON.stringify(expandedDraft.input))) {
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
      let provider: StructuredInterpretationProvider;
      try {
        provider = createProvider(getConfiguration());
      } catch {
        return reportUnavailable(ASSISTANT_ERROR_CODES.configuration);
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
        if (timedOut) return reportUnavailable(ASSISTANT_ERROR_CODES.timeout);
        const diagnostic = getAssistantProviderFailureDiagnostic(error);
        if (isDevelopmentDiagnosticEnabled()) logError(formatProviderFailureDiagnostic(diagnostic));
        return reportUnavailable(getProviderFailureCode(diagnostic));
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
          dependencies.resolveWeeklyScheduleTitle,
          dependencies.resolveWeeklyScheduleMutationReferences,
          dependencies.resolveHabitMutationReferences,
          normalizedInput.instruction,
          resolveTrustedReference,
          dependencies.resolveFoundFileName,
          dependencies.resolveFoundFolderName
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
