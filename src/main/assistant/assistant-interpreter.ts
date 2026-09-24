import {
  WEB_BROWSERS,
  WEB_DESTINATIONS,
  type ActionSubmission
} from "../../shared/action-contracts";
import {
  ASSISTANT_ERROR_CODES,
  type AssistantInterpretInput,
  type AssistantInterpretation,
  type AssistantInterpretationReference,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import type { SafeFileReference } from "../../shared/file-contracts";
import { validateApplicationAlias } from "../applications/application-validation";
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
  validateUpdateTaskInput
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
};

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
    case ASSISTANT_ERROR_CODES.modelAccess:
      return "El modelo configurado no está disponible para esta cuenta.";
    case ASSISTANT_ERROR_CODES.rateLimited:
      return "El servicio de interpretación alcanzó su límite temporal. Inténtalo más tarde.";
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
    summary: "Necesito algunos datos adicionales para preparar la acción.",
    drafts: [],
    clarifications: [{ question }]
  });

const rejection = (
  code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES] =
    ASSISTANT_ERROR_CODES.rejected
): AssistantOperationResult<AssistantInterpretation> =>
  success({
    state: "REJECTED",
    summary: "No puedo preparar esa solicitud de forma segura.",
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
  ...(overrides?.knownFileReferences ? { knownFileReferences: overrides.knownFileReferences } : {})
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
type DraftValidationResult = ActionSubmission | DraftClarification | null;

const draftClarification = (question: string): DraftClarification => ({ kind: "CLARIFICATION", question });

const isDraftClarification = (value: DraftValidationResult): value is DraftClarification =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "CLARIFICATION";

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

const validateDraft = (
  candidate: unknown,
  reference: AssistantInterpretationReference,
  temporalResolver: ReturnType<typeof createPlannerTemporalResolver>
): DraftValidationResult => {
  if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["action", "input"]) || typeof candidate.action !== "string") {
    return null;
  }

  const { action, input } = candidate;
  switch (action) {
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
    case "OPEN_APPLICATION": {
      const alias = isRecord(input) ? input.alias : undefined;
      const result = isRecord(input) && hasOnlyKeys(input, ["alias"])
        ? validateApplicationAlias(alias)
        : { ok: false as const };
      if (!result.ok || isUnsafeAssistantDraftText(alias)) return null;
      const known = reference.knownApplicationAliases?.some(
        (alias) => alias.trim().toLocaleLowerCase() === result.data.toLocaleLowerCase()
      );
      return known ? { action, input: { alias: result.data } } : draftClarification("La aplicación necesita un alias registrado y confiable.");
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
      return { action, input: { destination: "YOUTUBE", browser: "CHROME" } };
    }
    case "SEARCH_FILES": {
      const result = validateFileSearchInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      if (!fileReferencesAreKnown(action, input, reference.knownFileReferences)) return null;
      return { action, input: result.data };
    }
    case "CREATE_FOLDER": {
      const result = validateCreateFolderInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      return fileReferencesAreKnown(action, input, reference.knownFileReferences)
        ? { action, input: result.data }
        : null;
    }
    case "RENAME_FILE": {
      const result = validateRenameFileInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      return fileReferencesAreKnown(action, input, reference.knownFileReferences)
        ? { action, input: result.data }
        : null;
    }
    case "RENAME_FOLDER": {
      const result = validateRenameFolderInput(input);
      if (!result.ok || !isRecord(input) || hasUnsafeFileDraftText(input)) return null;
      return fileReferencesAreKnown(action, input, reference.knownFileReferences)
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
      return fileReferencesAreKnown(action, input, reference.knownFileReferences)
        ? { action, input: result.data }
        : null;
    }
    case "UPDATE_TASK": {
      const result = validateUpdateTaskInput(input);
      return result.ok ? draftClarification("La tarea necesita una referencia confiable para actualizarse.") : null;
    }
    case "COMPLETE_TASK": {
      const result = validateCompleteTaskInput(input);
      return result.ok ? draftClarification("La tarea necesita una referencia confiable para completarse.") : null;
    }
    case "UPDATE_EVENT": {
      const result = validateUpdateEventInput(input);
      return result.ok ? draftClarification("El evento necesita una referencia confiable para actualizarse.") : null;
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

const parseProviderOutput = (
  raw: unknown,
  reference: AssistantInterpretationReference,
  temporalResolver: ReturnType<typeof createPlannerTemporalResolver>
): AssistantOperationResult<AssistantInterpretation> => {
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
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ["state", "summary", "drafts", "clarifications"])) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (!isSafeText(parsed.summary, 500) || !Array.isArray(parsed.drafts) || !Array.isArray(parsed.clarifications)) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (!parsed.clarifications.every((item) => isRecord(item) && hasOnlyKeys(item, ["question"]) && isSafeText(item.question, 300))) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (parsed.state === "NEEDS_CLARIFICATION") {
    return parsed.drafts.length === 0
      ? clarification()
      : rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (parsed.state === "REJECTED") {
    return parsed.drafts.length === 0 && parsed.clarifications.length === 0
      ? rejection(ASSISTANT_ERROR_CODES.rejected)
      : rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  if (parsed.state !== "READY" || parsed.drafts.length === 0 || parsed.drafts.length > MAX_DRAFTS || parsed.clarifications.length !== 0) {
    return rejection(ASSISTANT_ERROR_CODES.malformed);
  }
  const drafts: ActionSubmission[] = [];
  for (const [index, candidate] of parsed.drafts.entries()) {
    if (!isRecord(candidate)) return rejection(ASSISTANT_ERROR_CODES.malformed);
    const draft = validateDraft(
      { ...candidate, input: parseDraftInput(candidate.input) },
      reference,
      temporalResolver
    );
    if (isDraftClarification(draft)) return clarification(`El borrador ${index + 1}: ${draft.question}`);
    if (!draft) return rejection(ASSISTANT_ERROR_CODES.rejected);
    drafts.push(draft);
  }
  return success({ state: "READY", summary: READY_SUMMARY, drafts, clarifications: [] });
};

const isRateLimited = (error: unknown): boolean =>
  isRecord(error) && error.status === 429;

const getProviderFailureCode = (
  error: unknown
): (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES] => {
  if (!isRecord(error)) return ASSISTANT_ERROR_CODES.provider;
  if (error.status === 401) return ASSISTANT_ERROR_CODES.authentication;
  if (error.status === 403 || error.status === 404) return ASSISTANT_ERROR_CODES.modelAccess;
  if (isRateLimited(error)) return ASSISTANT_ERROR_CODES.rateLimited;
  return ASSISTANT_ERROR_CODES.provider;
};

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
      referenceOverrides?: Partial<AssistantInterpretationReference>
    ): Promise<AssistantOperationResult<AssistantInterpretation>> {
      if (!isRecord(input) || !hasOnlyKeys(input, ["instruction"]) || !isSafeText(input.instruction, MAX_INSTRUCTION_LENGTH)) {
        return clarification();
      }

      const normalizedInput: AssistantInterpretInput = { instruction: input.instruction.trim() };
      if (isUnsafeAssistantInstruction(normalizedInput.instruction)) {
        return rejection(ASSISTANT_ERROR_CODES.rejected);
      }
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
        return reportUnavailable(getProviderFailureCode(error));
      } finally {
        clearTimeout(timeout);
      }

      try {
        const temporalResolver = createPlannerTemporalResolver({
          now: () => new Date(reference.now),
          timeZone: () => reference.timeZone
        });
        const result = parseProviderOutput(output, reference, temporalResolver);
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
