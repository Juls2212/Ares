import {
  PLANNER_ERROR_CODES,
  type DeleteEventData,
  type EventDeletionCancellationData,
  type EventDeletionRequestData,
  type PlannerOperationResult
} from "../../shared/planner-contracts";
import { getActionOrchestrator } from "../actions/action-composition";
import type { ActionOrchestrator } from "../actions/action-orchestrator";
import { validateDeleteEventInput } from "./planner-validation";

type Dependencies = {
  getOrchestrator: () => ActionOrchestrator;
  logError: (message: string) => void;
};

export type EventDeletionService = {
  request: (input: unknown) => Promise<PlannerOperationResult<EventDeletionRequestData>>;
  confirm: (input: unknown) => Promise<PlannerOperationResult<DeleteEventData>>;
  cancel: (input: unknown) => Promise<PlannerOperationResult<EventDeletionCancellationData>>;
};

const unavailable = <T>(): PlannerOperationResult<T> => ({
  ok: false,
  error: {
    code: PLANNER_ERROR_CODES.confirmationUnavailable,
    userMessage: "La confirmación del evento ya no está disponible."
  }
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateDecision = (input: unknown): PlannerOperationResult<{ eventId: string; confirmationId: string }> => {
  if (!isRecord(input) || Object.keys(input).length !== 2 || !("eventId" in input) || !("confirmationId" in input)) {
    return unavailable();
  }
  const event = validateDeleteEventInput({ eventId: input.eventId });
  if (!event.ok) return event;
  if (typeof input.confirmationId !== "string" || input.confirmationId.length === 0) return unavailable();
  return { ok: true, data: { eventId: event.data.eventId, confirmationId: input.confirmationId } };
};

export const createEventDeletionService = (overrides: Partial<Dependencies> = {}): EventDeletionService => {
  const dependencies: Dependencies = {
    getOrchestrator: overrides.getOrchestrator ?? getActionOrchestrator,
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  return {
    request: async (input) => {
      const validated = validateDeleteEventInput(input);
      if (!validated.ok) return validated;
      try {
        const result = await dependencies.getOrchestrator().propose({ action: "DELETE_EVENT", input: validated.data });
        return result.ok && "confirmationId" in result.data && result.data.action === "DELETE_EVENT"
          ? { ok: true, data: { confirmationId: result.data.confirmationId } }
          : unavailable();
      } catch {
        dependencies.logError("Event deletion request failed.");
        return unavailable();
      }
    },
    confirm: async (input) => {
      const validated = validateDecision(input);
      if (!validated.ok) return validated;
      try {
        const result = await dependencies.getOrchestrator().confirmEventDeletion(
          validated.data.eventId,
          validated.data.confirmationId
        );
        if (!result.ok) return unavailable();
        if (result.data.action !== "DELETE_EVENT") return unavailable();
        if (result.data.status === "SUCCEEDED") return { ok: true, data: { deleted: true } };
        if (result.data.errorCode === PLANNER_ERROR_CODES.notFound) {
          return { ok: false, error: { code: PLANNER_ERROR_CODES.notFound, userMessage: "El evento ya no está disponible." } };
        }
        return unavailable();
      } catch {
        dependencies.logError("Event deletion confirmation failed.");
        return unavailable();
      }
    },
    cancel: async (input) => {
      const validated = validateDecision(input);
      if (!validated.ok) return validated;
      try {
        const result = await dependencies.getOrchestrator().cancelEventDeletion(
          validated.data.eventId,
          validated.data.confirmationId
        );
        return result.ok && result.data.action === "DELETE_EVENT" && result.data.status === "CANCELLED"
          ? { ok: true, data: { cancelled: true } }
          : unavailable();
      } catch {
        dependencies.logError("Event deletion cancellation failed.");
        return unavailable();
      }
    }
  };
};

let eventDeletionService: EventDeletionService | undefined;
export const getEventDeletionService = (): EventDeletionService => {
  eventDeletionService ??= createEventDeletionService();
  return eventDeletionService;
};
