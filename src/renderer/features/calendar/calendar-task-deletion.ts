import type { PlannerApi } from "../../../shared/planner-contracts";

export type TaskDeletionOutcome =
  | { deleted: true }
  | { deleted: false; message: string };

export type TaskDeletionRequestOutcome =
  | { ready: true; confirmationId: string }
  | { ready: false; message: string };

export const requestCalendarTaskDeletion = async (
  planner: PlannerApi | undefined,
  taskId: string
): Promise<TaskDeletionRequestOutcome> => {
  if (!planner?.tasks.requestDeletion) return { ready: false, message: "No se pudo preparar la eliminación de la tarea." };
  try {
    const result = await planner.tasks.requestDeletion({ taskId });
    return result.ok
      ? { ready: true, confirmationId: result.data.confirmationId }
      : { ready: false, message: "No se pudo preparar la eliminación de la tarea." };
  } catch {
    return { ready: false, message: "No se pudo preparar la eliminación de la tarea." };
  }
};

export const confirmCalendarTaskDeletion = async (
  planner: PlannerApi | undefined,
  taskId: string,
  confirmationId: string
): Promise<TaskDeletionOutcome> => {
  if (!planner?.tasks.confirmDeletion) return { deleted: false, message: "No se pudo eliminar la tarea. Inténtalo de nuevo." };
  try {
    const result = await planner.tasks.confirmDeletion({ taskId, confirmationId });
    if (result.ok) return { deleted: true };
    return {
      deleted: false,
      message: result.error.code === "PLANNER_NOT_FOUND"
        ? "La tarea ya no está disponible. Actualiza el calendario."
        : "No se pudo eliminar la tarea. Inténtalo de nuevo."
    };
  } catch {
    return { deleted: false, message: "No se pudo eliminar la tarea. Inténtalo de nuevo." };
  }
};

export const cancelCalendarTaskDeletion = async (
  planner: PlannerApi | undefined,
  taskId: string,
  confirmationId: string
): Promise<boolean> => {
  if (!planner?.tasks.cancelDeletion) return false;
  try {
    const result = await planner.tasks.cancelDeletion({ taskId, confirmationId });
    return result.ok && result.data.cancelled;
  } catch {
    return false;
  }
};
