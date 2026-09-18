import { randomUUID } from "node:crypto";
import {
  ACTION_ERROR_CODES,
  ACTION_NAMES,
  ACTION_RISK_LEVELS,
  TERMINAL_ACTION_STATUSES,
  type ActionHistoryListInput,
  type ActionHistoryRecord,
  type ActionName,
  type ActionOperationResult,
  type ActionRiskLevel,
  type SafeHistoryMetadata,
  type TerminalActionStatus
} from "../../shared/action-contracts";
import {
  ActionHistoryRepositoryError,
  createActionHistoryRepository,
  type ActionHistoryRepository,
  type PersistActionHistoryInput
} from "./action-history-repository";

const MAX_ACTION_ID_LENGTH = 128;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_USER_SUMMARY_LENGTH = 500;
const MAX_APPLICATION_DISPLAY_NAME_LENGTH = 160;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

const historyMessages = {
  [ACTION_ERROR_CODES.historyInvalid]: "No se pudo registrar el historial de la acción.",
  [ACTION_ERROR_CODES.historyUnavailable]: "No se pudo acceder al historial de acciones."
} as const;

type HistoryErrorCode = keyof typeof historyMessages;

type ActionHistoryServiceDependencies = {
  repository?: ActionHistoryRepository;
  generateActionId: () => string;
  logError: (message: string) => void;
};

export type ActionHistoryService = {
  recordTerminal: (input: unknown) => Promise<ActionOperationResult<ActionHistoryRecord>>;
  list: (
    input: unknown
  ) => Promise<ActionOperationResult<{ items: ActionHistoryRecord[]; total: number }>>;
};

const defaultDependencies: ActionHistoryServiceDependencies = {
  generateActionId: randomUUID,
  logError: (message) => {
    console.error(message);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isActionName = (value: unknown): value is ActionName =>
  typeof value === "string" && ACTION_NAMES.includes(value as ActionName);

const isRiskLevel = (value: unknown): value is ActionRiskLevel =>
  typeof value === "number" && ACTION_RISK_LEVELS.includes(value as ActionRiskLevel);

const isTerminalStatus = (value: unknown): value is TerminalActionStatus =>
  typeof value === "string" && TERMINAL_ACTION_STATUSES.includes(value as TerminalActionStatus);

const isIsoDateTime = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
};

const normalizeRequiredText = (value: unknown, maximumLength: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : undefined;
};

const prohibitedUserSummaryPattern =
  /(?:postgres(?:ql)?:\/\/|\b(?:password|secret|token|credential)\b|(?:[a-z]:\\|\\\\)|\b(?:remove-item|powershell|cmd\.exe|shell)\b|\b(?:stack|trace)\b)/iu;

const normalizeUserSummary = (value: unknown): string | undefined => {
  const summary = normalizeRequiredText(value, MAX_USER_SUMMARY_LENGTH);
  return summary && !prohibitedUserSummaryPattern.test(summary) ? summary : undefined;
};

const normalizeActionId = (value: unknown): string | undefined => {
  const actionId = normalizeRequiredText(value, MAX_ACTION_ID_LENGTH);
  return actionId && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(actionId) ? actionId : undefined;
};

const normalizeErrorCode = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  const errorCode = normalizeRequiredText(value, MAX_ERROR_CODE_LENGTH);
  return errorCode && /^[A-Z][A-Z0-9_]*$/.test(errorCode) ? errorCode : undefined;
};

const safeMetadataKeys = {
  itemCount: "number",
  succeededCount: "number",
  failedCount: "number",
  skippedCount: "number",
  partial: "boolean",
  hasError: "boolean",
  scopeKind: "identifier",
  resultKind: "identifier",
  applicationDisplayName: "publicText"
} as const;

const isSafeIdentifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z][A-Z_]{0,47}$/.test(value);

const normalizePublicDisplayName = (value: unknown): string | undefined => {
  const displayName = normalizeRequiredText(value, MAX_APPLICATION_DISPLAY_NAME_LENGTH);
  return displayName && !prohibitedUserSummaryPattern.test(displayName) ? displayName : undefined;
};

/**
 * Keeps only a deliberately small metadata allowlist so terminal history cannot
 * become a store for secrets, raw input, paths, commands, audio, or prompts.
 */
export const sanitizeActionHistoryMetadata = (value: unknown): SafeHistoryMetadata | undefined => {
  if (!isRecord(value)) return undefined;

  const sanitized: SafeHistoryMetadata = {};
  for (const [key, metadataValue] of Object.entries(value)) {
    const expectedType = safeMetadataKeys[key as keyof typeof safeMetadataKeys];
    if (expectedType === "number" && typeof metadataValue === "number" && Number.isSafeInteger(metadataValue) && metadataValue >= 0) {
      sanitized[key] = metadataValue;
    }
    if (expectedType === "boolean" && typeof metadataValue === "boolean") {
      sanitized[key] = metadataValue;
    }
    if (expectedType === "identifier" && isSafeIdentifier(metadataValue)) {
      sanitized[key] = metadataValue;
    }
    if (expectedType === "publicText") {
      const displayName = normalizePublicDisplayName(metadataValue);
      if (displayName) sanitized[key] = displayName;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const createFailure = <T>(code: HistoryErrorCode): ActionOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: historyMessages[code] }
});

const validateRecordInput = (
  input: unknown,
  generateActionId: () => string
): PersistActionHistoryInput | undefined => {
  if (!isRecord(input)) return undefined;
  const allowedKeys = [
    "actionId",
    "action",
    "riskLevel",
    "status",
    "userSummary",
    "errorCode",
    "metadata",
    "startedAt",
    "finishedAt"
  ];
  if (!hasOnlyKeys(input, allowedKeys)) return undefined;

  const actionId = normalizeActionId(input.actionId ?? generateActionId());
  const userSummary = normalizeUserSummary(input.userSummary);
  const errorCode = normalizeErrorCode(input.errorCode);
  if (
    !actionId ||
    !userSummary ||
    !isActionName(input.action) ||
    !isRiskLevel(input.riskLevel) ||
    !isTerminalStatus(input.status) ||
    !isIsoDateTime(input.startedAt) ||
    (input.finishedAt !== undefined && !isIsoDateTime(input.finishedAt))
  ) {
    return undefined;
  }

  const startedAt = new Date(input.startedAt);
  const finishedAt = input.finishedAt === undefined ? undefined : new Date(input.finishedAt);
  if (finishedAt && finishedAt < startedAt) return undefined;

  return {
    actionId,
    action: input.action,
    riskLevel: input.riskLevel,
    status: input.status,
    userSummary,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(input.metadata === undefined ? {} : { metadata: sanitizeActionHistoryMetadata(input.metadata) }),
    startedAt,
    ...(finishedAt === undefined ? {} : { finishedAt })
  };
};

const validateListInput = (
  input: unknown
): (Required<Pick<ActionHistoryListInput, "limit">> & ActionHistoryListInput) | undefined => {
  if (!isRecord(input)) return undefined;
  const allowedKeys = ["actionId", "actions", "statuses", "riskLevels", "startedAtFrom", "startedAtTo", "limit"];
  if (!hasOnlyKeys(input, allowedKeys)) return undefined;

  const actionId = input.actionId === undefined ? undefined : normalizeRequiredText(input.actionId, MAX_ACTION_ID_LENGTH);
  const actions = input.actions;
  const statuses = input.statuses;
  const riskLevels = input.riskLevels;
  const limit = input.limit === undefined ? DEFAULT_LIST_LIMIT : input.limit;
  if (
    (input.actionId !== undefined && !actionId) ||
    (actions !== undefined && (!Array.isArray(actions) || actions.length === 0 || actions.length > 20 || !actions.every(isActionName))) ||
    (statuses !== undefined && (!Array.isArray(statuses) || statuses.length === 0 || statuses.length > 20 || !statuses.every(isTerminalStatus))) ||
    (riskLevels !== undefined && (!Array.isArray(riskLevels) || riskLevels.length === 0 || riskLevels.length > 3 || !riskLevels.every(isRiskLevel))) ||
    (input.startedAtFrom !== undefined && !isIsoDateTime(input.startedAtFrom)) ||
    (input.startedAtTo !== undefined && !isIsoDateTime(input.startedAtTo)) ||
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIST_LIMIT
  ) {
    return undefined;
  }

  if (
    input.startedAtFrom !== undefined &&
    input.startedAtTo !== undefined &&
    new Date(input.startedAtFrom) > new Date(input.startedAtTo)
  ) {
    return undefined;
  }

  return {
    ...(actionId === undefined ? {} : { actionId }),
    ...(actions === undefined ? {} : { actions: actions as ActionName[] }),
    ...(statuses === undefined ? {} : { statuses: statuses as TerminalActionStatus[] }),
    ...(riskLevels === undefined ? {} : { riskLevels: riskLevels as ActionRiskLevel[] }),
    ...(input.startedAtFrom === undefined ? {} : { startedAtFrom: input.startedAtFrom }),
    ...(input.startedAtTo === undefined ? {} : { startedAtTo: input.startedAtTo }),
    limit
  };
};

export const createActionHistoryService = (
  overrides: Partial<ActionHistoryServiceDependencies> = {}
): ActionHistoryService => {
  const dependencies = { ...defaultDependencies, ...overrides };
  let repository = dependencies.repository;
  const getRepository = (): ActionHistoryRepository => {
    if (!repository) repository = createActionHistoryRepository();
    return repository;
  };

  return {
    recordTerminal: async (input) => {
      const validated = validateRecordInput(input, dependencies.generateActionId);
      if (!validated) return createFailure(ACTION_ERROR_CODES.historyInvalid);

      try {
        return { ok: true, data: await getRepository().record(validated) };
      } catch (error) {
        if (!(error instanceof ActionHistoryRepositoryError)) {
          dependencies.logError("Action history persistence failed.");
        }
        return createFailure(ACTION_ERROR_CODES.historyUnavailable);
      }
    },
    list: async (input) => {
      const validated = validateListInput(input);
      if (!validated) return createFailure(ACTION_ERROR_CODES.historyInvalid);

      try {
        const items = await getRepository().list(validated);
        return { ok: true, data: { items, total: items.length } };
      } catch (error) {
        if (!(error instanceof ActionHistoryRepositoryError)) {
          dependencies.logError("Action history listing failed.");
        }
        return createFailure(ACTION_ERROR_CODES.historyUnavailable);
      }
    }
  };
};
