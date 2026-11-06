import type {
  ActionOutcome,
  ActionPolicy,
  SupervisedFilesActionProposal
} from "../../shared/action-contracts";
import type {
  CreateSupervisedFolderInput,
  DeleteFoundItemInput,
  FoundFileSummary,
  MoveFoundItemsInput,
  OpenFoundFileInput,
  OrganizeFoundItemsInput,
  RenameFoundItemInput,
  SupervisedFileSearchData
} from "../../shared/supervised-file-contracts";
import { getSupervisedFileService } from "../files/supervised-file-composition";
import {
  FILES_EXECUTION_FAILURE_CODES,
  FILES_FAILURES,
  type FilesPartialCounts,
  filesFailure,
  filesSuccess,
  type FilesResult
} from "../files/supervised-file-failures";
import type { SupervisedFileService } from "../files/supervised-file-service";

const MAX_SPOKEN_NAMES = 3;
const MAX_SPOKEN_NAME_LENGTH = 60;

/** What the orchestrator needs to hold a modifying proposal: Main-issued reference plus review text. */
export type PreparedFilesAction = {
  input:
    | OpenFoundFileInput
    | CreateSupervisedFolderInput
    | RenameFoundItemInput
    | MoveFoundItemsInput
    | OrganizeFoundItemsInput
    | DeleteFoundItemInput;
  confirmationSummary: string;
  scopeSummary: string;
};

export type SupervisedFileActionExecutor = {
  prepare: (proposal: SupervisedFilesActionProposal) => Promise<FilesResult<PreparedFilesAction>>;
  execute: (proposal: SupervisedFilesActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type Dependencies = {
  service?: SupervisedFileService;
  logError: (message: string) => void;
};

/** Display text only: control characters and review-dialog quote marks are removed and length is bounded. */
const toDisplayName = (name: string): string =>
  name.replace(/[\u0000-\u001f\u007f«»]/gu, "").trim().slice(0, MAX_SPOKEN_NAME_LENGTH);

/**
 * Count plus the first three names. This text is also what gets spoken, so file names reach the
 * speech provider; it is deliberately limited to three bounded names and never includes a path.
 */
export const describeSearchResults = (data: SupervisedFileSearchData): string => {
  if (data.resultCount === 0) return FILES_FAILURES.FILES_NO_RESULTS;
  const listed = data.items
    .slice(0, MAX_SPOKEN_NAMES)
    .map((item: FoundFileSummary) => `${item.ordinal}. ${toDisplayName(item.name)} (${item.rootLabel})`)
    .join("; ");
  const remaining = data.resultCount - Math.min(data.resultCount, MAX_SPOKEN_NAMES);
  const count = `Encontré ${data.resultCount} ${data.resultCount === 1 ? "resultado" : "resultados"}`;
  const more = remaining > 0 ? ` y ${remaining} más` : "";
  const partial = data.partial ? ` ${FILES_FAILURES.FILES_SEARCH_PARTIAL}` : "";
  return `${count}: ${listed}${more}.${partial}`;
};

const countLabel = (count: number): string => `${count} ${count === 1 ? "elemento" : "elementos"}`;

/** Counts only: how many items moved before a stop and how many did not. Never names. */
const describePartialCounts = (counts: FilesPartialCounts): string =>
  counts.moved === 0
    ? " No se movió ningún elemento."
    : ` Se movieron ${countLabel(counts.moved)} y ${countLabel(counts.failed)} no se pudieron mover.`;

export const createSupervisedFileActionExecutor = (
  overrides: Partial<Dependencies> = {}
): SupervisedFileActionExecutor => {
  const logError = overrides.logError ?? ((message: string) => console.error(message));
  let service = overrides.service;
  const getService = (): SupervisedFileService => {
    service ??= getSupervisedFileService();
    return service;
  };

  const failureOutcome = (
    proposal: SupervisedFilesActionProposal,
    policy: ActionPolicy,
    code: string,
    userMessage: string,
    counts?: FilesPartialCounts
  ): ActionOutcome => ({
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: FILES_EXECUTION_FAILURE_CODES.includes(code) ? "EXECUTION_FAILED" : "VALIDATION_FAILED",
    errorCode: code,
    userSummary: counts ? `${userMessage}${describePartialCounts(counts)}` : userMessage,
    ...(counts ? { data: { movedCount: counts.moved, failedCount: counts.failed } } : {})
  });

  const successOutcome = (
    proposal: SupervisedFilesActionProposal,
    policy: ActionPolicy,
    userSummary: string,
    extra: Partial<ActionOutcome> = {}
  ): ActionOutcome => ({
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: "SUCCEEDED",
    userSummary,
    ...extra
  });

  return {
    prepare: async (proposal) => {
      try {
        if (proposal.action === "OPEN_FOUND_FILE") {
          const prepared = await getService().prepareOpen(proposal.input.ordinal);
          if (!prepared.ok) return prepared;
          return filesSuccess({
            input: { ordinal: proposal.input.ordinal, preparedId: prepared.data.preparedId },
            confirmationSummary: `Se abrirá «${toDisplayName(prepared.data.displayName)}» (${prepared.data.rootLabel}).`,
            scopeSummary: "Resultado de búsqueda"
          });
        }
        if (proposal.action === "CREATE_FOLDER") {
          const { preparedId: _ignored, ...request } = proposal.input;
          const prepared = await getService().prepareCreateFolder(request);
          if (!prepared.ok) return prepared;
          return filesSuccess({
            input: { ...request, preparedId: prepared.data.preparedId },
            confirmationSummary: `Se creará la carpeta «${toDisplayName(prepared.data.folderName)}» en ${toDisplayName(prepared.data.locationLabel)}.`,
            scopeSummary: "Ubicación aprobada"
          });
        }
        if (proposal.action === "RENAME_FOUND_ITEM") {
          const { preparedId: _ignored, ...request } = proposal.input;
          const prepared = await getService().prepareRename(request);
          if (!prepared.ok) return prepared;
          return filesSuccess({
            input: { ...request, preparedId: prepared.data.preparedId },
            confirmationSummary: `Se renombrará «${toDisplayName(prepared.data.currentName)}» a «${toDisplayName(prepared.data.newName)}» en ${prepared.data.rootLabel}.`,
            scopeSummary: "Resultado de búsqueda"
          });
        }
        if (proposal.action === "MOVE_FOUND_ITEMS") {
          const { preparedId: _ignored, ...request } = proposal.input;
          const prepared = await getService().prepareMove(request);
          if (!prepared.ok) return prepared;
          return filesSuccess({
            input: { ...request, preparedId: prepared.data.preparedId },
            confirmationSummary: `Se moverán ${countLabel(prepared.data.itemCount)} a ${toDisplayName(prepared.data.destinationLabel)}.`,
            scopeSummary: "Resultados de búsqueda"
          });
        }
        if (proposal.action === "ORGANIZE_FOUND_ITEMS") {
          const { preparedId: _ignored, ...request } = proposal.input;
          const prepared = await getService().prepareOrganize(request);
          if (!prepared.ok) return prepared;
          const folder = `«${toDisplayName(prepared.data.folderName)}» en ${prepared.data.destinationLabel}`;
          return filesSuccess({
            input: { ...request, preparedId: prepared.data.preparedId },
            confirmationSummary: prepared.data.createFolder
              ? `Se creará la carpeta ${folder} y se moverán ${countLabel(prepared.data.itemCount)} a ella.`
              : `Se moverán ${countLabel(prepared.data.itemCount)} a la carpeta existente ${folder}.`,
            scopeSummary: "Resultados de búsqueda"
          });
        }
        if (proposal.action === "DELETE_FOUND_ITEM") {
          const prepared = await getService().prepareDelete(proposal.input.ordinal);
          if (!prepared.ok) return prepared;
          const target = prepared.data.kind === "FOLDER"
            ? `la carpeta «${toDisplayName(prepared.data.displayName)}» (${prepared.data.rootLabel}) y todo su contenido`
            : `el archivo «${toDisplayName(prepared.data.displayName)}» (${prepared.data.rootLabel})`;
          return filesSuccess({
            input: { ordinal: proposal.input.ordinal, preparedId: prepared.data.preparedId },
            confirmationSummary: `Se enviará a la Papelera ${target}. Podrás restaurarlo desde la Papelera.`,
            scopeSummary: "Resultado de búsqueda"
          });
        }
        return filesFailure("FILES_OUT_OF_SCOPE");
      } catch {
        logError("Supervised file proposal preparation failed.");
        return filesFailure("FILES_OPERATION_FAILED");
      }
    },
    execute: async (proposal, policy) => {
      try {
        if (proposal.action === "SEARCH_FILES") {
          const result = await getService().search(proposal.input);
          if (!result.ok) return failureOutcome(proposal, policy, result.error.code, result.error.userMessage);
          return successOutcome(proposal, policy, describeSearchResults(result.data), {
            data: result.data,
            ...(result.data.resultCount === 0 ? { errorCode: "FILES_NO_RESULTS" } : {}),
            ...(result.data.resultCount > 0 && result.data.partial ? { errorCode: "FILES_SEARCH_PARTIAL" } : {})
          });
        }
        if (proposal.action === "REVEAL_FOUND_FILE") {
          const result = await getService().revealFound(proposal.input.ordinal);
          return result.ok
            ? successOutcome(proposal, policy, "Listo, te lo muestro en el explorador de archivos.")
            : failureOutcome(proposal, policy, result.error.code, result.error.userMessage);
        }
        if (proposal.action === "OPEN_FOUND_FILE") {
          const result = await getService().commitOpen(proposal.input.preparedId);
          return result.ok
            ? successOutcome(proposal, policy, "Listo, lo abrí.")
            : failureOutcome(proposal, policy, result.error.code, result.error.userMessage);
        }
        if (proposal.action === "CREATE_FOLDER") {
          const result = await getService().commitCreateFolder(proposal.input.preparedId);
          return result.ok
            ? successOutcome(proposal, policy, "Listo, creé la carpeta.")
            : failureOutcome(proposal, policy, result.error.code, result.error.userMessage);
        }
        if (proposal.action === "RENAME_FOUND_ITEM") {
          const result = await getService().commitRename(proposal.input.preparedId);
          return result.ok
            ? successOutcome(proposal, policy, "Listo, cambié el nombre.")
            : failureOutcome(proposal, policy, result.error.code, result.error.userMessage);
        }
        if (proposal.action === "MOVE_FOUND_ITEMS" || proposal.action === "ORGANIZE_FOUND_ITEMS") {
          const result = proposal.action === "MOVE_FOUND_ITEMS"
            ? await getService().commitMove(proposal.input.preparedId)
            : await getService().commitOrganize(proposal.input.preparedId);
          if (!result.ok) return failureOutcome(proposal, policy, result.error.code, result.error.userMessage, result.error.counts);
          const verb = proposal.action === "MOVE_FOUND_ITEMS" ? "moví" : "organicé";
          return successOutcome(proposal, policy, `Listo, ${verb} ${countLabel(result.data.movedCount)}.`, { data: result.data });
        }
        const result = await getService().commitDelete(proposal.input.preparedId);
        return result.ok
          ? successOutcome(proposal, policy, "Listo, envié el elemento a la Papelera.")
          : failureOutcome(proposal, policy, result.error.code, result.error.userMessage);
      } catch {
        logError("Supervised file action execution failed.");
        return failureOutcome(proposal, policy, "FILES_OPERATION_FAILED", FILES_FAILURES.FILES_OPERATION_FAILED);
      }
    }
  };
};
