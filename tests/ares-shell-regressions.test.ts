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
import { ParticleOrb } from "../src/renderer/components/particle-orb";
import { UtilityPanel } from "../src/renderer/features/settings/utility-panel";
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
  return render("orb", () => ParticleOrb(find(view, ParticleOrb)!.props));
};

const styles = readFileSync("src/renderer/styles/ares.css", "utf8");
const activeStyles = styles.slice(styles.lastIndexOf("/* The active voice shell"));
const rule = (selector: string): string => {
  const start = activeStyles.indexOf(`${selector} {`);
  if (start < 0) throw new Error("Expected active-shell style rule is missing.");
  return activeStyles.slice(start, activeStyles.indexOf("}", start) + 1);
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
    expect(orb.props["aria-label"]).toBe("Hablar con Ares");
    // Native Enter/Space generate one click; no additional key handler may double-dispatch it.
    expect(orb.props.onKeyDown).toBeUndefined();
    orb.props.onClick({ type: "click", detail: activation === "click" ? 1 : 0 });
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(recorderStart).toHaveBeenCalledOnce();
    const listening = renderAppOrb();
    expect(listening.props["aria-label"]).toBe("Cancelar grabación");
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
    const orb = render("orb", () => ParticleOrb(find(view, ParticleOrb)!.props));
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
    const orb = render("orb", () => ParticleOrb(find(view, ParticleOrb)!.props));
    expect(orb.props.disabled).toBe(true);
    orb.props.onClick();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("switches both directions through the existing settings handler and theme attribute", () => {
    for (const expectedTheme of ["dark", "light"]) {
      const app = render("app", App);
      find(app, "button")!.props.onClick();
      const openApp = render("app", App);
      const panel = render("settings", () => UtilityPanel(find(openApp, UtilityPanel)!.props));
      find(panel, "button")!.props.onClick();
      expect(theme).toBe(expectedTheme);
      expect(root.setAttribute).toHaveBeenLastCalledWith("data-theme", expectedTheme);
      expect(find(render("app", App), UtilityPanel)!.props.theme).toBe(expectedTheme);
      // Close the existing settings affordance before opening it for the next toggle.
      find(render("app", App), "button")!.props.onClick();
    }
  });

  it("uses theme-dependent glass, orb, text, and focus styles", () => {
    const dark = rule(":root .ares-shell.ares-glass-shell:has(.command-layout)");
    const light = rule(':root:not([data-theme="dark"]) .ares-shell.ares-glass-shell:has(.command-layout)');
    expect(dark).toContain("--glass-background: #101c2c");
    expect(light).toContain("--glass-background: #e7edf3");
    expect(dark).toContain("--glass-response: #f0f7ff");
    expect(light).toContain("--glass-response: #142c46");
    for (const token of ["--neural-primary-rgb", "--neural-focal-rgb", "--glass-wordmark", "--glass-state-text", "--glass-nucleus", "--glass-atmosphere", "--focus"]) {
      expect(dark).toContain(`${token}:`);
      expect(light).toContain(`${token}:`);
    }
    expect(dark).toContain("background-color: var(--glass-background)");
    expect(dark).toContain("background-image: var(--glass-atmosphere)");
    expect(rule(":root .ares-shell.ares-glass-shell:has(.command-layout) .particle-orb__response")).toContain("color: var(--glass-response)");
    expect(rule(":root .ares-shell.ares-glass-shell:has(.command-layout) .particle-orb:focus-visible")).toContain("outline: 2px solid var(--focus)");
  });

  it("overrides inherited decorative hit testing and keeps every orb layer inert", () => {
    expect(styles).toMatch(/\.command-core__visual\s*\{[^}]*pointer-events: none;/);
    expect(rule(":root .ares-shell.ares-glass-shell:has(.command-layout) .particle-orb")).toContain("pointer-events: auto");
    expect(activeStyles).toMatch(/\.command-core__visual,\s*:root[^{}]*\.particle-orb\s*\{\s*pointer-events: auto;/);
    expect(rule(":root .ares-shell.ares-glass-shell:has(.command-layout) .particle-orb > *")).toContain("pointer-events: none");
    expect(rule(":root .ares-shell.ares-glass-shell::before")).toContain("pointer-events: none");
  });
});
