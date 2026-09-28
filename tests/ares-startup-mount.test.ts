import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { AresView } from "../src/renderer/views/ares-view";

/** The view must render before optional browser audio APIs are ever used. */
it("renders Ares without audio APIs or automatic speech requests", () => {
  const markup = renderToStaticMarkup(
    createElement(AresView, {
      automaticSpeech: true,
      onAutomaticSpeechChange: vi.fn(),
      technicalState: "SUCCESS",
      voiceLabel: "Listo para grabar",
      voiceState: "IDLE",
      orbState: "idle",
      instruction: "",
      isInterpreting: false,
      draftStates: {},
      onInstructionChange: vi.fn(),
      onInterpret: vi.fn(),
      onStartRecording: vi.fn(),
      onCancelRecording: vi.fn(),
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    })
  );

  expect(markup).toContain("Ares");
  expect(markup).toContain("Iniciar grabación");
  expect(markup).toContain("Interpretar");
  expect(markup).toContain("particle-orb__fallback");
});
