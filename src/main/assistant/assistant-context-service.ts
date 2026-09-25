import { lstat as defaultLstat, realpath as defaultRealpath } from "node:fs/promises";
import path from "node:path";

import {
  ASSISTANT_CURRENT_CONTEXT_TOKEN,
  ASSISTANT_ERROR_CODES,
  type AssistantContextData,
  type AssistantContextKind,
  type AssistantContextSelection,
  type AssistantContextSetInput,
  type AssistantCurrentContext,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import type { SafeFileReference } from "../../shared/file-contracts";
import { validateApplicationAlias } from "../applications/application-validation";
import { getApplicationService } from "../applications/application-composition";
import type { ApplicationService } from "../applications/application-service";
import {
  isCanonicalPathWithinRoot,
  type FilePathStats
} from "../files/file-path-boundary";
import { createApprovedFileRootResolver, type ApprovedFileRootResolver } from "../files/approved-file-roots";
import { validateSafeFileReference } from "../files/file-validation";
import type { PlannerRepositories } from "../planner/planner-repositories";
import { createPlannerRepositories } from "../planner/planner-repositories";
import { createAssistantContextStore, type AssistantContextStore } from "./assistant-context-store";

type PlannerContextRecord = { id: string; title: string };

export type ResolvedAssistantContext = {
  providerContext: AssistantCurrentContext;
  selection: AssistantContextSelection;
};

type AssistantContextServiceDependencies = {
  store: AssistantContextStore;
  plannerRepositories: Pick<
    PlannerRepositories,
    "findTaskById" | "findEventById" | "findReminderById"
  >;
  applicationService: Pick<ApplicationService, "resolveEnabledApplicationByAlias">;
  rootResolver: ApprovedFileRootResolver;
  lstat: (targetPath: string) => Promise<FilePathStats>;
  realpath: (targetPath: string) => Promise<string>;
  logError: (message: string) => void;
};

export type AssistantContextService = {
  set: (
    webContentsId: number,
    input: unknown
  ) => Promise<AssistantOperationResult<AssistantContextData>>;
  clear: (webContentsId: number) => AssistantOperationResult<AssistantContextData>;
  getValidated: (webContentsId: number) => Promise<ResolvedAssistantContext | undefined>;
  bindWindow: (webContentsId: number, onDestroyed: (listener: () => void) => void) => void;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumContextLabelLength = 160;

const success = <T>(data: T): AssistantOperationResult<T> => ({ ok: true, data });

const failure = <T>(
  code: typeof ASSISTANT_ERROR_CODES.contextInvalid | typeof ASSISTANT_ERROR_CODES.contextUnavailable
): AssistantOperationResult<T> => ({
  ok: false,
  error: {
    code,
    userMessage:
      code === ASSISTANT_ERROR_CODES.contextInvalid
        ? "La selección actual no es válida para el asistente."
        : "No se pudo validar la selección actual."
  }
});

const safeLabel = (value: string): string =>
  value.replace(/[\r\n]/g, " ").trim().slice(0, maximumContextLabelLength);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseSelection = (
  input: unknown
): AssistantOperationResult<AssistantContextSelection> => {
  if (!isRecord(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, "selection")) {
    return failure(ASSISTANT_ERROR_CODES.contextInvalid);
  }
  const selection = input.selection;
  if (!isRecord(selection) || typeof selection.section !== "string" || typeof selection.kind !== "string") {
    return failure(ASSISTANT_ERROR_CODES.contextInvalid);
  }
  if (selection.section === "PLANNER") {
    if (
      !["TASK", "EVENT", "REMINDER"].includes(selection.kind) ||
      typeof selection.id !== "string" ||
      !uuidPattern.test(selection.id) ||
      Object.keys(selection).some((key) => !["section", "kind", "id"].includes(key))
    ) {
      return failure(ASSISTANT_ERROR_CODES.contextInvalid);
    }
    return success({
      section: "PLANNER",
      kind: selection.kind as "TASK" | "EVENT" | "REMINDER",
      id: selection.id
    });
  }
  if (selection.section === "FILES") {
    if (
      !["FILE", "FOLDER"].includes(selection.kind) ||
      Object.keys(selection).some((key) => !["section", "kind", "reference"].includes(key))
    ) {
      return failure(ASSISTANT_ERROR_CODES.contextInvalid);
    }
    const reference = validateSafeFileReference(selection.reference);
    return reference.ok
      ? success({ section: "FILES", kind: selection.kind as "FILE" | "FOLDER", reference: reference.data })
      : failure(ASSISTANT_ERROR_CODES.contextInvalid);
  }
  if (selection.section === "APPLICATIONS") {
    if (
      selection.kind !== "APPLICATION" ||
      Object.keys(selection).some((key) => !["section", "kind", "alias"].includes(key))
    ) {
      return failure(ASSISTANT_ERROR_CODES.contextInvalid);
    }
    const alias = validateApplicationAlias(selection.alias);
    return alias.ok
      ? success({ section: "APPLICATIONS", kind: "APPLICATION", alias: alias.data })
      : failure(ASSISTANT_ERROR_CODES.contextInvalid);
  }
  return failure(ASSISTANT_ERROR_CODES.contextInvalid);
};

const providerContext = (
  kind: AssistantContextKind,
  label: string
): AssistantCurrentContext => ({
  token: ASSISTANT_CURRENT_CONTEXT_TOKEN,
  kind,
  label: safeLabel(label) || "elemento seleccionado"
});

const contextRecord = (record: PlannerContextRecord | undefined): PlannerContextRecord | undefined =>
  record && safeLabel(record.title) ? record : undefined;

/** Main-only resolver. It stores only validated handles and revalidates each use. */
export const createAssistantContextService = (
  overrides: Partial<AssistantContextServiceDependencies> = {}
): AssistantContextService => {
  const dependencies: AssistantContextServiceDependencies = {
    store: overrides.store ?? createAssistantContextStore(),
    plannerRepositories: overrides.plannerRepositories ?? createPlannerRepositories(),
    applicationService: overrides.applicationService ?? getApplicationService(),
    rootResolver: overrides.rootResolver ?? createApprovedFileRootResolver(),
    lstat: overrides.lstat ?? defaultLstat,
    realpath: overrides.realpath ?? defaultRealpath,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  const resolvePlanner = async (
    selection: Extract<AssistantContextSelection, { section: "PLANNER" }>
  ): Promise<ResolvedAssistantContext | undefined> => {
    try {
      const record = contextRecord(
        selection.kind === "TASK"
          ? await dependencies.plannerRepositories.findTaskById(selection.id)
          : selection.kind === "EVENT"
            ? await dependencies.plannerRepositories.findEventById(selection.id)
            : await dependencies.plannerRepositories.findReminderById(selection.id)
      );
      return record
        ? { selection, providerContext: providerContext(selection.kind, record.title) }
        : undefined;
    } catch {
      dependencies.logError("Assistant planner context validation failed.");
      return undefined;
    }
  };

  const resolveFile = async (
    selection: Extract<AssistantContextSelection, { section: "FILES" }>
  ): Promise<ResolvedAssistantContext | undefined> => {
    try {
      const root = await dependencies.rootResolver.resolve(selection.reference.rootId);
      if (!root.ok) return undefined;
      const requestedPath = path.win32.resolve(root.data.canonicalPath, selection.reference.relativePath);
      if (!isCanonicalPathWithinRoot(root.data.canonicalPath, requestedPath)) return undefined;
      const requestedStats = await dependencies.lstat(requestedPath);
      if (
        requestedStats.isSymbolicLink() ||
        (selection.kind === "FILE" ? !requestedStats.isFile() : !requestedStats.isDirectory())
      ) {
        return undefined;
      }
      const canonicalPath = await dependencies.realpath(requestedPath);
      if (!isCanonicalPathWithinRoot(root.data.canonicalPath, canonicalPath)) return undefined;
      const canonicalStats = await dependencies.lstat(canonicalPath);
      if (
        canonicalStats.isSymbolicLink() ||
        (selection.kind === "FILE" ? !canonicalStats.isFile() : !canonicalStats.isDirectory())
      ) {
        return undefined;
      }
      const label = selection.reference.relativePath.split("\\").at(-1) ?? "elemento seleccionado";
      return { selection, providerContext: providerContext(selection.kind, label) };
    } catch {
      dependencies.logError("Assistant file context validation failed.");
      return undefined;
    }
  };

  const resolveApplication = async (
    selection: Extract<AssistantContextSelection, { section: "APPLICATIONS" }>
  ): Promise<ResolvedAssistantContext | undefined> => {
    try {
      const resolved = await dependencies.applicationService.resolveEnabledApplicationByAlias(
        selection.alias
      );
      if (!resolved.ok) return undefined;
      return {
        selection,
        providerContext: providerContext("APPLICATION", resolved.data.name)
      };
    } catch {
      dependencies.logError("Assistant application context validation failed.");
      return undefined;
    }
  };

  const resolve = async (
    selection: AssistantContextSelection
  ): Promise<ResolvedAssistantContext | undefined> =>
    selection.section === "PLANNER"
      ? resolvePlanner(selection)
      : selection.section === "FILES"
        ? resolveFile(selection)
        : resolveApplication(selection);

  const boundWindows = new Set<number>();

  return {
    set: async (webContentsId, input) => {
      const selection = parseSelection(input);
      if (!selection.ok) {
        dependencies.store.clear(webContentsId);
        return selection;
      }
      const resolved = await resolve(selection.data);
      if (!resolved) {
        dependencies.store.clear(webContentsId);
        return failure(ASSISTANT_ERROR_CODES.contextInvalid);
      }
      dependencies.store.set(webContentsId, selection.data);
      return success({ status: "SET", kind: resolved.providerContext.kind });
    },
    clear: (webContentsId) => {
      dependencies.store.clear(webContentsId);
      return success({ status: "CLEARED" });
    },
    getValidated: async (webContentsId) => {
      const selection = dependencies.store.get(webContentsId);
      if (!selection) return undefined;
      const resolved = await resolve(selection);
      if (!resolved) dependencies.store.clear(webContentsId);
      return resolved;
    },
    bindWindow: (webContentsId, onDestroyed) => {
      if (boundWindows.has(webContentsId)) return;
      boundWindows.add(webContentsId);
      onDestroyed(() => {
        dependencies.store.removeWindow(webContentsId);
        boundWindows.delete(webContentsId);
      });
    }
  };
};

let assistantContextService: AssistantContextService | undefined;

/** The singleton remains Main-only; selections are still keyed by webContents id. */
export const getAssistantContextService = (): AssistantContextService => {
  assistantContextService ??= createAssistantContextService();
  return assistantContextService;
};
