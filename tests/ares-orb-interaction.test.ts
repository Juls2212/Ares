import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createGlobalVoiceShortcutController } from "../src/renderer/features/voice/global-voice-shortcut-controller";
import { bindRecordingCancellation } from "../src/renderer/features/voice/recording-cancellation";
import { AresView, createOrbInteraction, micLabelFor, shortcutCaption, stateLabelFor } from "../src/renderer/views/ares-view";
import type { OrbState } from "../src/renderer/orb/orb-runtime";

const callbacks = () => ({ start: vi.fn(), send: vi.fn(), stop: vi.fn() });
const viewProperties = {
  technicalState: "SUCCESS" as const,
  voiceLabel: "Listo para grabar",
  voiceState: "IDLE" as const,
  orbState: "idle" as const,
  isInterpreting: false,
  draftStates: {},
  onStartRecording: vi.fn(),
  onSendRecording: vi.fn(),
  onPropose: vi.fn(),
  onResolveConfirmation: vi.fn()
};

describe("single microphone button semantics", () => {
  it.each(["idle", "error"] as const)("starts the existing capture flow from %s", (state) => {
    const handlers = callbacks();
    const interaction = createOrbInteraction(state, handlers);
    interaction.activate();
    expect(interaction.disabled).toBe(false);
    expect(interaction.label).toBe("Hablar con Ares");
    expect(handlers.start).toHaveBeenCalledOnce();
    expect(handlers.send).not.toHaveBeenCalled();
    expect(handlers.stop).not.toHaveBeenCalled();
  });

  it("a second press while recording stops and SENDS what was recorded (it no longer cancels)", () => {
    const handlers = callbacks();
    const interaction = createOrbInteraction("recording", handlers);
    expect(interaction.label).toBe("Enviar lo que dije");
    expect(interaction.disabled).toBe(false);
    interaction.activate();
    expect(handlers.send).toHaveBeenCalledOnce();
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
    expect(handlers.send).not.toHaveBeenCalled();
  });

  it.each(["transcribing", "interpreting", "acting"] as const)("stays visibly disabled and silent during %s", (state) => {
    const handlers = callbacks();
    const interaction = createOrbInteraction(state, handlers);
    interaction.activate();
    expect(interaction.disabled).toBe(true);
    expect(interaction.label).toBe("Procesando");
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it("keeps action review exclusive without confirming anything through the button", () => {
    const handlers = callbacks();
    const interaction = createOrbInteraction("idle", handlers, true);
    interaction.activate();
    expect(interaction.disabled).toBe(true);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it("uses Spanish labels and state words for every state", () => {
    const states: OrbState[] = ["idle", "recording", "transcribing", "interpreting", "acting", "speaking", "error"];
    for (const state of states) {
      expect(micLabelFor(state)).toMatch(/^[A-ZÁÉÍÓÚ]/u);
      expect(stateLabelFor(state)).toMatch(/^[A-ZÁÉÍÓÚ]/u);
    }
    expect(states.map((state) => stateLabelFor(state))).toEqual(["Listo", "Escuchando", "Pensando", "Pensando", "Pensando", "Respondiendo", "Atención"]);
  });

  it("Escape still cancels and the global shortcut follows the same second-press rule as the button", () => {
    const cancel = vi.fn();
    const doc = new EventTarget();
    bindRecordingCancellation(doc, new EventTarget(), cancel);
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(cancel).toHaveBeenCalledOnce();
    const start = vi.fn();
    const send = vi.fn();
    for (const [state, expectedStart, expectedSend] of [["IDLE", 1, 0], ["RECORDING", 0, 1], ["PROCESSING", 0, 0]] as const) {
      start.mockClear(); send.mockClear();
      createGlobalVoiceShortcutController({ getState: () => state, startRecording: start, stopRecording: send }).activate();
      expect([start.mock.calls.length, send.mock.calls.length]).toEqual([expectedStart, expectedSend]);
    }
    const app = readFileSync("src/renderer/app/App.tsx", "utf8");
    expect(app).toContain("stopRecording: sendRecording");
    expect(app).toContain("if (voiceStateReference.current === \"RECORDING\") voiceRecorder.current?.stop();");
  });

  it("renders exactly one button, with a native focusable control and only decorative layers around the canvas", () => {
    const markup = renderToStaticMarkup(createElement(AresView, viewProperties));
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Hablar con Ares"');
    expect(markup).toContain('class="mic"');
    expect(markup).toContain("Toca el orbe para hablar");
    expect(markup).toContain('class="orb-stage"');
    expect(markup).toMatch(/aria-hidden="true" class="orb-stage"/u);
    for (const removed of ["voice-controls", "voice-button--microphone", "response-speech-controls", "textarea", "Interpretar", "Cambiar color", "glass-orb"]) {
      expect(markup).not.toContain(removed);
    }
  });

  it.each([
    ["RECORDING", "recording", "Enviar lo que dije", false],
    ["PROCESSING", "transcribing", "Procesando", true]
  ] as const)("preserves semantic %s state in the mounted shell", (voiceState, state, label, disabled) => {
    const markup = renderToStaticMarkup(createElement(AresView, { ...viewProperties, voiceState, orbState: state as OrbState }));
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup.includes('disabled=""')).toBe(disabled);
    expect(markup).toContain(`data-state="${state}"`);
  });

  it("shows the active shortcut as the caption, with the default when none is known", () => {
    expect(shortcutCaption(undefined)).toBe("CTRL + ALT + ESPACIO");
    expect(shortcutCaption("Atajo: Ctrl+Shift+Espacio")).toBe("CTRL + SHIFT + ESPACIO");
    expect(renderToStaticMarkup(createElement(AresView, viewProperties))).toContain("CTRL + ALT + ESPACIO");
  });

  it("returns dialog focus to the button and retains automatic playback cleanup", () => {
    const view = readFileSync("src/renderer/views/ares-view.tsx", "utf8");
    const playback = readFileSync("src/renderer/features/voice/response-speech-controls.tsx", "utf8");
    const review = readFileSync("src/renderer/features/assistant/interpretation-result.tsx", "utf8");
    expect(view).toContain("ref={micReference}");
    expect(view).toContain("returnFocusRef={micReference}");
    expect(review).toContain("returnFocusRef?.current?.focus()");
    expect(playback).toContain("stopRef.current = controller.stop");
    expect(playback).toContain("stopRef.current = undefined");
    expect(playback).toContain("if (headless || !response");
    expect(playback).toContain("enabled: true");
    expect(playback).toContain('document.addEventListener("keydown", escape)');
    expect(playback).toContain('window.removeEventListener("pagehide", controller.stop)');
  });
});
