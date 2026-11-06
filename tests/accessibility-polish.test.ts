import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AssistantInterpretation } from "../src/shared/assistant-contracts";
import type { AwaitingActionConfirmation } from "../src/shared/action-contracts";
import { orbAccessibleName, type OrbState } from "../src/renderer/components/orb-visuals";
import { InterpretationResult, REVIEW_CARD_EXIT_MS, type DraftActionState } from "../src/renderer/features/assistant/interpretation-result";
import { ContactFormDialog } from "../src/renderer/features/messaging/contact-form-dialog";
import { LIVE_RECORDING_LIMIT_MS } from "../src/renderer/features/voice/recording-limits";
import { VOICE_MAX_RECORDING_DURATION_MS } from "../src/shared/voice-contracts";
import { AresView, parseShortcutHint } from "../src/renderer/views/ares-view";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
const css = source("src/renderer/styles/ares-glass.css");

const viewProperties = {
  technicalState: "SUCCESS" as const,
  voiceLabel: "Listo para grabar",
  voiceState: "IDLE" as const,
  orbState: "idle" as OrbState,
  isInterpreting: false,
  draftStates: {},
  onStartRecording: vi.fn(),
  onCancelRecording: vi.fn(),
  onPropose: vi.fn(),
  onResolveConfirmation: vi.fn()
};
const statusRegion = (markup: string): string => /<div aria-atomic="true" aria-live="polite" class="sr-only" role="status">([^<]*)<\/div>/u.exec(markup)?.[1] ?? "<missing>";

describe("orb accessible names", () => {
  it("gives every state one Spanish name that says what activating the orb does", () => {
    const names: Array<[OrbState, string]> = [
      ["idle", "Toca para hablar"],
      ["recording", "Escuchando. Toca para cancelar"],
      ["transcribing", "Procesando"],
      ["interpreting", "Procesando"],
      ["acting", "Actuando"],
      ["speaking", "Hablando. Toca para detener"],
      ["error", "Error. Toca para reintentar"]
    ];
    for (const [state, name] of names) expect(orbAccessibleName(state)).toBe(name);
    expect(orbAccessibleName("idle", true)).toBe("Esperando tu confirmación");
  });

  it("keeps the orb a native button (Enter and Space) with a visible focus ring", () => {
    const markup = renderToStaticMarkup(createElement(AresView, viewProperties));
    expect(markup).toContain('aria-label="Toca para hablar"');
    expect(markup).toMatch(/<button type="button"/u);
    expect(css).toContain(".glass-orb:focus-visible .glass-orb__ring { opacity: 1; }");
    expect(css).toContain("border: 2px solid var(--focus-ink);");
  });
});

describe("live region", () => {
  it("renders a single polite status region and announces nothing at rest", () => {
    const markup = renderToStaticMarkup(createElement(AresView, viewProperties));
    expect(markup.match(/aria-live="polite"/gu)).toHaveLength(1);
    expect(statusRegion(markup)).toBe("");
    expect(markup).not.toContain('role="alert"');
  });

  it("announces the state while listening and processing", () => {
    expect(statusRegion(renderToStaticMarkup(createElement(AresView, { ...viewProperties, voiceState: "RECORDING", orbState: "recording" })))).toBe("Escuchando…");
    expect(statusRegion(renderToStaticMarkup(createElement(AresView, { ...viewProperties, voiceState: "PROCESSING", orbState: "transcribing" })))).toBe("Pensando…");
  });

  it("announces the final response once, as one text that does not change while it is revealed", () => {
    const spokenResponse = { responseId: "response-1", text: "Listo, abrí tu música." };
    const markup = renderToStaticMarkup(createElement(AresView, { ...viewProperties, spokenResponse }));
    expect(statusRegion(markup)).toBe(spokenResponse.text);
    expect(source("src/renderer/views/ares-view.tsx")).not.toMatch(/aria-live="polite"[^>]*>\{visibleCoreResponse/u);
  });

  it("does not announce the processed-instruction notice or an idle prompt when there is no response", () => {
    const processed = "Instrucción procesada. Revisa el resultado y confirma si se requiere.";
    expect(statusRegion(renderToStaticMarkup(createElement(AresView, { ...viewProperties, voiceMessage: processed })))).toBe("");
    expect(statusRegion(renderToStaticMarkup(createElement(AresView, { ...viewProperties })))).toBe("");
  });

  it("announces a notice through the same region and failures through an alert only", () => {
    expect(statusRegion(renderToStaticMarkup(createElement(AresView, { ...viewProperties, voiceMessage: "No se pudo acceder al micrófono." })))).toBe("No se pudo acceder al micrófono.");
    expect(source("src/renderer/views/ares-view.tsx")).toContain('{exclusiveCoreState === "FAILURE" && <p className="sr-only" role="alert">');
  });
});

const confirmation = (riskLevel: 2 | 3): AwaitingActionConfirmation => ({
  lifecycleState: "AWAITING_CONFIRMATION",
  actionId: "action-1",
  action: riskLevel === 3 ? "DELETE_FOUND_ITEM" : "OPEN_FOUND_FILE",
  riskLevel,
  confirmationId: "confirmation-1",
  confirmation: { required: true, summary: "Se abrirá el archivo.", affectedItemCount: 1, scopeSummary: "Resultado de búsqueda" }
});
const interpretation: AssistantInterpretation = { state: "READY", summary: "Preparé los borradores.", drafts: [{ action: "OPEN_FOUND_FILE", input: { ordinal: 1 } }], clarifications: [] };

describe("confirmation card semantics and focus", () => {
  const states: Record<number, DraftActionState> = { 0: { busy: false, resolved: true, confirmation: confirmation(2) } };
  const markup = renderToStaticMarkup(createElement(InterpretationResult, { interpretation, draftStates: states, onResolveConfirmation: vi.fn() }));
  const card = source("src/renderer/features/assistant/interpretation-result.tsx");

  it("is a modal dialog named by its title and described by the review summary", () => {
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="assistant-review-title"');
    expect(markup).toMatch(/aria-describedby="assistant-review-description assistant-review-summary-0"/u);
    expect(markup).toContain('id="assistant-review-summary-0"');
  });

  it("starts on Confirmar for a standard card and on Cancelar for a reinforced one, and returns focus to the orb", () => {
    expect(card).toContain("(reinforced ? cancelAction : confirmAction).current?.focus()");
    expect(card).toContain("returnFocusRef?.current?.focus()");
    expect(card).toContain("handleAssistantReviewDialogKey");
  });

  it("cancels with Escape only while it is open with a token, never twice, and never while busy", () => {
    expect(card).toContain('event.key === "Escape" && !event.defaultPrevented');
    expect(card).toContain("if (!isOpen) return;");
    expect(card).toContain("if (confirmationEntry?.state?.busy) return;");
    const onResolve = vi.fn();
    const noToken = renderToStaticMarkup(createElement(InterpretationResult, { interpretation, draftStates: { 0: { busy: false, resolved: true } }, onResolveConfirmation: onResolve }));
    expect(noToken).toBe("");
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("leaves through an inert, tokenless 200 ms exit that never delays the card state or the focus return", () => {
    expect(REVIEW_CARD_EXIT_MS).toBe(200);
    expect(card).toContain('aria-hidden="true" className="review-layer" data-exiting="" inert');
    expect(card).toContain('<button className="button-secondary" disabled tabIndex={-1} type="button">Cancelar</button>');
    const exitCss = css.match(/\.review-card\[data-exiting\] \{[^}]*\}/u)?.[0] ?? "";
    expect(exitCss).toContain("pointer-events: none");
    expect(exitCss).toContain("ares-card-out 200ms ease-in");
    expect(css).toMatch(/@keyframes ares-card-out \{ from \{ opacity: 1; transform: translateY\(0\); \} to \{ opacity: 0; transform: translateY\(16px\); \} \}/u);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.review-card\[data-exiting\] \{ animation: ares-fade-out 160ms ease-in both; \}/u);
    expect(css).toMatch(/@keyframes ares-fade-out \{ from \{ opacity: 1; \} to \{ opacity: 0; \} \}/u);
  });
});

describe("contact form", () => {
  const request = { displayName: "Ana" } as never;
  const markup = renderToStaticMarkup(createElement(ContactFormDialog, { request, onSubmit: vi.fn(), onCancel: vi.fn() }));
  const form = source("src/renderer/features/messaging/contact-form-dialog.tsx");

  it("labels every field, switches autocomplete off and shows no error until Main rejects the values", () => {
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-labelledby="contact-form-title"');
    expect(markup).toContain('aria-describedby="contact-form-description"');
    expect(markup.match(/autoComplete="off"|autocomplete="off"/gu)).toHaveLength(2);
    expect(markup.match(/<label/gu)).toHaveLength(2);
    expect(markup).not.toContain('role="alert"');
  });

  it("links the error to the number field and cancels with Escape, returning focus afterwards", () => {
    expect(form).toContain('aria-describedby={errorMessage ? "contact-form-error" : undefined}');
    expect(form).toContain('id="contact-form-error" role="alert"');
    expect(form).toContain('event.key === "Escape" && !event.defaultPrevented');
    expect(form).toContain('document.querySelector<HTMLElement>(".glass-orb")');
    expect(form).not.toMatch(/console\.|localStorage|sessionStorage/u);
  });
});

describe("targets and accessibility modes", () => {
  it("keeps every interactive control at least 24 px", () => {
    expect(css).toMatch(/\.color-button \{[^}]*width: 28px;\s*height: 28px;/u);
    expect(css).toMatch(/\.review-card button,[^{]*\{\s*height: 40px;/u);
    expect(css).toContain("gap: 8px; min-height: 28px; }");
    expect(css).toContain("width: 20px; height: 20px;");
  });

  it("covers the key caps and the exiting card in forced-colors and reduced-motion", () => {
    const forced = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forced).toContain(".shortcut-hint kbd");
    expect(forced).toContain(".review-card,");
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/u);
  });

  it("does not rely on color alone: the reinforced card keeps a 2 px border", () => {
    expect(css).toContain("border: 2px solid var(--card-reinforced-border)");
  });
});

describe("shortcut hint key caps", () => {
  it("parses the label and the keys, and falls back to plain text", () => {
    expect(parseShortcutHint("Atajo: Ctrl+Shift+Espacio")).toEqual({ label: "Atajo:", keys: ["Ctrl", "Shift", "Espacio"] });
    expect(parseShortcutHint("sin formato")).toEqual({ label: "", keys: [] });
    expect(parseShortcutHint(undefined)).toEqual({ label: "", keys: [] });
  });

  it("renders key caps while keeping the hint non-interactive, static and conditional", () => {
    const markup = renderToStaticMarkup(createElement(AresView, { ...viewProperties, shortcutHint: "Atajo: Ctrl+Alt+Espacio" }));
    expect(markup).toContain('class="shortcut-hint" role="note"');
    expect(markup.match(/<kbd>/gu)).toHaveLength(3);
    expect(markup).toContain("<kbd>Ctrl</kbd>");
    expect(markup).toContain("Atajo:");
    const hidden = renderToStaticMarkup(createElement(AresView, { ...viewProperties, shortcutHint: "Atajo: Ctrl+Alt+Espacio", spokenResponse: { responseId: "r", text: "Hola" } }));
    expect(hidden).not.toContain("shortcut-hint");
    const block = css.match(/\.shortcut-hint \{[^}]*\}/u)?.[0] ?? "";
    expect(block).toContain("pointer-events: none;");
    expect(block).not.toMatch(/animation|transition/u);
    expect(css).toMatch(/\.shortcut-hint kbd \{[^}]*var\(--kbd-bg\)[^}]*\}/u);
    expect(css).toMatch(/\.shortcut-hint kbd \{[^}]*var\(--kbd-border\)[^}]*\}/u);
  });
});

describe("recording limit, fonts and offline robustness", () => {
  it("allows 30 s live, below Main's 60 s bound, through one named constant", () => {
    expect(LIVE_RECORDING_LIMIT_MS).toBe(30_000);
    expect(LIVE_RECORDING_LIMIT_MS).toBeLessThan(VOICE_MAX_RECORDING_DURATION_MS);
    expect(source("src/renderer/app/App.tsx")).not.toMatch(/maximumDurationMs:\s*\d/u);
  });

  it("no longer mounts the settings panel or its gear button, and keeps the panel source", () => {
    const app = source("src/renderer/app/App.tsx");
    expect(app).not.toContain("<UtilityPanel");
    expect(app).not.toContain('aria-controls="utility-panel"');
    expect(app).toContain("<ColorSchemeButton");
    expect(existsSync(path.resolve(process.cwd(), "src/renderer/features/settings/utility-panel.tsx"))).toBe(true);
  });

  it("declares a bundled font only when its file exists, and never loads anything remotely", () => {
    const fontFile = path.resolve(process.cwd(), "src/renderer/assets/fonts/Figtree-Variable.woff2");
    if (!existsSync(fontFile)) expect(css).not.toContain("@font-face");
    else expect(css).toContain("Figtree-Variable.woff2");
    for (const file of ["src/renderer/styles/ares-glass.css", "src/renderer/main.tsx"]) expect(source(file)).not.toMatch(/https?:\/\//u);
  });
});
