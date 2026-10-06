import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AssistantInterpretation } from "../src/shared/assistant-contracts";
import type { AwaitingActionConfirmation } from "../src/shared/action-contracts";
import {
  describeActionReview,
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
  it("describes habit mutations without exposing identifiers", () => {
    expect(describeActionReview({ action: "CREATE_HABIT", input: { title: "Leer", frequency: "DAILY", targetCount: 1 } })).toBe("Se creará el hábito «Leer» (diario).");
    expect(describeActionReview({ action: "UPDATE_HABIT", input: { habitTitle: "Leer", title: "Leer más" } })).toBe("Se actualizará el hábito «Leer».");
    expect(describeActionReview({ action: "COMPLETE_HABIT", input: { habitTitle: "Leer" } })).toBe("Se marcará «Leer» como completado hoy.");
  });

  it("shows validated weekly schedule and routine details before a confirmation is proposed", () => {
    const routine = {
      action: "CREATE_WEEKLY_ROUTINE" as const,
      input: { scheduleTitle: "Universidad", title: "Cálculo", weekday: "MONDAY" as const, startTime: "08:00", endTime: "10:00" }
    };
    expect(describeActionReview(routine)).toBe("Se agregará «Cálculo» el lunes de 08:00 a 10:00 en «Universidad».");

    const markup = renderToStaticMarkup(createElement(InterpretationResult, {
      interpretation: { state: "READY", summary: "Preparé los borradores solicitados.", drafts: [routine], clarifications: [] },
      draftStates: {},
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    }));
    expect(markup).toContain("Se agregará «Cálculo» el lunes de 08:00 a 10:00 en «Universidad».");
    expect(markup).toContain("Proponer acción");
  });

  it("renders every expanded weekly block independently for review", () => {
    const shared = { scheduleTitle: "Universidad", title: "Gimnasio", startTime: "06:00", endTime: "07:00" };
    const markup = renderToStaticMarkup(createElement(InterpretationResult, {
      interpretation: {
        state: "READY",
        summary: "Preparé los borradores solicitados.",
        drafts: [
          { action: "CREATE_WEEKLY_ROUTINE", input: { ...shared, weekday: "TUESDAY" } },
          { action: "CREATE_WEEKLY_ROUTINE", input: { ...shared, weekday: "THURSDAY" } }
        ],
        clarifications: []
      },
      draftStates: {},
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    }));
    expect(markup).toContain("el martes de 06:00 a 07:00 en «Universidad»");
    expect(markup).toContain("el jueves de 06:00 a 07:00 en «Universidad»");
  });

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
