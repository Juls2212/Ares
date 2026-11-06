import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { InterpretationResult, getReviewMode, type DraftActionState } from "../src/renderer/features/assistant/interpretation-result";
import { ContactFormDialog } from "../src/renderer/features/messaging/contact-form-dialog";
import { ORB_VISUALS, ORB_VISUALS_BLUE, PALETTE } from "../src/renderer/components/orb-visuals";
import type { AssistantInterpretation } from "../src/shared/assistant-contracts";
import type { AwaitingActionConfirmation } from "../src/shared/action-contracts";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
const css = source("src/renderer/styles/ares-glass.css");

const blockOf = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing block ${selector}`);
  return css.slice(start, css.indexOf("\n}", start));
};
const tokensOf = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2].trim()]));
const light = tokensOf(blockOf(":root"));
const dark = { ...light, ...tokensOf(blockOf(':root[data-theme="blue"]')) };

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];
const parseColor = (value: string): Rgba => {
  const hex = /^#([0-9a-f]{6})$/iu.exec(value);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1];
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/u.exec(value);
  if (!rgba) throw new Error(`Unparseable color ${value}`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
};
const over = (top: Rgba, bottom: Rgb): Rgb =>
  [0, 1, 2].map((index) => top[index] * top[3] + bottom[index] * (1 - top[3])) as unknown as Rgb;
const luminance = (color: Rgb): number => {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb): number => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const solid = (value: string): Rgb => parseColor(value).slice(0, 3) as unknown as Rgb;

describe("theme tokens", () => {
  it("defines the specified values for both themes", () => {
    expect(light).toMatchObject({
      "--ink": "#06201F",
      "--ink-2": "#1F4A4A",
      "--glass-tint": "rgba(236, 246, 241, 0.9)",
      "--glass-top": "rgba(251, 254, 252, 0.92)",
      "--glass-bottom": "rgba(222, 238, 230, 0.92)",
      "--glass-edge": "rgba(255, 255, 255, 0.78)",
      "--glow-alpha": "0.22",
      "--card-tint": "rgba(240, 248, 245, 0.88)",
      "--button-primary-bg": "#003333",
      "--button-primary-ink": "#F2FAF6",
      "--button-reinforced-bg": "#0F2A33",
      "--button-reinforced-ink": "#FFFFFF",
      "--surface-opaque": "#E4EEEA"
    });
    expect(dark).toMatchObject({
      "--ink": "#EAF3F8",
      "--ink-2": "#B7CBD8",
      "--glass-tint": "rgba(10, 26, 38, 0.9)",
      "--glass-top": "rgba(14, 34, 50, 0.9)",
      "--glass-bottom": "rgba(7, 20, 31, 0.92)",
      "--glass-edge": "rgba(255, 255, 255, 0.14)",
      "--glow-alpha": "0.24",
      "--card-tint": "rgba(14, 36, 52, 0.92)",
      "--button-primary-bg": "#BFD9E6",
      "--button-primary-ink": "#0B1C26",
      "--button-reinforced-bg": "#A5C8CC",
      "--button-reinforced-ink": "#0F2A33",
      "--surface-opaque": "#0B1A24"
    });
    expect(light["--button-secondary-bg"]).toBe("rgba(6, 32, 31, 0.07)");
    expect(light["--button-secondary-border"]).toBe("rgba(6, 32, 31, 0.12)");
    expect(light["--focus-halo"]).toBe("rgba(2, 124, 104, 0.25)");
    expect(dark["--focus-halo"]).toBe("rgba(47, 130, 196, 0.3)");
    expect(css).toContain("border: 2px solid var(--focus-ink)");
  });

  it("keeps the theme mechanism: the same data-theme attribute and the existing toggle storage", () => {
    expect(css).toContain(':root[data-theme="blue"]');
    expect(source("src/renderer/features/settings/theme-preference.ts")).toContain('root.setAttribute("data-theme", scheme.id)');
    expect(source("src/renderer/main.tsx")).toContain("initializeThemePreference(document.documentElement");
    expect(source("src/renderer/main.tsx")).toContain('import "./styles/ares-glass.css"');
    expect(source("src/renderer/main.tsx")).not.toContain("ares.css\"");
  });

  it("leaves no navy, cyan, coral, magenta, amber, violet or wine value or variable behind", () => {
    const withoutNoise = css.replace(/url\("data:[^"]*"\)/gu, "");
    expect(withoutNoise).not.toMatch(/--(?:neural|core|glass-background|glass-atmosphere|glass-response|glass-nucleus|cyan|navy|command|accent-rgb)/u);
    for (const old of ["#FF6B57", "#E2468F", "#FFB547", "#8E5BEF", "#FF8FA8", "#A3264A", "#A8999F", "#2B1D22", "#FBF3F1", "#101c2c", "#e7edf3", "#0081a6", "#2fcbed"]) {
      expect(withoutNoise.toLowerCase()).not.toContain(old.toLowerCase());
    }
    const orbSource = source("src/renderer/components/orb-visuals.ts") + source("src/renderer/components/glass-orb.tsx");
    for (const old of ["#FF6B57", "#E2468F", "#FFB547", "#8E5BEF", "#FF8FA8", "#A3264A", "#F0705E", "#F25A55"]) {
      expect(orbSource.toLowerCase()).not.toContain(old.toLowerCase());
    }
  });

  it("uses no color outside the palette family", () => {
    const allowedHex = new Set([
      ...Object.values(PALETTE),
      "#1E8C7E", "#0A9A6B", "#1B6F73", "#3AA38A", "#1F5A60", "#9DB3B0", "#849C9A", "#BFD0CC", "#8FA6AB", "#8AA09D",
      "#06201F", "#1F4A4A", "#EAF3F8", "#B7CBD8", "#F2FAF6", "#BFD9E6", "#0B1C26", "#0C3355", "#0D2A47", "#154B7A", "#0B2A44", "#8DA2AD", "#7890A0", "#B4C5CE", "#8499A8", "#FFFFFF", "#E4EEEA", "#0B1A24", "#EDF5F2", "#102532"
    ].map((value) => value.toUpperCase()));
    const allowedRgb = new Set([
      "233,244,240", "255,255,255", "6,32,31", "15,42,51", "236,246,241", "251,254,252", "222,238,230", "10,26,38", "14,34,50", "7,20,31",
      "14,36,52", "8,26,40", "2,124,104", "165,200,204", "47,130,196", "240,248,245", "234,243,248", "0,0,0"
    ]);
    const scanned = css.replace(/url\("data:[^"]*"\)/gu, "");
    for (const [hex] of scanned.matchAll(/#[0-9a-fA-F]{6}\b/gu)) expect(allowedHex.has(hex.toUpperCase()), hex).toBe(true);
    for (const [, channels] of scanned.matchAll(/rgba?\((\d+,\s*\d+,\s*\d+)/gu)) expect(allowedRgb.has(channels.replace(/\s/gu, "")), channels).toBe(true);
    const tsColors = source("src/renderer/components/orb-visuals.ts").matchAll(/"(#[0-9A-Fa-f]{6})"/gu);
    for (const [, hex] of tsColors) expect(allowedHex.has(hex.toUpperCase()), hex).toBe(true);
    for (const visual of [...Object.values(ORB_VISUALS), ...Object.values(ORB_VISUALS_BLUE)]) for (const color of [...visual.colors, visual.base, visual.glow]) expect(allowedHex.has(color.toUpperCase()), color).toBe(true);
  });
});

describe("measured contrast", () => {
  // Worst case: the darkest light tint (bottom) over a black wallpaper, and the lightest dark tint (top) over a white one.
  const lightGlass = over(parseColor(light["--glass-bottom"]), [0, 0, 0]);
  const darkGlass = over(parseColor(dark["--glass-top"]), [255, 255, 255]);

  it("keeps ink at least 7:1 and ink-2 at least 4.5:1 over the glass in the worst case", () => {
    expect(contrast(solid(light["--ink"]), lightGlass)).toBeGreaterThanOrEqual(7);
    expect(contrast(solid(light["--ink-2"]), lightGlass)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(solid(dark["--ink"]), darkGlass)).toBeGreaterThanOrEqual(7);
    expect(contrast(solid(dark["--ink-2"]), darkGlass)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring at least 3:1 against the glass in the worst case", () => {
    expect(contrast(solid(light["--focus-ink"]), lightGlass)).toBeGreaterThanOrEqual(3);
    expect(contrast(solid(dark["--focus-ink"]), darkGlass)).toBeGreaterThanOrEqual(3);
  });

  it("keeps text readable on the cards in the worst case", () => {
    const lightCard = over(parseColor(light["--card-tint"]), lightGlass);
    const darkCard = over(parseColor(dark["--card-tint"]), darkGlass);
    const lightReinforced = over(parseColor(light["--card-reinforced-tint"]), lightGlass);
    const darkReinforced = over(parseColor(dark["--card-reinforced-tint"]), darkGlass);
    for (const [ink, ink2, surface] of [
      [light["--ink"], light["--ink-2"], lightCard],
      [dark["--ink"], dark["--ink-2"], darkCard],
      [light["--ink"], light["--ink-2"], lightReinforced],
      [dark["--ink"], dark["--ink-2"], darkReinforced]
    ] as const) {
      expect(contrast(solid(ink), surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(solid(ink2), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the primary buttons at least 11:1 and the reinforced buttons at least 8:1", () => {
    for (const tokens of [light, dark]) {
      expect(contrast(solid(tokens["--button-primary-ink"]), solid(tokens["--button-primary-bg"]))).toBeGreaterThanOrEqual(11);
      expect(contrast(solid(tokens["--button-reinforced-ink"]), solid(tokens["--button-reinforced-bg"]))).toBeGreaterThanOrEqual(8);
    }
  });

  it("uses no reduced-opacity text", () => {
    for (const selector of [".command-text__label", ".command-text__sub", ".command-response p", ".review-card__summary", ".review-card__scope", ".shortcut-hint", ".wordmark"]) {
      expect(blockOf(selector)).not.toMatch(/opacity\s*:/u);
      expect(blockOf(selector)).not.toMatch(/color:\s*rgba/u);
    }
  });
});

describe("network and fonts", () => {
  it("loads nothing from the network", () => {
    const sources = [css, source("src/renderer/index.html"), source("src/renderer/main.tsx"), source("src/renderer/components/glass-orb.tsx"), source("src/renderer/views/ares-view.tsx")].join("\n");
    expect(sources).not.toMatch(/https?:\/\//u);
    expect(sources).not.toMatch(/@import|fonts\.googleapis|fonts\.gstatic|<link[^>]+href=/u);
    expect(css).not.toMatch(/url\(/u);
  });

  it("uses the specified stack and only wires Figtree when the font file exists", () => {
    expect(light["--font-family"]).toBe('Figtree, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif');
    const fontPath = path.resolve(process.cwd(), "src/renderer/assets/fonts/Figtree-Variable.woff2");
    let exists = true;
    try { readFileSync(fontPath); } catch { exists = false; }
    if (exists) {
      expect(css).toContain("@font-face");
      expect(css).toContain("font-display: swap");
    } else {
      expect(css).not.toContain("@font-face");
    }
  });
});

describe("window material layers in the page", () => {
  it("leaves html and body transparent so the material shows, and paints the tint inside the shell", () => {
    const base = blockOf("html,\nbody,\n#root");
    expect(base).toContain("background: transparent");
    expect(blockOf(".ares-shell")).toContain("background-color: var(--glass-tint)");
    expect(blockOf(".ares-shell")).toContain("background-image: var(--glass-fill)");
    expect(blockOf(".ares-shell::after")).toContain("var(--glass-sheen)");
    expect(blockOf(".ares-shell::after")).toContain("var(--glass-inner-glow)");
    expect(blockOf(".ares-shell::after")).not.toMatch(/noise|blend-mode|url\(/u);
    expect(css).not.toMatch(/backdrop-filter:\s*blur\(30px\)/u);
    expect(blockOf(".review-card")).toContain("backdrop-filter: var(--material-blur-card)");
    expect(blockOf(":root")).toContain("--material-blur-card: blur(24px) saturate(160%)");
  });
});

const confirmation = (riskLevel: 2 | 3, action: "DELETE_FOUND_ITEM" | "OPEN_FOUND_FILE" = "OPEN_FOUND_FILE"): AwaitingActionConfirmation => ({
  lifecycleState: "AWAITING_CONFIRMATION",
  actionId: "action-1",
  action,
  riskLevel,
  confirmationId: "confirmation-1",
  confirmation: { required: true, summary: "Se enviará un resultado a la Papelera.", affectedItemCount: 1, scopeSummary: "Resultado de búsqueda" }
});

const interpretationFor = (action: "DELETE_FOUND_ITEM" | "OPEN_FOUND_FILE"): AssistantInterpretation => ({
  state: "READY",
  summary: "Preparé los borradores solicitados.",
  drafts: [{ action, input: { ordinal: 1 } }],
  clarifications: []
});

describe("confirmation card", () => {
  const render = (riskLevel: 2 | 3, withToken = true) => {
    const action = riskLevel === 3 ? "DELETE_FOUND_ITEM" : "OPEN_FOUND_FILE";
    const states: Record<number, DraftActionState> = { 0: { busy: false, resolved: true, ...(withToken ? { confirmation: confirmation(riskLevel, action) } : {}) } };
    return renderToStaticMarkup(createElement(InterpretationResult, { interpretation: interpretationFor(action), draftStates: states, onResolveConfirmation: vi.fn() }));
  };

  it("shows Cancelar and Confirmar only when a Main-issued confirmation exists", () => {
    const issued = render(2);
    expect(issued).toContain("Confirmar");
    expect(issued).toContain("Cancelar");
    expect(issued.indexOf("Cancelar")).toBeLessThan(issued.indexOf("Confirmar"));
    expect(render(2, false)).toBe("");
    const pending: Record<number, DraftActionState> = { 0: { busy: false, resolved: false } };
    expect(renderToStaticMarkup(createElement(InterpretationResult, { interpretation: interpretationFor("OPEN_FOUND_FILE"), draftStates: pending, onResolveConfirmation: vi.fn() }))).toBe("");
    expect(getReviewMode(interpretationFor("OPEN_FOUND_FILE"), {})).toBeUndefined();
  });

  it("marks a reinforced confirmation without color: a sensitive-action line with an icon, and a distinct border and fill", () => {
    const standard = render(2);
    const reinforced = render(3);
    expect(reinforced).toContain("Acción sensible");
    expect(reinforced).toContain('data-reinforced="true"');
    expect(reinforced).toMatch(/<svg aria-hidden="true" class="review-card__icon"/u);
    expect(reinforced).toContain("¿Confirmas?");
    expect(standard).not.toContain("Acción sensible");
    expect(standard).not.toContain("data-reinforced");
    const card = blockOf('.review-card[data-reinforced]');
    expect(card).toContain("border: 2px solid var(--card-reinforced-border)");
    expect(card).toContain("background-color: var(--card-reinforced-tint)");
    expect(blockOf(".review-card")).toContain("border: 1px solid var(--card-edge)");
    expect(light["--card-reinforced-tint"]).not.toBe(light["--card-tint"]);
    expect(dark["--card-reinforced-tint"]).not.toBe(dark["--card-tint"]);
    expect(blockOf('.review-card[data-reinforced] .button-primary')).toContain("var(--button-reinforced-bg)");
  });

  it("derives the review mode from the Main classification", () => {
    expect(getReviewMode(interpretationFor("OPEN_FOUND_FILE"), { 0: { busy: false, resolved: true, confirmation: confirmation(2) } })).toBe("standard");
    expect(getReviewMode(interpretationFor("DELETE_FOUND_ITEM"), { 0: { busy: false, resolved: true, confirmation: confirmation(3, "DELETE_FOUND_ITEM") } })).toBe("reinforced");
  });

  it("starts focus on Cancelar for a reinforced confirmation and keeps Confirmar for a standard one", () => {
    const review = source("src/renderer/features/assistant/interpretation-result.tsx");
    expect(review).toContain("(reinforced ? cancelAction : confirmAction).current?.focus()");
    expect(review).toContain("ref={cancelAction}");
    expect(review).toContain("ref={confirmAction}");
    expect(review).toContain("returnFocusRef?.current?.focus()");
    expect(review).toContain('onResolveConfirmation(index, state.confirmation!, "CONFIRM")');
    expect(review).toContain('keyboardEvent.key === "Escape"');
  });

  it("bounds the card, scrolls its body internally and never lets it push the orb off screen", () => {
    expect(blockOf(".review-card")).toContain("max-height: 56cqh");
    expect(blockOf(".review-card__body")).toContain("overflow-y: auto");
    expect(blockOf(".review-card__body")).toContain("min-height: 0");
    expect(blockOf(".review-card__controls")).toContain("flex: 0 0 auto");
    expect(blockOf(".review-card__summary")).toContain("overflow-wrap: anywhere");
    expect(blockOf(".command-layout[data-card] .command-orb")).toContain("top: 27%");
    expect(blockOf(".command-response")).toContain("overflow-y: auto");
    expect(blockOf(".command-response")).toContain("max-height: 100%");
    expect(blockOf(".command-text")).toContain("bottom: 14cqw");
  });

  it("states the exact long message text without truncation", () => {
    const long = "a".repeat(1000);
    const states: Record<number, DraftActionState> = {
      0: { busy: false, resolved: true, confirmation: { ...confirmation(2), confirmation: { required: true, summary: `Se abrirá un chat con este mensaje: «${long}».`, affectedItemCount: 1, scopeSummary: "Chat de WhatsApp" } } }
    };
    const markup = renderToStaticMarkup(createElement(InterpretationResult, { interpretation: interpretationFor("OPEN_FOUND_FILE"), draftStates: states, onResolveConfirmation: vi.fn() }));
    expect(markup).toContain(long);
  });
});

describe("contact form dialog styling", () => {
  const markup = renderToStaticMarkup(createElement(ContactFormDialog, {
    request: { requestId: "form-1", displayName: "Mamá" },
    onSubmit: vi.fn(async () => undefined),
    onCancel: vi.fn()
  }));

  it("uses the glass card and keeps its fields, autocomplete and the number out of the markup", () => {
    expect(markup).toContain('class="review-card contact-form-dialog"');
    expect(markup).toContain('class="button-secondary"');
    expect(markup).toContain('class="button-primary"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('type="tel"');
    expect(markup).toContain('value=""');
    expect(markup).not.toMatch(/\d{7,}/u);
    expect(blockOf(".contact-form-dialog")).toContain("max-height: 88cqh");
    expect(blockOf(".contact-form-dialog")).toContain("overflow-y: auto");
  });
});
