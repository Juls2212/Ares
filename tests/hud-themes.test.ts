import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { contrastRatio, hexColorsIn } from "../src/renderer/theme/contrast";
import { FONT_STACK, THEMES, applyThemeToElement, cssVariablesFor, themeNameFromQuery, type ThemeName } from "../src/renderer/theme/themes";
import { WINDOW_THEME_COLORS, getTitleBarOverlay } from "../src/main/window-theme";
import { HEADER_BACKGROUND } from "../src/shared/theme-colors";

const names: ThemeName[] = ["dark", "light"];
const css = (name: ThemeName) => THEMES[name].css;

describe("themes are data", () => {
  it("has exactly the two shipped themes with the same token names", () => {
    expect(Object.keys(THEMES)).toEqual(["dark", "light"]);
    expect(Object.keys(css("dark")).sort()).toEqual(Object.keys(css("light")).sort());
    expect(Object.keys(THEMES.dark.orb).sort()).toEqual(Object.keys(THEMES.light.orb).sort());
  });

  it("holds the approved dark palette and orb parameters", () => {
    const dark = css("dark");
    expect([dark.bgc, dark.bgm, dark.bge, dark.line, dark.line2, dark.text, dark.dim, dark.accent, dark.accent2]).toEqual(
      ["#07272b", "#041a1e", "#02090b", "#0f3a40", "#12484e", "#bff3ee", "#6fa39f", "#35e0d0", "#1f9ed8"]);
    expect(dark.plate).toBe("linear-gradient(#031317,#02090b)");
    expect(dark.micbg).toBe("radial-gradient(circle,#0a3a40,#031317)");
    expect(dark.micglow).toBe("0 0 24px #35e0d055");
    expect(THEMES.dark.orb).toMatchObject({
      accent: [53, 224, 208], accent2: [31, 158, 216], amber: [242, 179, 74], additive: true, hex: "rgba(53,224,208,0.07)", glowA: 0.2,
      coreFill: "rgba(5,28,32,.92)", rim: "rgba(235,255,252,.92)", rimGlow: 0.9, chunkBase: 0.12, tickBase: 0.18, memA: 0.22, wireBase: 0.12, partK: 1, partSizeK: 1
    });
  });

  it("holds the approved mint-gray light palette and orb parameters, with the two documented contrast adjustments", () => {
    const light = css("light");
    expect([light.bgc, light.bgm, light.bge, light.line, light.line2, light.text, light.accent, light.accent2]).toEqual(
      ["#eaf2ef", "#d4e4df", "#b9d0ca", "#a3bfb8", "#93b3ab", "#0b2b27", "#0b8a7f", "#17679c"]);
    // The prototype's dim #3f6560 is 3.99:1 on the edge color; #395c57 passes. accent-strong is the accent darkened for text and the button.
    expect(light.dim).toBe("#395c57");
    expect(light["accent-strong"]).toBe("#086159");
    expect(light.plate).toBe("linear-gradient(#dcebe7,#c3d9d3)");
    expect(light.micbg).toBe("radial-gradient(circle,#f3faf8,#d2e5e0)");
    expect(light.micglow).toBe("0 4px 16px #0b8a7f33");
    expect(THEMES.light.orb).toMatchObject({
      accent: [11, 138, 127], accent2: [23, 103, 156], amber: [163, 95, 0], additive: false, hex: "rgba(11,138,127,0.12)", glowA: 0.18,
      coreFill: "rgba(248,253,251,.80)", rim: "#0a4a44", rimGlow: 0.35, chunkBase: 0.2, tickBase: 0.26, memA: 0.38, wireBase: 0.22, partK: 1.25, partSizeK: 1.25
    });
  });

  it("never uses pure white (or pure black text) in either theme", () => {
    for (const name of names) {
      const text = JSON.stringify(THEMES[name]).toLowerCase();
      expect(text).not.toMatch(/#fff(?:fff)?\b|rgb\(255, ?255, ?255\)|rgba\(255, ?255, ?255|rgba\(255,255,255/u);
      expect(text).not.toMatch(/"text":"#000/u);
    }
  });

  it("exposes every token as a CSS custom property and applies it to the root with the theme name", () => {
    const variables = cssVariablesFor("light");
    expect(variables["--bgm"]).toBe("#d4e4df");
    expect(Object.keys(variables).every((key) => key.startsWith("--"))).toBe(true);
    const setProperty = vi.fn();
    const setAttribute = vi.fn();
    applyThemeToElement({ style: { setProperty }, setAttribute }, "dark");
    expect(setProperty).toHaveBeenCalledTimes(Object.keys(css("dark")).length);
    expect(setProperty).toHaveBeenCalledWith("--accent", "#35e0d0");
    expect(setAttribute).toHaveBeenCalledWith("data-theme", "dark");
    expect(themeNameFromQuery(true)).toBe("dark");
    expect(themeNameFromQuery(false)).toBe("light");
  });

  it("keeps the window background of Main identical to the theme's own background", () => {
    expect(THEMES.dark.windowBackground).toBe(WINDOW_THEME_COLORS.dark.background);
    expect(THEMES.light.windowBackground).toBe(WINDOW_THEME_COLORS.light.background);
    expect(css("dark").bge).toBe(WINDOW_THEME_COLORS.dark.background);
    expect(css("light").bgm).toBe(WINDOW_THEME_COLORS.light.background);
  });

  it("paints the header with exactly the color Main uses for the title bar overlay, in both themes", () => {
    for (const name of names) {
      expect(css(name).hbg, name).toBe(HEADER_BACKGROUND[name]);
      expect(css(name).hbg, name).toBe(getTitleBarOverlay(name === "dark").color);
    }
    const sheet = readFileSync("src/renderer/styles/ares-hud.css", "utf8");
    expect(sheet.slice(sheet.indexOf(".ares-header {"), sheet.indexOf("}", sheet.indexOf(".ares-header {")))).toContain("background: var(--hbg);");
  });

  it("writes colors only in the tokens: the stylesheet has no hex color and the font stack is system only", () => {
    const sheet = readFileSync("src/renderer/styles/ares-hud.css", "utf8");
    // The only literal color is #000 inside the alpha masks (it is never painted, only its alpha is used).
    expect((sheet.match(/#[0-9a-fA-F]{3,8}\b/gu) ?? []).filter((color) => color !== "#000")).toEqual([]);
    expect(FONT_STACK).toBe('"Bahnschrift", "Segoe UI", system-ui, sans-serif');
    expect(sheet).not.toMatch(/@font-face|@import|url\(/u);
  });
});

describe("WCAG contrast in both themes", () => {
  const report: Record<string, string> = {};

  it.each(names)("keeps text and dim text at 4.5:1 or more on every surface in the %s theme", (name) => {
    const tokens = css(name);
    const surfaces = { bgMid: tokens.bgm!, bgEdge: tokens.bge!, plateStart: hexColorsIn(tokens.plate!)[0]!, plateEnd: hexColorsIn(tokens.plate!)[1]! };
    for (const [surface, color] of Object.entries(surfaces)) {
      const text = contrastRatio(tokens.text!, color);
      const dim = contrastRatio(tokens.dim!, color);
      report[`${name} text/${surface}`] = text.toFixed(2);
      report[`${name} dim/${surface}`] = dim.toFixed(2);
      expect(text, `${name} text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(dim, `${name} dim on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    // The wordmark is accent-strong text on the header, which sits on the background gradient.
    expect(contrastRatio(tokens["accent-strong"]!, tokens.bgm!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["accent-strong"]!, tokens.bge!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(names)("keeps the microphone border and icon, and the focus ring, at 3:1 or more in the %s theme", (name) => {
    const tokens = css(name);
    const micBackground = hexColorsIn(tokens.micbg!);
    const plate = hexColorsIn(tokens.plate!);
    for (const background of [...micBackground, ...plate, tokens.bgm!, tokens.bge!]) {
      expect(contrastRatio(tokens["accent-strong"]!, background), `${name} mic on ${background}`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens.accent2!, background), `${name} focus ring on ${background}`).toBeGreaterThanOrEqual(3);
    }
    // Button text on the accent fill, used by the confirmation card.
    expect(contrastRatio(tokens["on-accent"]!, tokens["accent-strong"]!)).toBeGreaterThanOrEqual(4.5);
    // The amber used for errors and sensitive actions stays readable on the card surfaces.
    expect(contrastRatio(tokens.amber!, tokens.bgm!)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.amber!, tokens.bge!)).toBeGreaterThanOrEqual(3);
  });

  it.each(names)("keeps the toggle frame and bulb at 3:1, the header text at 4.5:1 and the overlay symbols at 3:1 against the header in the %s theme", (name) => {
    const tokens = css(name);
    expect(contrastRatio(tokens["accent-strong"]!, tokens.hbg!)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.accent2!, tokens.hbg!)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens.text!, tokens.hbg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.dim!, tokens.hbg!)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(getTitleBarOverlay(name === "dark").symbolColor, tokens.hbg!)).toBeGreaterThanOrEqual(3);
  });

  it.each(names)("keeps the error and clarification labels at 4.5:1 on every status surface in the %s theme", (name) => {
    const tokens = css(name);
    const surfaces = [tokens.bgc!, tokens.bgm!, tokens.bge!, ...hexColorsIn(tokens.plate!)];
    for (const surface of surfaces) {
      expect(contrastRatio(tokens["label-error"]!, surface), `${name} error on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["label-clarify"]!, surface), `${name} clarify on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    // The thin amber rule is not text, so it needs 3:1.
    expect(contrastRatio(tokens.amber!, tokens.bgm!)).toBeGreaterThanOrEqual(name === "dark" ? 3 : 3);
  });

  it("computes the ratio the WCAG way", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(contrastRatio("#0b8a7f", "#b9d0ca")).toBeCloseTo(2.61, 1);
  });
});
