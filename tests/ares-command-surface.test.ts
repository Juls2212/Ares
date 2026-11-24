import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AresView } from "../src/renderer/views/ares-view";

describe("Ares command surface", () => {
  it("renders the command core without mounting planner-oriented side panels", () => {
    const markup = renderToStaticMarkup(createElement(AresView, {
      technicalState: "SUCCESS",
      voiceLabel: "Listo para grabar",
      voiceState: "IDLE",
      orbState: "idle",
      isInterpreting: false,
      draftStates: {},
      onStartRecording: vi.fn(),
      onSendRecording: vi.fn(),
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    }));
    const core = markup.indexOf("orb-stage");

    expect(core).toBeGreaterThan(-1);
    expect(markup).not.toContain("support-panel--left");
    expect(markup).not.toContain("support-panel--right");
    expect(markup).not.toContain("Resumen de hoy");
    expect(markup).not.toContain("Próximos eventos");
    expect(markup).not.toContain("Hábitos de hoy");
    expect(markup).toContain("Toca el orbe para hablar");
    expect(markup).toContain('aria-label="Hablar con Ares"');
    expect(markup).not.toContain("audio se enviará a OpenAI");
  });
});
