import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InterpretationResult } from "../src/renderer/features/assistant/interpretation-result";

describe("conversational interpretation result", () => {
  it("renders a completed conversational reply without a draft or confirmation control", () => {
    const markup = renderToStaticMarkup(
      createElement(InterpretationResult, {
        interpretation: {
          state: "CONVERSATIONAL",
          summary: "Hola, Juli. Estoy muy bien, ¿en qué quieres que trabajemos hoy?",
          drafts: [],
          clarifications: []
        },
        draftStates: {},
        onPropose: vi.fn(),
        onResolveConfirmation: vi.fn()
      })
    );

    expect(markup).toContain("Hola, Juli. Estoy muy bien, ¿en qué quieres que trabajemos hoy?");
    expect(markup).not.toContain("Proponer acción");
    expect(markup).not.toContain("Confirmar");
  });
});
