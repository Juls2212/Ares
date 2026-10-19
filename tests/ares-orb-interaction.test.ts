import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { ParticleOrb, type ParticleOrbState } from "../src/renderer/components/particle-orb";
import { AresView, createOrbInteraction } from "../src/renderer/views/ares-view";

const callbacks = () => ({ start: vi.fn(), cancel: vi.fn(), stop: vi.fn() });
const viewProperties = {
  technicalState: "SUCCESS" as const,
  voiceLabel: "Listo para grabar",
  voiceState: "IDLE" as const,
  orbState: "idle" as const,
  isInterpreting: false,
  draftStates: {},
  onStartRecording: vi.fn(),
  onCancelRecording: vi.fn(),
  onPropose: vi.fn(),
  onResolveConfirmation: vi.fn()
};

describe("orb-only voice interaction", () => {
  it.each(["idle", "error"] as const)("starts the existing capture flow from %s", (state) => {
    const handlers = callbacks();
    const interaction = createOrbInteraction(state, handlers);
    interaction.activate();
    expect(interaction.disabled).toBe(false);
    expect(handlers.start).toHaveBeenCalledOnce();
    expect(handlers.cancel).not.toHaveBeenCalled();
    expect(handlers.stop).not.toHaveBeenCalled();
  });

  it("cancels listening without submitting or starting another recording", () => {
    const handlers = callbacks();
    const interaction = createOrbInteraction("recording", handlers);
    expect(interaction.label).toBe("Cancelar grabación");
    interaction.activate();
    expect(handlers.cancel).toHaveBeenCalledOnce();
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.stop).not.toHaveBeenCalled();
  });

  it("stops speaking through the existing playback controller", () => {
    const handlers = callbacks();
    const interaction = createOrbInteraction("speaking", handlers);
    expect(interaction.label).toBe("Detener voz");
    interaction.activate();
    expect(handlers.stop).toHaveBeenCalledOnce();
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.cancel).not.toHaveBeenCalled();
  });

  it.each(["transcribing", "interpreting", "acting"] as const)("prevents duplicate activation during %s", (state) => {
    const handlers = callbacks();
    const interaction = createOrbInteraction(state, handlers);
    interaction.activate();
    expect(interaction.disabled).toBe(true);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it("keeps action review exclusive without confirming anything through orb activation", () => {
    const handlers = callbacks();
    const interaction = createOrbInteraction("idle", handlers, true);
    interaction.activate();
    expect(interaction.disabled).toBe(true);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it("uses a native button for Enter/Space, with text and decorations inside it", () => {
    const markup = renderToStaticMarkup(createElement(ParticleOrb, {
      state: "speaking", label: "Toca para detener", accessibleLabel: "Detener voz",
      responseText: "Listo, abrí Spotify.", responsePhase: "REVEALING", onActivate: vi.fn()
    }));
    expect(markup).toMatch(/^<button type="button" aria-label="Detener voz"/);
    expect(markup).toContain("particle-orb__response--revealing");
    expect(markup).toContain("Listo, abrí Spotify.");
    expect(markup).toContain("Toca para detener");
    expect(markup).toMatch(/<span aria-hidden="true" class="particle-orb__response.*<\/button>$/);
    expect(markup).not.toContain("tabindex=\"-1\"");
  });

  it("renders only one primary control with no microphone, typed input, or external playback UI", () => {
    const markup = renderToStaticMarkup(createElement(AresView, viewProperties));
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Hablar con Ares"');
    expect(markup).toContain("Toca para hablar");
    for (const removed of ["voice-controls", "voice-button--microphone", "response-speech-controls", "command-instrument__speech", "textarea", "Interpretar"]) {
      expect(markup).not.toContain(removed);
    }
  });

  it.each([
    ["RECORDING", "recording", "Cancelar grabación", false],
    ["PROCESSING", "transcribing", "Ares está procesando", true]
  ] as const)("preserves semantic %s state in the mounted shell", (voiceState, state, label, disabled) => {
    const markup = renderToStaticMarkup(createElement(AresView, { ...viewProperties, voiceState, orbState: state as ParticleOrbState, voiceLevel: .7 }));
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup.includes('disabled=""')).toBe(disabled);
    expect(markup).toContain(`data-state="${state}"`);
    expect(markup).toContain(`data-voice-level="${voiceState === "RECORDING" ? "0.700" : "0.000"}"`);
  });

  it("returns dialog focus to the orb and retains automatic playback cleanup", () => {
    const view = readFileSync("src/renderer/views/ares-view.tsx", "utf8");
    const playback = readFileSync("src/renderer/features/voice/response-speech-controls.tsx", "utf8");
    const review = readFileSync("src/renderer/features/assistant/interpretation-result.tsx", "utf8");
    expect(view).toContain("controlRef={orbReference}");
    expect(view).toContain("returnFocusRef={orbReference}");
    expect(review).toContain("returnFocusRef?.current?.focus()");
    expect(playback).toContain("stopRef.current = controller.stop");
    expect(playback).toContain("stopRef.current = undefined");
    expect(playback).toContain("if (headless || !response");
    expect(playback).toContain("enabled: true");
    expect(playback).toContain('document.addEventListener("keydown", escape)');
    expect(playback).toContain('window.removeEventListener("pagehide", controller.stop)');
  });
});
