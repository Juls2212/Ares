import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { bindSpeechCancellation, classifySpeechError, createBrowserSpeechAdapter, detectSpeechRecognition, speechStateLabels, type BrowserRecognition } from "../src/renderer/features/voice/browser-speech-adapter";
import { BrowserSpeechControls } from "../src/renderer/features/voice/browser-speech-controls";

const fixture = () => {
  class Recognition implements BrowserRecognition {
    lang = ""; continuous = true; interimResults = true; maxAlternatives = 0;
    onstart: BrowserRecognition["onstart"] = null; onend: BrowserRecognition["onend"] = null;
    onresult: BrowserRecognition["onresult"] = null; onerror: BrowserRecognition["onerror"] = null;
    start = vi.fn(() => this.onstart?.()); stop = vi.fn(); abort = vi.fn();
    constructor() { current = this; }
  }
  let current: Recognition;
  const onState = vi.fn(); const onText = vi.fn(); const clearTimer = vi.fn(); const onDiagnostic = vi.fn();
  const timers: (() => void)[] = [];
  const setTimer = vi.fn((callback: () => void) => { timers.push(callback); return timers.length as unknown as ReturnType<typeof setTimeout>; });
  const adapter = createBrowserSpeechAdapter({ recognitionConstructor: Recognition, onState, onText, clearTimer, setTimer, onDiagnostic });
  return { adapter, onState, onText, onDiagnostic, timers, clearTimer, setTimer, Recognition, get current() { return current!; } };
};

describe("optional supervised browser speech input", () => {
  it("classifies browser service failures and preserves their natural event ordering without retry", () => {
    const f = fixture(); f.adapter.start();
    f.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: "private text" } }] });
    f.current.onerror?.({ error: "network" });
    expect(f.onState).toHaveBeenLastCalledWith("SERVICE_UNAVAILABLE");
    expect(f.current.abort).not.toHaveBeenCalled();
    f.adapter.start(); expect(f.current.start).toHaveBeenCalledOnce();
    f.current.onend?.();
    expect(f.onDiagnostic.mock.calls.flat()).toEqual(["START_REQUEST", "START_EVENT", "RESULT_FINAL", "ERROR_NETWORK", "END_EVENT"]);
    expect(f.onText).not.toHaveBeenCalled();
    expect(JSON.stringify(f.onDiagnostic.mock.calls)).not.toContain("private text");
    expect(speechStateLabels.SERVICE_UNAVAILABLE).toBe("El reconocimiento de voz no está disponible en esta instalación. Puedes escribir tu instrucción.");
    expect(classifySpeechError("language-not-supported").state).toBe("UNAVAILABLE");
    expect(classifySpeechError("private browser detail")).toEqual({ state: "ERROR", diagnostic: "ERROR_OTHER" });
  });
  it("cleans a failed recognizer that never ends and keeps cancellation distinct from provider failure", () => {
    const f = fixture(); f.adapter.start(); f.current.onerror?.({ error: "network" });
    f.timers[1](); expect(f.current.abort).toHaveBeenCalledOnce(); expect(f.onText).not.toHaveBeenCalled();
    expect(f.onState).toHaveBeenLastCalledWith("SERVICE_UNAVAILABLE");
    const cancelled = fixture(); cancelled.adapter.start(); cancelled.adapter.cancel();
    expect(cancelled.onDiagnostic.mock.calls.flat()).toEqual(["START_REQUEST", "START_EVENT", "ABORT_REQUEST"]);
    expect(cancelled.onText).not.toHaveBeenCalled();
  });
  it("detects standard, prefixed, and unsupported capabilities without starting capture", () => {
    const f = fixture();
    expect(detectSpeechRecognition({ SpeechRecognition: f.Recognition })).toBe(f.Recognition);
    expect(detectSpeechRecognition({ webkitSpeechRecognition: f.Recognition })).toBe(f.Recognition);
    for (const scope of [undefined, {}, { SpeechRecognition: false }]) expect(detectSpeechRecognition(scope)).toBeUndefined();
    const onState = vi.fn(); const onText = vi.fn();
    const unsupported = createBrowserSpeechAdapter({ onState, onText, setTimer: vi.fn(), clearTimer: vi.fn() });
    unsupported.start(); expect(onState).toHaveBeenCalledWith("UNAVAILABLE"); expect(onText).not.toHaveBeenCalled();
    expect(f.onState).not.toHaveBeenCalled();
  });
  it("starts only explicitly, uses Spanish, and returns text only after recognition ends", () => {
    const f = fixture(); f.adapter.start(); f.adapter.start();
    expect(f.current.start).toHaveBeenCalledOnce(); expect(f.current.lang).toBe("es-CO");
    expect(f.current.continuous).toBe(false); expect(f.current.interimResults).toBe(false);
    f.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: "  Crea una tarea  " } }] });
    expect(f.onText).not.toHaveBeenCalled();
    f.adapter.stop(); expect(f.onState).toHaveBeenLastCalledWith("PROCESSING");
    f.current.onend?.(); expect(f.onText).toHaveBeenCalledWith("Crea una tarea");
    expect(f.clearTimer).toHaveBeenCalled(); expect(f.onState).toHaveBeenLastCalledWith("READY");
  });
  it("cancels or disposes without publishing text and ignores late browser callbacks", () => {
    for (const decision of ["cancel", "dispose"] as const) {
      const f = fixture(); f.adapter.start();
      const ended = f.current.onend;
      f.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: "Eliminar esta tarea" } }] });
      f.adapter[decision](); ended?.();
      expect(f.current.abort).toHaveBeenCalledOnce(); expect(f.onText).not.toHaveBeenCalled();
      expect(f.current.onresult).toBeNull();
    }
  });
  it("handles empty, permission, error, interruption and start failures with fixed messages", () => {
    const empty = fixture(); empty.adapter.start(); empty.current.onend?.();
    expect(empty.onState).toHaveBeenLastCalledWith("EMPTY");
    for (const [error, state] of [["not-allowed", "DENIED"], ["service-not-allowed", "DENIED"], ["aborted", "INTERRUPTED"], ["no-speech", "EMPTY"], ["network", "SERVICE_UNAVAILABLE"], ["audio-capture", "MICROPHONE_UNAVAILABLE"], ["private network error", "ERROR"]]) {
      const f = fixture(); f.adapter.start(); f.current.onerror?.({ error });
      expect(f.onState).toHaveBeenLastCalledWith(state); expect(f.onText).not.toHaveBeenCalled();
      expect(JSON.stringify(f.onState.mock.calls)).not.toContain("private");
    }
    const onState = vi.fn();
    const adapter = createBrowserSpeechAdapter({ recognitionConstructor: class { constructor() { throw new Error("private"); } } as never, onState, onText: vi.fn(), setTimer: vi.fn(), clearTimer: vi.fn() });
    adapter.start(); expect(onState).toHaveBeenCalledWith("UNAVAILABLE");
  });
  it("bounds capture, processing, text and single-flight state without retry", () => {
    const f = fixture(); f.adapter.start(); expect(f.setTimer).toHaveBeenCalledWith(expect.any(Function), 30_000);
    f.timers[0](); expect(f.current.stop).toHaveBeenCalledOnce();
    f.adapter.start(); expect(f.current.start).toHaveBeenCalledOnce();
    f.timers[1](); expect(f.onState).toHaveBeenLastCalledWith("INTERRUPTED"); expect(f.current.abort).toHaveBeenCalledOnce();
    const text = fixture(); text.adapter.start(); text.current.onresult?.({ results: [{ isFinal: true, 0: { transcript: "x".repeat(5000) } }] }); text.current.onend?.();
    expect(text.onText.mock.calls[0][0]).toHaveLength(2000);
  });
  it("cancels on Escape, hidden document, blur and closing and removes listeners", () => {
    const documentTarget = new EventTarget(); const windowTarget = new EventTarget(); let hidden = false; const cancel = vi.fn();
    const cleanup = bindSpeechCancellation(documentTarget, windowTarget, () => hidden, cancel);
    documentTarget.dispatchEvent(new Event("visibilitychange")); expect(cancel).not.toHaveBeenCalled();
    documentTarget.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    hidden = true; documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("blur")); windowTarget.dispatchEvent(new Event("pagehide"));
    expect(cancel).toHaveBeenCalledTimes(4);
    cleanup(); windowTarget.dispatchEvent(new Event("blur")); expect(cancel).toHaveBeenCalledTimes(4);
  });
  it("keeps the control semantic and Spanish and recognition separate from submission", () => {
    const markup = renderToStaticMarkup(createElement(BrowserSpeechControls, { blocked: false, onText: vi.fn(), onStateChange: vi.fn() }));
    expect(markup).toContain("Activar micrófono para dictar"); expect(markup).toContain('aria-pressed="false"'); expect(markup).toContain("no está disponible en esta instalación"); expect(markup).toContain("disabled");
    for (const state of ["LISTENING", "PROCESSING", "EMPTY", "UNAVAILABLE"] as const) expect(speechStateLabels[state]).not.toBe("");
    const sources = ["browser-speech-adapter.ts", "browser-speech-controls.tsx"].map(file => readFileSync(`src/renderer/features/voice/${file}`, "utf8")).join("\n");
    for (const forbidden of ["window.ares", "ipcRenderer", "node:", "electron", "openai", "../main", "actions.propose", "actions.confirm", "fetch("]) expect(sources).not.toContain(forbidden);
    const view = readFileSync("src/renderer/views/ares-view.tsx", "utf8");
    expect(view).not.toContain("BrowserSpeechControls"); expect(view).toContain("onSubmit={onInterpret}"); expect(view).toContain("onChange={(event) => onInstructionChange(event.target.value)}");
    const app = readFileSync("src/renderer/app/App.tsx", "utf8");
    expect(app).toContain("window.ares.assistant.interpret({ text: instruction })");
    expect(app).toContain("window.ares.actions.confirm(confirmation.confirmationId)");
    expect(app).toContain('{destination === "ARES" ? <AresView');
    expect(readFileSync("src/renderer/features/voice/browser-speech-controls.tsx", "utf8")).not.toContain("createBrowserSpeechAdapter");
  });
});
