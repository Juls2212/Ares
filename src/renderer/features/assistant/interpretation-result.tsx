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

export type ReviewMode = "standard" | "reinforced";

/** Reinforced when any pending confirmation is the Main-classified level 3; standard otherwise; none without a token. */
export const getReviewMode = (
  interpretation: AssistantInterpretation | undefined,
  draftStates: Record<number, DraftActionState>
): ReviewMode | undefined => {
  if (!hasAssistantReview(interpretation, draftStates)) return undefined;
  return interpretation?.drafts.some((_draft, index) => draftStates[index]?.confirmation?.riskLevel === 3) ? "reinforced" : "standard";
};

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

/** How long the card takes to slide down and fade; it is already inert and tokenless while it leaves. */
export const REVIEW_CARD_EXIT_MS = 200;

type ReviewSnapshotArticle = {
  key: string;
  label: string;
  details: string[];
  scope: string;
  reinforced: boolean;
};
type ReviewSnapshot = { reinforced: boolean; articles: ReviewSnapshotArticle[] };

const ReviewEyebrow = ({ reinforced }: { reinforced: boolean }) => <div className="review-card__eyebrow">
  {reinforced && <>
    <svg aria-hidden="true" className="review-card__icon" focusable="false" viewBox="0 0 16 16"><path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" /><path d="M8 6v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /><circle cx="8" cy="12" fill="currentColor" r=".9" /></svg>
    <span className="review-card__sensitive">Acción sensible</span>
    <span aria-hidden="true">·</span>
  </>}
  <span>¿Confirmas?</span>
</div>;

const ReviewArticles = ({ articles }: { articles: ReviewSnapshotArticle[] }) => <div className="review-card__body">
  {articles.map((article, index) => <article className="review-card__action" data-reinforced={article.reinforced || undefined} key={article.key}>
    <p className="review-card__action-label">{article.label}</p>
    {article.details.map((detail, detailIndex) => <p className="review-card__summary" id={detailIndex === article.details.length - 1 ? `assistant-review-summary-${index}` : undefined} key={detailIndex}>{detail}</p>)}
    <p className="review-card__scope">{article.scope}</p>
  </article>)}
</div>;

/**
 * Keeps only action review controls outside the command dock. The card is a labelled dialog whose description is
 * the review summary; focus moves into it, stays inside it, and returns to the orb as soon as it closes. A closing
 * card is rendered inert for 200 ms so it can slide away without being interactive or delaying anything.
 */
export const InterpretationResult = ({
  interpretation,
  draftStates,
  returnFocusRef,
  onResolveConfirmation
}: InterpretationResultProperties) => {
  const [dismissed, setDismissed] = useState(false);
  const [leaving, setLeaving] = useState<ReviewSnapshot>();
  const dialog = useRef<HTMLDivElement>(null);
  const confirmAction = useRef<HTMLButtonElement>(null);
  const cancelAction = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const exitPending = useRef(false);
  const lastSnapshot = useRef<ReviewSnapshot | undefined>(undefined);
  const cancelHandler = useRef<() => void>(() => undefined);
  const reviewMode = getReviewMode(interpretation, draftStates);
  const needsReview = reviewMode !== undefined;
  const reinforced = reviewMode === "reinforced";
  const isOpen = needsReview && !dismissed;
  const confirmationEntry = interpretation?.drafts
    .map((draft, index) => ({ draft, index, state: draftStates[index] }))
    .find((entry) => entry.state?.confirmation);
  const isBusy = Boolean(confirmationEntry?.state?.busy) || interpretation?.drafts.some((_draft, index) => draftStates[index]?.busy) === true;

  const articles: ReviewSnapshotArticle[] = isOpen && interpretation
    ? interpretation.drafts.flatMap((draft, index) => {
        const state = draftStates[index];
        if (!state?.confirmation) return [];
        const reviewDetail = describeActionReview(draft);
        return [{
          key: `${draft.action}-${index}`,
          label: actionLabels[draft.action],
          details: [...(reviewDetail ? [reviewDetail] : []), state.confirmation.confirmation.summary],
          scope: state.confirmation.confirmation.scopeSummary,
          reinforced: state.confirmation.riskLevel === 3
        }];
      })
    : [];
  if (isOpen) lastSnapshot.current = { reinforced, articles };

  const dismiss = (): void => setDismissed(true);
  const cancelConfirmation = (): void => {
    if (confirmationEntry?.state?.busy) return;
    if (confirmationEntry?.state?.confirmation && !confirmationEntry.state.busy) {
      onResolveConfirmation(confirmationEntry.index, confirmationEntry.state.confirmation, "CANCEL");
      return;
    }
    dismiss();
  };
  cancelHandler.current = cancelConfirmation;

  useEffect(() => { setDismissed(false); }, [interpretation]);

  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      if (isBusy) dialog.current?.focus();
      // A reinforced confirmation starts on Cancelar; a standard one keeps starting on Confirmar.
      else (reinforced ? cancelAction : confirmAction).current?.focus();
      return;
    }
    if (wasOpen.current) returnFocusRef?.current?.focus();
    wasOpen.current = false;
  }, [isBusy, isOpen, reinforced, returnFocusRef]);

  // Escape cancels the card from anywhere while it is open; the dialog's own handler marks the event as handled.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) cancelHandler.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // The exit only lasts 200 ms and never touches the confirmation, the buttons or the focus return above.
  useEffect(() => {
    if (isOpen) {
      exitPending.current = true;
      setLeaving(undefined);
      return;
    }
    if (!exitPending.current || !lastSnapshot.current) return;
    exitPending.current = false;
    setLeaving(lastSnapshot.current);
    const timer = window.setTimeout(() => setLeaving(undefined), REVIEW_CARD_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen || !interpretation) {
    if (!leaving) return null;
    return <div aria-hidden="true" className="review-layer" data-exiting="" inert>
      <div className="review-card" data-exiting="" data-reinforced={leaving.reinforced || undefined}>
        <ReviewEyebrow reinforced={leaving.reinforced} />
        <ReviewArticles articles={leaving.articles} />
        <div className="review-card__controls">
          <button className="button-secondary" disabled tabIndex={-1} type="button">Cancelar</button>
          <button className="button-primary" disabled tabIndex={-1} type="button">Confirmar</button>
        </div>
      </div>
    </div>;
  }

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
  const describedBy = ["assistant-review-description", ...articles.map((_article, index) => `assistant-review-summary-${index}`)].join(" ");

  return <div className="review-layer">
    <div
      aria-describedby={describedBy}
      aria-labelledby="assistant-review-title"
      aria-modal="true"
      className="review-card"
      data-reinforced={reinforced || undefined}
      onKeyDown={handleKeyDown}
      ref={dialog}
      role="dialog"
      tabIndex={-1}
    >
      <ReviewEyebrow reinforced={reinforced} />
      <h2 className="sr-only" id="assistant-review-title">Revisa la acción</h2>
      <p className="sr-only" id="assistant-review-description">Confirma solo los pasos que quieres que Ares realice.</p>
      <ReviewArticles articles={articles} />
      {interpretation.drafts.map((draft, index) => {
        const state = draftStates[index];
        if (!state?.confirmation) return null;
        return state.busy
          ? <p className="review-card__busy" key={`${draft.action}-busy-${index}`} role="status">Procesando…</p>
          : <div className="review-card__controls" key={`${draft.action}-controls-${index}`}>
              <button className="button-secondary" onClick={cancelConfirmation} ref={cancelAction} type="button">Cancelar</button>
              <button className="button-primary" onClick={() => onResolveConfirmation(index, state.confirmation!, "CONFIRM")} ref={confirmAction} type="button">Confirmar</button>
            </div>;
      })}
    </div>
  </div>;
};
