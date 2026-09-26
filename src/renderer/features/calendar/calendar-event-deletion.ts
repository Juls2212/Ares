import type { PlannerApi } from "../../../shared/planner-contracts";

export type EventDeletionOutcome =
  | { deleted: true }
  | { deleted: false; message: string };

export type EventDeletionRequestOutcome =
  | { ready: true; confirmationId: string }
  | { ready: false; message: string };

export const requestCalendarEventDeletion = async (
  planner: PlannerApi | undefined,
  eventId: string
): Promise<EventDeletionRequestOutcome> => {
  if (!planner?.events.requestDeletion) return { ready: false, message: "No se pudo preparar la eliminación del evento." };
  try {
    const result = await planner.events.requestDeletion({ eventId });
    return result.ok
      ? { ready: true, confirmationId: result.data.confirmationId }
      : { ready: false, message: "No se pudo preparar la eliminación del evento." };
  } catch {
    return { ready: false, message: "No se pudo preparar la eliminación del evento." };
  }
};

export const confirmCalendarEventDeletion = async (
  planner: PlannerApi | undefined,
  eventId: string,
  confirmationId: string
): Promise<EventDeletionOutcome> => {
  if (!planner?.events.confirmDeletion) return { deleted: false, message: "No se pudo eliminar el evento. Inténtalo de nuevo." };
  try {
    const result = await planner.events.confirmDeletion({ eventId, confirmationId });
    if (result.ok) return { deleted: true };
    return {
      deleted: false,
      message: result.error.code === "PLANNER_NOT_FOUND"
        ? "El evento ya no está disponible. Actualiza el calendario."
        : "No se pudo eliminar el evento. Inténtalo de nuevo."
    };
  } catch {
    return { deleted: false, message: "No se pudo eliminar el evento. Inténtalo de nuevo." };
  }
};

export const cancelCalendarEventDeletion = async (
  planner: PlannerApi | undefined,
  eventId: string,
  confirmationId: string
): Promise<boolean> => {
  if (!planner?.events.cancelDeletion) return false;
  try {
    const result = await planner.events.cancelDeletion({ eventId, confirmationId });
    return result.ok && result.data.cancelled;
  } catch {
    return false;
  }
};
