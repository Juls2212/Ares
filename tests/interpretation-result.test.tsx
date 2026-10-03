import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AssistantInterpretation } from "../src/shared/assistant-contracts";
import type { AwaitingActionConfirmation } from "../src/shared/action-contracts";
import {
  handleAssistantReviewDialogKey,
  hasAssistantReview,
  InterpretationResult
} from "../src/renderer/features/assistant/interpretation-result";

const readyInterpretation = (): AssistantInterpretation => ({
  state: "READY",
  summary: "Preparé los borradores solicitados.",
  drafts: [{ action: "CREATE_TASK", input: { title: "Tarea de prueba" } }],
  clarifications: []
});

const confirmation: AwaitingActionConfirmation = {
  lifecycleState: "AWAITING_CONFIRMATION",
  actionId: "action-1",
  action: "DELETE_EVENT",
  riskLevel: 3,
  confirmationId: "confirmation-1",
  confirmation: {
    required: true,
    summary: "Se eliminará permanentemente un evento.",
    affectedItemCount: 1,
    scopeSummary: "Evento existente"
  }
};

describe("assistant action review dialog", () => {
  it("keeps final conversational text out of the former result container", () => {
    const markup = renderToStaticMarkup(createElement(InterpretationResult, {
      interpretation: {
        state: "CONVERSATIONAL",
        summary: "Hola, Juli. Estoy muy bien, ¿en qué quieres que trabajemos hoy?",
        drafts: [],
        clarifications: []
      },
      draftStates: {},
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    }));

    expect(markup).toBe("");
  });

  it("renders pending action review and reinforced confirmation in an accessible dialog", () => {
    const onPropose = vi.fn();
    const onResolveConfirmation = vi.fn();
    const reviewMarkup = renderToStaticMarkup(createElement(InterpretationResult, {
      interpretation: readyInterpretation(),
      draftStates: {},
      onPropose,
      onResolveConfirmation
    }));
    const confirmationMarkup = renderToStaticMarkup(createElement(InterpretationResult, {
      interpretation: readyInterpretation(),
      draftStates: { 0: { busy: false, resolved: true, confirmation } },
      onPropose,
      onResolveConfirmation
    }));

    expect(reviewMarkup).toContain('role="dialog"');
    expect(reviewMarkup).toContain("Proponer acción");
    expect(reviewMarkup).toContain("Cancelar");
    expect(reviewMarkup).not.toContain("Preparé los borradores solicitados.");
    expect(confirmationMarkup).toContain("Confirmar");
    expect(confirmationMarkup).toContain("Se eliminará permanentemente un evento.");
  });

  it("does not open a dialog for an already resolved direct action", () => {
    const interpretation = readyInterpretation();
    const states = { 0: { busy: false, resolved: true, userMessage: "Listo, agregué la tarea." } };
    const markup = renderToStaticMarkup(createElement(InterpretationResult, {
      interpretation,
      draftStates: states,
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    }));

    expect(hasAssistantReview(interpretation, states)).toBe(false);
    expect(markup).toBe("");
  });

  it("keeps Escape cancellation and tab focus wrapping within the review dialog", () => {
    const preventDefault = vi.fn();
    const onEscape = vi.fn();
    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };

    handleAssistantReviewDialogKey({ key: "Escape", shiftKey: false, preventDefault }, onEscape, first, last, first);
    expect(onEscape).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();

    handleAssistantReviewDialogKey({ key: "Tab", shiftKey: false, preventDefault }, onEscape, first, last, last);
    expect(first.focus).toHaveBeenCalledOnce();
    handleAssistantReviewDialogKey({ key: "Tab", shiftKey: true, preventDefault }, onEscape, first, last, first);
    expect(last.focus).toHaveBeenCalledOnce();
  });
});
