import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { AssistantInterpretation } from "../src/shared/assistant-contracts";
import type { AwaitingActionConfirmation } from "../src/shared/action-contracts";
import { GlassOrb } from "../src/renderer/components/glass-orb";
import { ORB_VISUALS, ORB_VISUALS_BLUE, PALETTE, type OrbVisualKey } from "../src/renderer/components/orb-visuals";
import { ColorSchemeButton } from "../src/renderer/features/settings/color-scheme-button";
import {
  COLOR_SCHEMES,
  colorButtonTitle,
  colorChangeAnnouncement,
  findScheme,
  migrateStoredScheme,
  nextScheme,
  orbVisualsFor,
  type ColorScheme
} from "../src/renderer/features/settings/color-schemes";
import { applyThemePreference, initializeThemePreference, saveThemePreference } from "../src/renderer/features/settings/theme-preference";
import { AresView } from "../src/renderer/views/ares-view";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
const css = source("src/renderer/styles/ares-glass.css");
const blockOf = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing block ${selector}`);
  return css.slice(start, css.indexOf("\n}", start));
};
const tokensOf = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2].trim()]));
const green = tokensOf(blockOf(":root"));
const blue = { ...green, ...tokensOf(blockOf(':root[data-theme="blue"]')) };

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
const luminance = ([r, g, b]: readonly number[]): number => {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};
const KEYS = Object.keys(ORB_VISUALS) as OrbVisualKey[];

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

describe("smooth glass", () => {
  it("has no grain layer, noise token, generated asset or blend mode anywhere in the stylesheet", () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(rules).not.toMatch(/noise|grain|feTurbulence|url\(|background-blend-mode|--glass-noise/iu);
    expect(Object.keys(green).concat(Object.keys(blue)).join(" ")).not.toMatch(/noise|grain/u);
  });

  it("defines a wide vertical gradient for both schemes, lighter at the top for green", () => {
    for (const tokens of [green, blue]) {
      expect(tokens["--glass-fill"]).toBe("linear-gradient(180deg, var(--glass-top) 0%, var(--glass-bottom) 100%)");
      expect(tokens["--glass-top"]).toBeDefined();
      expect(tokens["--glass-bottom"]).toBeDefined();
      expect(tokens["--glass-inner-glow"]).toBeDefined();
    }
    const channels = (value: string): number[] => /rgba\((\d+),\s*(\d+),\s*(\d+)/u.exec(value)!.slice(1).map(Number);
    expect(luminance(channels(green["--glass-top"]!))).toBeGreaterThan(luminance(channels(green["--glass-bottom"]!)));
    expect(luminance(channels(green["--glass-top"]!))).toBeGreaterThan(0.9);
    expect(luminance(channels(blue["--glass-top"]!))).toBeLessThan(0.05);
    expect(luminance(channels(blue["--glass-bottom"]!))).toBeLessThan(luminance(channels(blue["--glass-top"]!)));
    expect(blockOf(".ares-shell")).toContain("background-image: var(--glass-fill)");
  });

  it("keeps the sheen, the inner glow and the luminous edge on a non-interactive layer, with wide gradients", () => {
    const layer = blockOf(".ares-shell::after");
    expect(layer).toContain("pointer-events: none");
    expect(layer).toContain("var(--glass-sheen)");
    expect(layer).toContain("radial-gradient(ellipse 100% 70% at 50% 0%, var(--glass-inner-glow) 0%");
    expect(layer).toContain("inset 0 1px 0 var(--glass-highlight)");
    expect(green["--glass-sheen-stop"]).toBe("46%");
  });

  it("drops the gradient with reduced transparency so the opaque fallback stays flat", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(reduced).toContain("--glass-fill: none;");
    expect(css.slice(css.indexOf("@media (forced-colors: active)"))).toContain(".ares-shell { background-color: Canvas;");
  });

  it("keeps the schemes visibly different: a milky green and a deep navy", () => {
    expect(blue["--glass-tint"]).toBe("rgba(10, 26, 38, 0.9)");
    expect(green["--glass-tint"]).toBe("rgba(236, 246, 241, 0.9)");
    expect(blue["--focus-halo"]).toBe("rgba(47, 130, 196, 0.3)");
  });
});

describe("deep blue orb", () => {
  it("defines every state with deep tones that exclude the previous pale blues", () => {
    expect(Object.keys(ORB_VISUALS_BLUE).sort()).toEqual([...KEYS].sort());
    expect([PALETTE.navy, PALETTE.ocean, PALETTE.cobalt, PALETTE.azure, PALETTE.sky]).toEqual(["#0A1F33", "#0F3D66", "#1B5C94", "#2F82C4", "#6FB6E6"]);
    for (const key of KEYS) {
      if (key === "error") continue;
      const visual = ORB_VISUALS_BLUE[key];
      const accents = visual.colors.filter((color) => [PALETTE.sky, PALETTE.mist].includes(color as never));
      expect(accents.length, `${key} accents`).toBeLessThanOrEqual(1);
      for (const color of visual.colors) {
        if (accents.includes(color)) continue;
        expect(luminance(rgbOf(color)), `${key} ${color}`).toBeLessThan(0.21);
      }
      expect(luminance(rgbOf(visual.base)), `${key} base`).toBeLessThan(0.12);
      expect([PALETTE.sky, PALETTE.mist]).not.toContain(visual.glow);
    }
    // The old pale blues (sky #7FB5C9, mist, azure #3E7FA6) are gone from every blob.
    for (const key of KEYS) for (const color of ORB_VISUALS_BLUE[key].colors) expect(["#7FB5C9", "#A5C8CC", "#3E7FA6", "#5AA9E0"]).not.toContain(color.toUpperCase());
  });

  it("keeps every animation value identical to the green orb", () => {
    for (const key of KEYS) {
      const { colors: _a, base: _b, glow: _c, ...greenValues } = ORB_VISUALS[key];
      const { colors: _d, base: _e, glow: _f, ...blueValues } = ORB_VISUALS_BLUE[key];
      expect(blueValues, key).toEqual(greenValues);
    }
  });

  it("selects the blue palette by scheme id and the green one by default or for unknown ids", () => {
    expect(orbVisualsFor("blue")).toBe(ORB_VISUALS_BLUE);
    expect(orbVisualsFor("green")).toBe(ORB_VISUALS);
    expect(orbVisualsFor(undefined)).toBe(ORB_VISUALS);
    expect(orbVisualsFor("nonexistent")).toBe(ORB_VISUALS);
    expect(renderToStaticMarkup(createElement(GlassOrb, { state: "idle", scheme: "blue" }))).toContain(`--orb-c2:${PALETTE.ocean}`);
    expect(renderToStaticMarkup(createElement(GlassOrb, { state: "idle" }))).toContain(`--orb-c2:${PALETTE.sage}`);
  });

  it("halves the white core and highlight for both schemes while keeping a small top-left reflection", () => {
    const core = blockOf(".glass-orb__core");
    expect(core).toContain("inset: 30%;");
    expect(core).toContain("* 0.6);");
    expect(core).toContain("rgba(233, 244, 240, 0.85) 0%");
    const highlight = blockOf(".glass-orb__highlight");
    expect(highlight).toContain("left: 18%;");
    expect(highlight).toContain("top: 9%;");
    expect(highlight).toContain("width: 34%;");
    expect(highlight).toContain("height: 20%;");
    expect(highlight).toContain("rgba(255, 255, 255, 0.4) 0%");
  });
});

describe("layout balance", () => {
  it("tightens the halo and the window glow, still colored by the scheme", () => {
    expect(blockOf(".glass-orb__halo--secondary")).toContain("inset: -22%;");
    expect(blockOf(".glass-orb__halo--primary")).toContain("inset: -12%;");
    expect(blockOf(".glass-orb__halo")).toContain("filter: blur(22px);");
    const glow = blockOf(".command-glow");
    expect(glow).toContain("width: 62cqw;");
    expect(glow).toContain("filter: blur(44px);");
    expect(glow).toContain("background-color: var(--orb-glow");
    expect(Number(green["--glow-alpha"])).toBeLessThanOrEqual(0.24);
    expect(Number(blue["--glow-alpha"])).toBeLessThanOrEqual(0.24);
  });

  it("centers the resting group with one variable at both window sizes, without touching the card or response layout", () => {
    expect(blockOf(".command-layout")).toContain("--orb-top: 41%;");
    expect(css).toContain(".command-layout[data-resting] { --orb-top: 44%; }");
    expect(blockOf(".command-orb")).toContain("top: var(--orb-top);");
    expect(blockOf(".command-glow")).toContain("top: var(--orb-top);");
    expect(css).toContain(".command-layout[data-resting] .command-text { top: 70%; }");
    expect(blockOf(".command-layout[data-card] .command-orb")).toContain("top: 27%;");
    expect(blockOf(".command-text")).toContain("top: 66%;");
    // Every measure is in cqw/% of the window, so the same rules hold at 360 and 440 px.
    for (const selector of [".command-orb", ".command-glow", ".command-text"]) expect(blockOf(selector)).not.toMatch(/(?:top|left|width|height):\s*\d+px/u);
    const resting = renderToStaticMarkup(createElement(AresView, viewProperties));
    expect(resting).toContain('data-resting="true"');
    expect(renderToStaticMarkup(createElement(AresView, { ...viewProperties, spokenResponse: { responseId: "r", text: "Hola" } }))).not.toContain("data-resting");
  });

  it("keeps the primary prompt and the example phrase, and folds the greeting away from the stack", () => {
    const resting = renderToStaticMarkup(createElement(AresView, viewProperties));
    expect(resting).toContain("Toca el orbe para hablar");
    expect(resting).toContain("idle-guidance");
    expect(resting).not.toContain("command-text__greeting");
    expect(blockOf(".command-text")).toContain("gap: 8px;");
  });
});

describe("color schemes as data", () => {
  it("lists green then blue, with Spanish labels and swatch colors", () => {
    expect(COLOR_SCHEMES.map((scheme) => scheme.id)).toEqual(["green", "blue"]);
    expect(COLOR_SCHEMES.map((scheme) => scheme.label)).toEqual(["Verde", "Azul"]);
    expect(findScheme("blue").orb).toBe(ORB_VISUALS_BLUE);
    expect(findScheme("whatever").id).toBe("green");
  });

  it("cycles in list order and wraps around", () => {
    expect(nextScheme("green").id).toBe("blue");
    expect(nextScheme("blue").id).toBe("green");
  });

  it("migrates the old stored values and falls back to green for anything unknown", () => {
    expect(migrateStoredScheme("light")).toBe("green");
    expect(migrateStoredScheme("dark")).toBe("blue");
    expect(migrateStoredScheme("blue")).toBe("blue");
    for (const value of [null, undefined, "", "midnight", 3, {}]) expect(migrateStoredScheme(value)).toBe("green");
  });

  it("announces the change in Spanish and describes the next color in the tooltip", () => {
    expect(colorChangeAnnouncement(findScheme("blue"))).toBe("Color azul");
    expect(colorChangeAnnouncement(findScheme("green"))).toBe("Color verde");
    expect(colorButtonTitle(findScheme("green"), findScheme("blue"))).toBe("Color: Verde. Toca para cambiar a Azul.");
  });

  it("supports a third scheme with data only: cycling, orb lookup, migration and inline tokens", () => {
    const third: ColorScheme = {
      id: "violet",
      label: "Violeta",
      accent: "#7050B0",
      mode: "dark",
      orb: ORB_VISUALS_BLUE,
      tokens: { "--glass-tint": "rgba(20, 10, 30, 0.9)", "--ink": "#F4EEFA" }
    };
    const schemes = [...COLOR_SCHEMES, third];
    expect(nextScheme("blue", schemes).id).toBe("violet");
    expect(nextScheme("violet", schemes).id).toBe("green");
    expect(findScheme("violet", schemes)).toBe(third);
    expect(orbVisualsFor("violet", schemes)).toBe(ORB_VISUALS_BLUE);
    expect(migrateStoredScheme("violet", schemes)).toBe("violet");
    expect(migrateStoredScheme("violet")).toBe("green");
    expect(colorChangeAnnouncement(third)).toBe("Color violeta");

    const style = { setProperty: vi.fn(), removeProperty: vi.fn() };
    const root = { setAttribute: vi.fn(), style };
    applyThemePreference(root, "violet", schemes);
    expect(root.setAttribute).toHaveBeenLastCalledWith("data-theme", "violet");
    expect(style.setProperty).toHaveBeenCalledWith("--glass-tint", "rgba(20, 10, 30, 0.9)");
    expect(style.setProperty).toHaveBeenCalledWith("--ink", "#F4EEFA");
    applyThemePreference(root, "green", schemes);
    expect(style.removeProperty).toHaveBeenCalledWith("--glass-tint");
    expect(style.removeProperty).toHaveBeenCalledWith("--ink");

    const storage = { getItem: vi.fn(() => "violet"), setItem: vi.fn() };
    expect(initializeThemePreference(root, storage, schemes)).toBe("violet");
    saveThemePreference(root, storage, "violet", schemes);
    expect(storage.setItem).toHaveBeenCalledWith("ares-theme-preference", "violet");
  });
});

describe("color button", () => {
  const green = findScheme("green");
  const blueScheme = findScheme("blue");
  const markup = renderToStaticMarkup(createElement(ColorSchemeButton, { current: green, next: blueScheme, onCycle: vi.fn() }));

  it("is one small icon button with the Spanish name, the next color dot and a descriptive tooltip", () => {
    expect(markup).toContain('aria-label="Cambiar color"');
    expect(markup).toContain('title="Color: Verde. Toca para cambiar a Azul."');
    expect(markup).toContain('fill="#2F82C4"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toMatch(/oscuro|claro|dark|light/iu);
    expect(markup.match(/<button/gu)).toHaveLength(1);
  });

  it("calls the cycle handler once per activation", () => {
    const onCycle = vi.fn();
    const element = ColorSchemeButton({ current: green, next: blueScheme, onCycle });
    element.props.onClick();
    expect(onCycle).toHaveBeenCalledOnce();
  });

  it("has a 28 px hit target, a visible focus ring, an opacity/scale blink and reduced-motion and forced-colors rules", () => {
    const button = blockOf(".color-button");
    expect(button).toContain("width: 28px;");
    expect(button).toContain("height: 28px;");
    expect(css).toMatch(/\.color-button:focus-visible \{[^}]*var\(--focus-ink\)/u);
    expect(css).toContain("@keyframes ares-dot-pop { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }");
    expect(blockOf(".color-button__dot")).toContain("animation: ares-dot-pop 180ms ease-out both;");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@keyframes ares-fade-in"));
    expect(reduced).toContain(".color-button__dot { animation: ares-fade-in 160ms ease-out both; }");
    expect(css.slice(css.indexOf("@media (forced-colors: active)"))).toContain(".color-button {");
  });
});

describe("mounted renderer", () => {
  const app = source("src/renderer/app/App.tsx");

  it("no longer mounts the settings panel or the gear button and opens nothing", () => {
    expect(app).not.toContain("<UtilityPanel");
    expect(app).not.toMatch(/utilityOpen|setUtilityOpen|Controles técnicos|aria-controls="utility-panel"/u);
    expect(app).not.toContain("utility-toggle");
    expect(existsSync(path.resolve(process.cwd(), "src/renderer/features/settings/utility-panel.tsx"))).toBe(true);
  });

  it("mounts the color button only while no dialog is open, so dialog focus containment is unchanged", () => {
    expect(app).toContain("const dialogOpen = Boolean(contactForm) || hasAssistantReview(interpretation, draftStates);");
    expect(app).toContain("{!dialogOpen && <div className=\"header-utilities\">");
    expect(app).toContain("<ColorSchemeButton current={scheme} next={nextColorScheme} onCycle={changeColor} />");
  });

  it("announces the change through the existing polite region, only when nothing else is being announced", () => {
    expect(app).toContain("setColorNotice(colorChangeAnnouncement(cycleScheme()));");
    expect(app).toContain("colorNotice={colorNotice}");
    const announced = renderToStaticMarkup(createElement(AresView, { ...viewProperties, colorNotice: "Color azul" }));
    expect(announced).toContain('role="status">Color azul</div>');
    const withResponse = renderToStaticMarkup(createElement(AresView, { ...viewProperties, colorNotice: "Color azul", spokenResponse: { responseId: "r", text: "Listo." } }));
    expect(withResponse).toContain('role="status">Listo.</div>');
    expect(announced.match(/aria-live="polite"/gu)).toHaveLength(1);
  });

  it("passes the scheme id to the view and no IPC or preload method was added for it", () => {
    expect(app).toContain("scheme={scheme.id}");
    expect(source("src/preload/preload.ts")).not.toMatch(/color|scheme|appearance/iu);
    expect(source("src/renderer/features/settings/use-theme-preference.ts")).not.toContain("window.ares");
  });
});

const confirmation: AwaitingActionConfirmation = {
  lifecycleState: "AWAITING_CONFIRMATION",
  actionId: "action-1",
  action: "OPEN_FOUND_FILE",
  riskLevel: 2,
  confirmationId: "confirmation-1",
  confirmation: { required: true, summary: "Se abrirá el archivo.", affectedItemCount: 1, scopeSummary: "Resultado de búsqueda" }
};
const interpretation = { state: "READY", summary: "Listo.", drafts: [{ action: "OPEN_FOUND_FILE", input: { ordinal: 1 } }], clarifications: [] } as unknown as AssistantInterpretation;

describe("color change while a card is open", () => {
  it("keeps the orb and card semantics unchanged for the active scheme", () => {
    const markup = renderToStaticMarkup(createElement(AresView, { ...viewProperties, scheme: "blue", interpretation, draftStates: { 0: { busy: false, resolved: true, confirmation } } }));
    expect(markup).toContain('role="dialog"');
    expect(markup).not.toContain("color-button");
    expect(markup).toContain("--orb-glow:" + ORB_VISUALS_BLUE.confirm.glow);
  });
});
