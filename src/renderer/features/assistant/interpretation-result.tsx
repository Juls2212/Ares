import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import type { AssistantInterpretation } from "../../../shared/assistant-contracts";
import type { ActionSubmission, AwaitingActionConfirmation } from "../../../shared/action-contracts";
import { actionLabels } from "../../app/app-state";

export type DraftActionState = {
  spokenResponse?: import("../../../shared/speech-contracts").SpokenResponse;
  busy: boolean;
  resolved: boolean;
  userMessage?: string;
  confirmation?: AwaitingActionConfirmation;
};

type InterpretationResultProperties = {
  interpretation?: AssistantInterpretation;
  draftStates: Record<number, DraftActionState>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onResolveConfirmation: (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL") => void;
};

type DialogKey = Pick<KeyboardEvent<HTMLDivElement>, "key" | "shiftKey" | "preventDefault">;
type Focusable = { focus: () => void } | null;

const weeklyDayLabels: Record<"MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY", string> = {
  MONDAY: "lunes",
  TUESDAY: "martes",
  WEDNESDAY: "miércoles",
  THURSDAY: "jueves",
  FRIDAY: "viernes",
  SATURDAY: "sábado",
  SUNDAY: "domingo"
};

/** Produces a review-only summary from already validated typed action input. */
export const describeActionReview = (draft: ActionSubmission): string | undefined => {
  switch (draft.action) {
    case "CREATE_WEEKLY_SCHEDULE":
      return `Se creará el horario «${draft.input.title}».`;
    case "UPDATE_WEEKLY_SCHEDULE":
      return `Se actualizará el horario «${draft.input.scheduleTitle}».`;
    case "CREATE_WEEKLY_ROUTINE":
      return `Se agregará «${draft.input.title}» el ${weeklyDayLabels[draft.input.weekday]} de ${draft.input.startTime} a ${draft.input.endTime} en «${draft.input.scheduleTitle}».`;
    case "UPDATE_WEEKLY_ROUTINE": {
      const day = draft.input.targetWeekday ? ` el ${weeklyDayLabels[draft.input.targetWeekday]}` : "";
      const time = draft.input.targetStartTime || draft.input.targetEndTime
        ? ` (${draft.input.targetStartTime ?? "…"} a ${draft.input.targetEndTime ?? "…"})`
        : "";
      return `Se actualizará «${draft.input.routineTitle}»${day}${time} en «${draft.input.scheduleTitle}».`;
    }
    case "CREATE_HABIT":
      return `Se creará el hábito «${draft.input.title}» (${draft.input.frequency === "DAILY" ? "diario" : "semanal"}).`;
    case "UPDATE_HABIT":
      return `Se actualizará el hábito «${draft.input.habitTitle}».`;
    case "COMPLETE_HABIT":
      return `Se marcará «${draft.input.habitTitle}» como completado hoy.`;
    default:
      return undefined;
  }
};

export const hasAssistantReview = (
  interpretation: AssistantInterpretation | undefined,
  draftStates: Record<number, DraftActionState>
): boolean => Boolean(interpretation?.drafts.some((draft, index) => {
  const confirmation = draftStates[index]?.confirmation;
  return confirmation?.lifecycleState === "AWAITING_CONFIRMATION"
    && confirmation.action === draft.action
    && confirmation.confirmation.required
    && confirmation.confirmationId.trim().length > 0;
}));

export const handleAssistantReviewDialogKey = (
  keyboardEvent: DialogKey,
  onEscape: () => void,
  first: Focusable,
  last: Focusable,
  active: unknown
): void => {
  if (keyboardEvent.key === "Escape") {
    keyboardEvent.preventDefault();
    onEscape();
    return;
  }
  if (keyboardEvent.key !== "Tab") return;
  if (keyboardEvent.shiftKey && active === first) {
    keyboardEvent.preventDefault();
    last?.focus();
  } else if (!keyboardEvent.shiftKey && active === last) {
    keyboardEvent.preventDefault();
    first?.focus();
  }
};

/** Keeps only action review and clarification controls outside the command dock. */
export const InterpretationResult = ({
  interpretation,
  draftStates,
  returnFocusRef,
  onResolveConfirmation
}: InterpretationResultProperties) => {
  const [dismissed, setDismissed] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const needsReview = hasAssistantReview(interpretation, draftStates);
  const isOpen = needsReview && !dismissed;
  const confirmationEntry = interpretation?.drafts
    .map((draft, index) => ({ draft, index, state: draftStates[index] }))
    .find((entry) => entry.state?.confirmation);
  const isBusy = Boolean(confirmationEntry?.state?.busy) || interpretation?.drafts.some((_draft, index) => draftStates[index]?.busy) === true;

  useEffect(() => { setDismissed(false); }, [interpretation]);

  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      if (isBusy) dialog.current?.focus();
      else firstAction.current?.focus();
      return;
    }
    if (wasOpen.current) returnFocusRef?.current?.focus();
    wasOpen.current = false;
  }, [isBusy, isOpen, returnFocusRef]);

  if (!isOpen || !interpretation) return null;

  const dismiss = (): void => setDismissed(true);
  const cancelConfirmation = (): void => {
    if (confirmationEntry?.state?.busy) return;
    if (confirmationEntry?.state?.confirmation && !confirmationEntry.state.busy) {
      onResolveConfirmation(confirmationEntry.index, confirmationEntry.state.confirmation, "CANCEL");
      return;
    }
    dismiss();
  };
  const getFocusables = (): HTMLButtonElement[] =>
    Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
  const handleKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>): void => {
    const focusables = getFocusables();
    handleAssistantReviewDialogKey(
      keyboardEvent,
      cancelConfirmation,
      focusables[0] ?? null,
      focusables.at(-1) ?? null,
      document.activeElement
    );
  };

  return <div className="assistant-review-backdrop">
    <div
      aria-describedby="assistant-review-description"
      aria-labelledby="assistant-review-title"
      aria-modal="true"
      className="assistant-review-dialog"
      onKeyDown={handleKeyDown}
      ref={dialog}
      role="dialog"
      tabIndex={-1}
    >
      <p className="eyebrow">Revisión necesaria</p>
      <h2 id="assistant-review-title">Revisa la acción</h2>
      <p id="assistant-review-description">Confirma solo los pasos que quieres que Ares realice.</p>
      {interpretation.drafts.map((draft, index) => {
        const state = draftStates[index];
        if (!state?.confirmation) return null;
        const reviewDetail = describeActionReview(draft);
        return <article className="assistant-review-action" key={`${draft.action}-${index}`}>
          <p>{actionLabels[draft.action]}</p>
          {reviewDetail && <p className="assistant-review-action__summary">{reviewDetail}</p>}
          {state?.confirmation && <>
            <p className="assistant-review-action__summary">{state.confirmation.confirmation.summary}</p>
            <p className="assistant-review-action__scope">{state.confirmation.confirmation.scopeSummary}</p>
            {state.busy ? <p role="status">Procesando…</p> : <div className="assistant-review-action__controls">
              <button onClick={() => onResolveConfirmation(index, state.confirmation!, "CONFIRM")} ref={firstAction} type="button">Confirmar</button>
              <button className="quiet-button" onClick={cancelConfirmation} type="button">Cancelar</button>
            </div>}
          </>}
        </article>;
      })}
    </div>
  </div>;
};
