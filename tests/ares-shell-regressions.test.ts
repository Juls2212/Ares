import { type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise component callbacks and retained local state without a browser or mounted effects.
const hooks = vi.hoisted(() => ({ scope: "", index: 0, values: new Map<string, unknown[]>() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useCallback: (callback: unknown) => callback,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useState: (initial: unknown) => {
      const values = hooks.values.get(hooks.scope)!;
      const index = hooks.index++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      const values = hooks.values.get(hooks.scope)!;
      const index = hooks.index++;
      if (!(index in values)) values[index] = { current: initial };
      return values[index];
    }
  };
});

import { App } from "../src/renderer/app/App";
import { AresView } from "../src/renderer/views/ares-view";
import { ResponseSpeechControls } from "../src/renderer/features/voice/response-speech-controls";

const render = <T,>(scope: string, component: () => T): T => {
  hooks.scope = scope;
  hooks.index = 0;
  if (!hooks.values.has(scope)) hooks.values.set(scope, []);
  return component();
};

const find = (node: unknown, type: unknown): ReactElement<any> | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, type); if (match) return match; }
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<any>;
    if (element.type === type) return element;
    return find(element.props.children, type);
  }
};

/** The one microphone button of the view. */
const findMic = (node: unknown): ReactElement<any> | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) { const match = findMic(child); if (match) return match; }
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<any>;
    if (element.type === "button" && element.props.className === "mic") return element;
    return findMic(element.props.children);
  }
};

const renderAppOrb = () => {
  const app = render("app", App);
  const props = find(app, AresView)!.props;
  const view = render("view", () => AresView(props));
  return findMic(view)!;
};

const styles = readFileSync("src/renderer/styles/ares-hud.css", "utf8");
const rule = (selector: string): string => {
  const start = styles.indexOf(`${selector} {`);
  if (start < 0) throw new Error("Expected HUD style rule is missing.");
  return styles.slice(start, styles.indexOf("}", start) + 1);
};

describe("compact shell regressions", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let trackStop: ReturnType<typeof vi.fn>;
  let recorderStart: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    hooks.values.clear();
    vi.useFakeTimers();
    trackStop = vi.fn();
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] }));
    recorderStart = vi.fn();
    vi.stubGlobal("document", { documentElement: { setAttribute: vi.fn() }, hidden: false });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia }, userActivation: { isActive: true } });
    vi.stubGlobal("MediaRecorder", class {
      static isTypeSupported() { return true; }
      mimeType = "audio/webm";
      state = "inactive";
      onstop?: () => void;
      start() { this.state = "recording"; recorderStart(); }
      stop() { this.state = "inactive"; this.onstop?.(); }
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["click", "Enter", "Space"])("starts recording once through the real button callback on %s activation", async (activation) => {
    const orb = renderAppOrb();
    expect(orb.type).toBe("button");
    expect(orb.props.type).toBe("button");
    expect(orb.props.disabled).toBe(false);
    expect(orb.props["aria-label"]).toBe("Hablar con Ares");
    // Native Enter/Space generate one click; no additional key handler may double-dispatch it.
    expect(orb.props.onKeyDown).toBeUndefined();
    orb.props.onClick({ type: "click", detail: activation === "click" ? 1 : 0 });
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(recorderStart).toHaveBeenCalledOnce();
    const listening = renderAppOrb();
    // A second press now stops the recording and sends it, instead of cancelling.
    expect(listening.props["aria-label"]).toBe("Enviar lo que dije");
    listening.props.onClick();
    expect(trackStop).toHaveBeenCalledOnce();
    expect(renderAppOrb().props["data-state"]).toBe("idle");
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("keeps the existing acquisition guard against repeated idle clicks", async () => {
    const orb = renderAppOrb();
    orb.props.onClick();
    orb.props.onClick();
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(recorderStart).toHaveBeenCalledOnce();
    renderAppOrb().props.onClick();
  });

  it("uses the existing playback Stop reference without starting capture", () => {
    const app = render("app", App);
    const view = render("view", () => AresView({ ...find(app, AresView)!.props, orbState: "speaking" }));
    const stop = vi.fn();
    find(view, ResponseSpeechControls)!.props.stopRef.current = stop;
    const orb = findMic(view)!;
    expect(orb.props["aria-label"]).toBe("Detener voz");
    orb.props.onClick();
    expect(stop).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it.each(["processing", "acting"])("prevents recording through the rendered button during %s", (state) => {
    const app = render("app", App);
    const props = find(app, AresView)!.props;
    const view = render("view", () => AresView({
      ...props,
      voiceState: state === "processing" ? "PROCESSING" : "IDLE",
      draftStates: state === "acting" ? { 0: { busy: true, resolved: false } } : {}
    }));
    const orb = findMic(view)!;
    expect(orb.props.disabled).toBe(true);
    orb.props.onClick();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("has no color button, settings gear or other control next to the wordmark", () => {
    const app = render("app", App);
    const header = (JSON.stringify(app, (_key, value) => (typeof value === "function" ? undefined : value)).match(/"type":"header"[^]*?"type":"(?:main|section)"/u) ?? [""])[0];
    expect(header).not.toContain('"type":"button"');
    expect(readFileSync("src/renderer/app/App.tsx", "utf8")).not.toMatch(/ColorSchemeButton|useThemePreference|header-utilities/u);
  });

  it("styles every surface from the theme custom properties, never a fixed light or dark color", () => {
    for (const selector of [".ares-shell", ".hud__main", ".mic", ".review-card", ".hud__bar"]) {
      expect(rule(selector), selector).toMatch(/var\(--/u);
      expect(rule(selector), selector).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u);
    }
    expect(rule(".hud__response p")).toContain("color: var(--text)");
    expect(rule(".mic:focus-visible")).toContain("3px solid var(--accent2)");
  });

  it("keeps the decorative layers inert so only the button and the orb take pointer input", () => {
    expect(rule(".hex-background")).toContain("pointer-events: none");
    expect(rule(".review-layer[data-exiting]")).toContain("pointer-events: none");
    expect(rule(".mic")).toContain("-webkit-app-region: no-drag");
    expect(rule(".ares-header")).toContain("-webkit-app-region: drag");
  });
});
