import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { AresView } from "../src/renderer/views/ares-view";

/** The view must render before optional browser audio APIs are ever used. */
it("renders Ares without audio APIs or automatic speech requests", () => {
  const markup = renderToStaticMarkup(
    createElement(AresView, {
      technicalState: "SUCCESS",
      voiceLabel: "Listo para grabar",
      voiceState: "IDLE",
      orbState: "idle",
      isInterpreting: false,
      draftStates: {},
      onStartRecording: vi.fn(),
      onCancelRecording: vi.fn(),
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    })
  );

  expect(markup).toContain("Ares");
  expect(markup).toContain('aria-label="Hablar con Ares"');
  expect(markup).not.toContain("voice-button--microphone");
  expect(markup).not.toContain("voice-controls");
  expect(markup).toContain("Toca para hablar");
  expect(markup).not.toContain("Interpretar");
  expect(markup).not.toContain("assistant-instruction");
  expect(markup).not.toContain("textarea");
  expect(markup).toContain("particle-orb__fallback");
});
