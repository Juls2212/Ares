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
import { GlassOrb } from "../src/renderer/components/glass-orb";
import { ColorSchemeButton } from "../src/renderer/features/settings/color-scheme-button";
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

const renderAppOrb = () => {
  const app = render("app", App);
  const props = find(app, AresView)!.props;
  const view = render("view", () => AresView(props));
  return render("orb", () => GlassOrb(find(view, GlassOrb)!.props));
};

const styles = readFileSync("src/renderer/styles/ares-glass.css", "utf8");
const rule = (selector: string): string => {
  const start = styles.indexOf(`${selector} {`);
  if (start < 0) throw new Error("Expected glass style rule is missing.");
  return styles.slice(start, styles.indexOf("}", start) + 1);
};

describe("compact shell regressions", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let trackStop: ReturnType<typeof vi.fn>;
  let root: { setAttribute: ReturnType<typeof vi.fn> };
  let theme: string;
  let recorderStart: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    hooks.values.clear();
    vi.useFakeTimers();
    theme = "light";
    root = { setAttribute: vi.fn((_name: string, value: string) => { theme = value; }) };
    trackStop = vi.fn();
    getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] }));
    recorderStart = vi.fn();
    vi.stubGlobal("document", { documentElement: root, hidden: false });
    vi.stubGlobal("window", {
      localStorage: { getItem: () => theme, setItem: vi.fn() },
      matchMedia: () => ({ matches: false })
    });
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

  it.each(["click", "Enter", "Space"])("starts recording once through the real orb callback on %s activation", async (activation) => {
    const orb = renderAppOrb();
    expect(orb.type).toBe("button");
    expect(orb.props.type).toBe("button");
    expect(orb.props.disabled).toBe(false);
    expect(orb.props["aria-label"]).toBe("Toca para hablar");
    // Native Enter/Space generate one click; no additional key handler may double-dispatch it.
    expect(orb.props.onKeyDown).toBeUndefined();
    orb.props.onClick({ type: "click", detail: activation === "click" ? 1 : 0 });
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(recorderStart).toHaveBeenCalledOnce();
    const listening = renderAppOrb();
    expect(listening.props["aria-label"]).toBe("Escuchando. Toca para cancelar");
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
    const orb = render("orb", () => GlassOrb(find(view, GlassOrb)!.props));
    expect(orb.props["aria-label"]).toBe("Hablando. Toca para detener");
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
    const orb = render("orb", () => GlassOrb(find(view, GlassOrb)!.props));
    expect(orb.props.disabled).toBe(true);
    orb.props.onClick();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("cycles the color schemes in both directions through the color button and the data-theme attribute", () => {
    for (const expectedScheme of ["blue", "green"]) {
      const app = render("app", App);
      find(app, ColorSchemeButton)!.props.onCycle();
      expect(theme).toBe(expectedScheme);
      expect(root.setAttribute).toHaveBeenLastCalledWith("data-theme", expectedScheme);
      expect(find(render("app", App), ColorSchemeButton)!.props.current.id).toBe(expectedScheme);
    }
  });

  it("uses theme-dependent glass, text, button, and focus tokens", () => {
    const light = rule(":root");
    const dark = rule(':root[data-theme="blue"]');
    for (const token of ["--ink", "--ink-2", "--glass-tint", "--card-tint", "--button-primary-bg", "--button-reinforced-bg", "--focus-ink", "--surface-opaque"]) {
      expect(light).toContain(`${token}:`);
      expect(dark).toContain(`${token}:`);
    }
    expect(rule(".ares-shell")).toContain("background-color: var(--glass-tint)");
    expect(rule(".command-response p")).toContain("color: var(--ink)");
    expect(rule(".glass-orb:focus-visible .glass-orb__ring")).toContain("opacity: 1");
    expect(rule(".glass-orb__ring")).toContain("border: 2px solid var(--focus-ink)");
  });

  it("keeps every decorative layer inert so only the orb button receives pointer input", () => {
    expect(rule(".ares-shell::after")).toContain("pointer-events: none");
    expect(rule(".command-glow")).toContain("pointer-events: none");
    expect(rule(".glass-orb__ring")).toContain("pointer-events: none");
    expect(rule(".command-text")).toContain("pointer-events: none");
    expect(rule(".command-response")).toContain("pointer-events: auto");
  });
});
