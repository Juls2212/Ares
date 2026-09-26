import type { PlannerService } from "../planner/planner-service";

export type EventDeletionReference = { title: string; startAt?: string };
export type EventDeletionResolution =
  | { state: "RESOLVED"; eventId: string }
  | { state: "MISSING" | "AMBIGUOUS" | "UNAVAILABLE" };
export type ResolveEventDeletion = (reference: EventDeletionReference) => Promise<EventDeletionResolution>;

export const normalizeEventTitle = (title: string): string => title.normalize("NFC").trim().toLocaleLowerCase("es");

/** Resolves exact public titles in Main; no event records or IDs are sent to the provider. */
export const createEventDeletionResolver = (
  getService: () => Pick<PlannerService, "listEvents">
): ResolveEventDeletion => async (reference) => {
  try {
    const result = await getService().listEvents(
      reference.startAt ? { startAt: reference.startAt } : {}
    );
    if (!result.ok) return { state: "UNAVAILABLE" };
    const matches = result.data.items.filter((event) =>
      normalizeEventTitle(event.title) === normalizeEventTitle(reference.title) &&
      (!reference.startAt || Date.parse(event.startAt) === Date.parse(reference.startAt))
    );
    if (matches.length === 0) return { state: "MISSING" };
    if (matches.length !== 1) return { state: "AMBIGUOUS" };
    return { state: "RESOLVED", eventId: matches[0].id };
  } catch {
    return { state: "UNAVAILABLE" };
  }
};
