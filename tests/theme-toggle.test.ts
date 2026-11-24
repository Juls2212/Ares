import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { ThemeToggle, oppositeTheme, themeToggleLabel } from "../src/renderer/features/theme/theme-toggle";
import { AresView, statusKindFor, stateLabelFor } from "../src/renderer/views/ares-view";

const css = readFileSync("src/renderer/styles/ares-hud.css", "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing rule ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("theme toggle button", () => {
  it.each([["dark", "Cambiar a modo claro", "light"], ["light", "Cambiar a modo oscuro", "dark"]] as const)(
    "renders in the %s theme with a Spanish name and tooltip that say what a press does",
    (mode, label, opposite) => {
      const markup = renderToStaticMarkup(createElement(ThemeToggle, { current: mode, onToggle: vi.fn() }));
      expect(markup).toContain(`aria-label="${label}"`);
      expect(markup).toContain(`title="${label}"`);
      expect(markup).toContain(`data-mode="${mode}"`);
      expect(markup).toContain('type="button"');
      expect(themeToggleLabel(mode)).toBe(label);
      expect(oppositeTheme(mode)).toBe(opposite);
    }
  );

  it("draws the reference frame and the technical bulb: chamfered polygon, faceted glass, circuit filament, three nodes, three base segments, four rays", () => {
    const markup = renderToStaticMarkup(createElement(ThemeToggle, { current: "dark", onToggle: vi.fn() }));
    expect(markup).toContain('viewBox="0 0 46 32"');
    expect(markup).toContain('points="7,.5 45.5,.5 45.5,25 39,31.5 .5,31.5 .5,7"');
    expect(markup).toContain('points="10,1.5 15,3.4 17.5,8 16,12.4 13.6,15 13.6,17 6.4,17 6.4,15 4,12.4 2.5,8 5,3.4"');
    expect(markup).toContain('d="M7.6 17V11.4L10 8.8L12.4 11.4V17"');
    expect(markup.match(/theme-toggle__node/gu)).toHaveLength(3);
    expect(markup).toContain('d="M6.6 19H13.4M7.2 20.9H12.8M8.3 22.8H11.7"');
    expect(markup).toContain('d="M1.2 3.2L-.4 1.6M18.8 3.2L20.4 1.6M-.2 8.6H-2M20.2 8.6H22"');
    expect(markup.match(/aria-hidden="true"/gu)!.length).toBeGreaterThanOrEqual(3);
  });

  it("calls the closed setter with the OPPOSITE explicit preference on a press", () => {
    for (const [mode, expected] of [["dark", "light"], ["light", "dark"]] as const) {
      const onToggle = vi.fn();
      const button = (ThemeToggle({ current: mode, onToggle }) as ReactElement<{ onClick: () => void; onKeyDown?: unknown }>);
      expect(button.type).toBe("button");
      button.props.onClick();
      expect(onToggle).toHaveBeenCalledExactlyOnceWith(expected);
      // A native button turns Enter and Space into one click; there is no extra key handler that could double-fire.
      expect(button.props.onKeyDown).toBeUndefined();
    }
  });

  it("is wired in App through window.ares.theme.setPreference with only the closed object, never reading the theme from Main", () => {
    const app = readFileSync("src/renderer/app/App.tsx", "utf8");
    expect(app).toContain("window.ares.theme.setPreference({ preference })");
    expect(app).toContain("<ThemeToggle current={themeName} onToggle={toggleTheme} />");
    expect(app).toContain("useThemeName()");
    const header = app.slice(app.indexOf('<header className="ares-header">'), app.indexOf("</header>"));
    expect(header.match(/<button|<ThemeToggle/gu)).toHaveLength(1);
  });

  it("shows the current theme with the bulb: off in dark, on in light, a 350 ms change and no rotation", () => {
    expect(rule(".theme-toggle__glass")).toContain("transition: fill 350ms");
    expect(rule(".theme-toggle__filament")).toContain("opacity: 0.35");
    expect(rule(".theme-toggle__rays")).toContain("opacity: 0");
    expect(rule('.theme-toggle[data-mode="light"] .theme-toggle__glass')).toContain("var(--toggle-glass-on)");
    expect(css).toContain('.theme-toggle[data-mode="light"] .theme-toggle__rays { opacity: 1; }');
    expect(css).toContain('.theme-toggle[data-mode="light"] .theme-toggle__bulb { filter: drop-shadow(0 0 3px var(--accent-strong)); }');
    const toggleCss = css.slice(css.indexOf("/* ---------- Theme toggle"), css.indexOf("/* ---------- Orb and status"));
    expect(toggleCss).not.toMatch(/rotate|@keyframes|animation:/u);
  });

  it("has hover glow, a 0.96 press, an accent2 2px focus ring offset by 3px, and no-drag inside the drag header", () => {
    expect(rule(".theme-toggle:hover .theme-toggle__poly")).toContain("drop-shadow(0 0 5px var(--accent-strong))");
    expect(rule(".theme-toggle:active")).toContain("scale(0.96)");
    expect(rule(".theme-toggle:focus-visible")).toContain("outline: 2px solid var(--accent2); outline-offset: 3px;");
    expect(rule(".theme-toggle")).toContain("-webkit-app-region: no-drag");
    expect(rule(".ares-header")).toContain("-webkit-app-region: drag");
    expect(rule(".ares-header")).toContain("env(titlebar-area-width, 100vw)");
  });

  it("changes instantly under reduced motion, and never hard-codes a color", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@keyframes hud-fade-in"));
    expect(reduced).toMatch(/\.theme-toggle__glass,[^}]*\{ transition: none; \}/u);
    const toggleCss = css.slice(css.indexOf("/* ---------- Theme toggle"), css.indexOf("/* ---------- Orb and status"));
    expect(toggleCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/u);
  });

  it("is simple under forced colors", () => {
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toContain(".theme-toggle { color: ButtonText; }");
  });
});

describe("error and clarification styling", () => {
  const base = {
    technicalState: "SUCCESS" as const, voiceLabel: "x", voiceState: "IDLE" as const, orbState: "idle" as const, isInterpreting: false,
    draftStates: {}, onStartRecording: vi.fn(), onSendRecording: vi.fn(), onPropose: vi.fn(), onResolveConfirmation: vi.fn()
  };
  const markupFor = (interpretation: unknown, spokenResponse = { responseId: "r", text: "¿Con quién quieres hablar?" }) =>
    renderToStaticMarkup(createElement(AresView, { ...base, interpretation: interpretation as never, spokenResponse }));

  it("decides the kind from the interpretation and the orb, never while busy or reviewing", () => {
    expect(statusKindFor({ orbState: "idle", busy: false, interpretationState: "UNAVAILABLE", reviewOpen: false })).toBe("error");
    expect(statusKindFor({ orbState: "error", busy: false, reviewOpen: false })).toBe("error");
    expect(statusKindFor({ orbState: "idle", busy: false, interpretationState: "NEEDS_CLARIFICATION", reviewOpen: false })).toBe("clarification");
    expect(statusKindFor({ orbState: "idle", busy: false, interpretationState: "NEEDS_CLARIFICATION", reviewOpen: true })).toBeUndefined();
    expect(statusKindFor({ orbState: "idle", busy: true, interpretationState: "UNAVAILABLE", reviewOpen: false })).toBeUndefined();
    for (const state of ["READY", "CONVERSATIONAL", "REJECTED", undefined]) expect(statusKindFor({ orbState: "idle", busy: false, interpretationState: state, reviewOpen: false })).toBeUndefined();
  });

  it("says it in words, not only in color: «Atención» for an error and «Pregunta» for a question", () => {
    const error = markupFor({ state: "UNAVAILABLE", summary: "x", drafts: [], clarifications: [] }, { responseId: "r", text: "No pude entenderte ahora." });
    expect(error).toContain('data-kind="error"');
    expect(error).toContain(">Atención<");
    const question = markupFor({ state: "NEEDS_CLARIFICATION", summary: "x", drafts: [], clarifications: [{ question: "¿Con quién?" }] });
    expect(question).toContain('data-kind="clarification"');
    expect(question).toContain(">Pregunta<");
    const plain = markupFor({ state: "READY", summary: "x", drafts: [], clarifications: [] });
    expect(plain).not.toContain("data-kind");
    expect(stateLabelFor("error")).toBe("Atención");
  });

  it("keeps the live region behavior: one polite region that announces the text, and no new alert", () => {
    const question = markupFor({ state: "NEEDS_CLARIFICATION", summary: "x", drafts: [], clarifications: [] });
    expect(question.match(/aria-live="polite"/gu)).toHaveLength(1);
    expect(question).toContain('class="sr-only" role="status">¿Con quién quieres hablar?</div>');
    expect(question).not.toContain('role="alert"');
  });

  it("styles the error as an amber label with one thin rule and the question with the accent2 tint, with no box and no side border", () => {
    expect(rule('.hud__status[data-kind="error"] .hud__state')).toContain("color: var(--label-error)");
    const rulePart = rule('.hud__status[data-kind="error"] .hud__state::after');
    expect(rulePart).toContain("height: 1px");
    expect(rulePart).toContain("background: var(--amber)");
    expect(rule('.hud__status[data-kind="clarification"] .hud__state')).toContain("color: var(--label-clarify)");
    const block = css.slice(css.indexOf('.hud__status[data-kind="error"] .hud__state {'), css.indexOf(".hud__main {"));
    expect(block).not.toMatch(/border|box-shadow|background-color|padding/u);
    expect(css).not.toMatch(/border-(?:left|right)\s*:\s*[2-9]px/u);
  });
});
