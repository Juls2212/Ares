import {
  PLANNER_ERROR_CODES,
  type DeleteTaskData,
  type TaskDeletionCancellationData,
  type TaskDeletionRequestData,
  type PlannerOperationResult
} from "../../shared/planner-contracts";
import { getActionOrchestrator } from "../actions/action-composition";
import type { ActionOrchestrator } from "../actions/action-orchestrator";
import { validateDeleteTaskInput } from "./planner-validation";

type Dependencies = {
  getOrchestrator: () => ActionOrchestrator;
  logError: (message: string) => void;
};

export type TaskDeletionService = {
  request: (input: unknown) => Promise<PlannerOperationResult<TaskDeletionRequestData>>;
  confirm: (input: unknown) => Promise<PlannerOperationResult<DeleteTaskData>>;
  cancel: (input: unknown) => Promise<PlannerOperationResult<TaskDeletionCancellationData>>;
};

const unavailable = <T>(): PlannerOperationResult<T> => ({
  ok: false,
  error: {
    code: PLANNER_ERROR_CODES.confirmationUnavailable,
    userMessage: "La confirmación de la tarea ya no está disponible."
  }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateDecision = (input: unknown): PlannerOperationResult<{ taskId: string; confirmationId: string }> => {
  if (!isRecord(input) || Object.keys(input).length !== 2 || !("taskId" in input) || !("confirmationId" in input)) {
    return unavailable();
  }
  const task = validateDeleteTaskInput({ taskId: input.taskId });
  if (!task.ok) return task;
  if (typeof input.confirmationId !== "string" || input.confirmationId.length === 0) return unavailable();
  return { ok: true, data: { taskId: task.data.taskId, confirmationId: input.confirmationId } };
};

export const createTaskDeletionService = (overrides: Partial<Dependencies> = {}): TaskDeletionService => {
  const dependencies: Dependencies = {
    getOrchestrator: overrides.getOrchestrator ?? getActionOrchestrator,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  return {
    request: async (input) => {
      const validated = validateDeleteTaskInput(input);
      if (!validated.ok) return validated;
      try {
        const result = await dependencies.getOrchestrator().propose({ action: "DELETE_TASK", input: validated.data });
        return result.ok && "confirmationId" in result.data && result.data.action === "DELETE_TASK"
          ? { ok: true, data: { confirmationId: result.data.confirmationId } }
          : unavailable();
      } catch {
        dependencies.logError("Task deletion request failed.");
        return unavailable();
      }
    },
    confirm: async (input) => {
      const validated = validateDecision(input);
      if (!validated.ok) return validated;
      try {
        const result = await dependencies.getOrchestrator().confirmTaskDeletion(
          validated.data.taskId,
          validated.data.confirmationId
        );
        if (!result.ok) return unavailable();
        if (result.data.action !== "DELETE_TASK") return unavailable();
        if (result.data.status === "SUCCEEDED") return { ok: true, data: { deleted: true } };
        if (result.data.errorCode === PLANNER_ERROR_CODES.notFound) {
          return { ok: false, error: { code: PLANNER_ERROR_CODES.notFound, userMessage: "La tarea ya no está disponible." } };
        }
        return unavailable();
      } catch {
        dependencies.logError("Task deletion confirmation failed.");
        return unavailable();
      }
    },
    cancel: async (input) => {
      const validated = validateDecision(input);
      if (!validated.ok) return validated;
      try {
        const result = await dependencies.getOrchestrator().cancelTaskDeletion(
          validated.data.taskId,
          validated.data.confirmationId
        );
        return result.ok && result.data.action === "DELETE_TASK" && result.data.status === "CANCELLED"
          ? { ok: true, data: { cancelled: true } }
          : unavailable();
      } catch {
        dependencies.logError("Task deletion cancellation failed.");
        return unavailable();
      }
    }
  };
};

let taskDeletionService: TaskDeletionService | undefined;
export const getTaskDeletionService = (): TaskDeletionService => {
  taskDeletionService ??= createTaskDeletionService();
  return taskDeletionService;
};
