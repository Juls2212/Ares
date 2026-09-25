import type { AssistantInterpretation } from "../../../shared/assistant-contracts";
import type { ActionSubmission, AwaitingActionConfirmation } from "../../../shared/action-contracts";
import { actionLabels } from "../../app/app-state";

export type DraftActionState = {
  busy: boolean;
  resolved: boolean;
  userMessage?: string;
  confirmation?: AwaitingActionConfirmation;
};

type InterpretationResultProperties = {
  interpretation?: AssistantInterpretation;
  draftStates: Record<number, DraftActionState>;
  onPropose: (index: number, draft: ActionSubmission) => void;
  onResolveConfirmation: (index: number, confirmation: AwaitingActionConfirmation, decision: "CONFIRM" | "CANCEL") => void;
};

export const InterpretationResult = ({ interpretation, draftStates, onPropose, onResolveConfirmation }: InterpretationResultProperties) => {
  if (!interpretation) return null;

  return <section aria-live="polite" className="interpretation-result">
    <p className="result-summary">{interpretation.summary}</p>
    {interpretation.clarifications.map((item, index) => <p className="clarification" key={`${item.question}-${index}`}>{item.question}</p>)}
    {interpretation.drafts.map((draft, index) => {
      const state = draftStates[index];
      return <article className="draft-row" key={`${draft.action}-${index}`}>
        <p>{actionLabels[draft.action]}</p>
        <div>
          <button className="text-button" disabled={state?.busy || state?.resolved} onClick={() => onPropose(index, draft)} type="button">{state?.busy ? "Procesando..." : "Proponer acción"}</button>
          {state?.confirmation && !state.busy && <>
            <button className="text-button" onClick={() => onResolveConfirmation(index, state.confirmation!, "CONFIRM")} type="button">Confirmar</button>
            <button className="quiet-button" onClick={() => onResolveConfirmation(index, state.confirmation!, "CANCEL")} type="button">Cancelar</button>
          </>}
        </div>
        {state?.userMessage && <p className="draft-message">{state.userMessage}</p>}
      </article>;
    })}
  </section>;
};
