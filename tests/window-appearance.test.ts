import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACRYLIC_MINIMUM_BUILD,
  FALLBACK_SURFACE,
  getWindowAppearance,
  parseWindowsBuild,
  supportsAcrylic,
  TRANSPARENT_BACKGROUND,
  type WindowAppearanceInput
} from "../src/main/window-appearance";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");

const input = (overrides: Partial<WindowAppearanceInput> = {}): WindowAppearanceInput => ({
  platform: "win32",
  release: "10.0.22631",
  shouldUseDarkColors: false,
  shouldUseHighContrastColors: false,
  prefersReducedTransparency: false,
  ...overrides
});

describe("window material decision", () => {
  it("parses the Windows build from os.release() without touching the registry", () => {
    expect(parseWindowsBuild("10.0.22631")).toBe(22631);
    expect(parseWindowsBuild("10.0.19045")).toBe(19045);
    expect(parseWindowsBuild("6.1.7601")).toBe(7601);
    for (const release of ["", "abc", "10.0"]) expect(parseWindowsBuild(release)).toBeUndefined();
  });

  it("uses Acrylic with a fully transparent background on Windows 11 build 22621 or later", () => {
    expect(ACRYLIC_MINIMUM_BUILD).toBe(22_621);
    for (const release of ["10.0.22621", "10.0.22631", "10.0.26100"]) {
      expect(getWindowAppearance(input({ release }))).toEqual({
        material: "acrylic",
        options: { backgroundMaterial: "acrylic", backgroundColor: "#00000000" },
        backgroundColor: TRANSPARENT_BACKGROUND
      });
    }
  });

  it("falls back to an opaque theme surface before build 22621 and on other platforms", () => {
    for (const [platform, release] of [
      ["win32", "10.0.22620"],
      ["win32", "10.0.19045"],
      ["win32", "garbage"],
      ["darwin", "23.4.0"],
      ["linux", "6.8.0-45-generic"]
    ] as const) {
      expect(supportsAcrylic(platform, release)).toBe(false);
      expect(getWindowAppearance(input({ platform, release }))).toEqual({
        material: "opaque",
        options: { backgroundColor: FALLBACK_SURFACE.light },
        backgroundColor: FALLBACK_SURFACE.light
      });
      expect(getWindowAppearance(input({ platform, release, shouldUseDarkColors: true })).backgroundColor).toBe(FALLBACK_SURFACE.dark);
    }
    expect(FALLBACK_SURFACE).toEqual({ light: "#E4EEEA", dark: "#0D1D22" });
  });

  it("never combines the opaque fallback with a background material option", () => {
    const opaque = getWindowAppearance(input({ platform: "linux", release: "6.8.0" }));
    expect(opaque.options).not.toHaveProperty("backgroundMaterial");
    expect(opaque.options.backgroundColor).not.toBe(TRANSPARENT_BACKGROUND);
  });

  it("disables the glass for high contrast and for reduced transparency, in both themes", () => {
    for (const shouldUseDarkColors of [false, true]) {
      for (const overrides of [{ shouldUseHighContrastColors: true }, { prefersReducedTransparency: true }]) {
        const appearance = getWindowAppearance(input({ shouldUseDarkColors, ...overrides }));
        expect(appearance.material).toBe("opaque");
        expect(appearance.options).not.toHaveProperty("backgroundMaterial");
        expect(appearance.backgroundColor).toBe(shouldUseDarkColors ? FALLBACK_SURFACE.dark : FALLBACK_SURFACE.light);
      }
    }
  });

  it("does not inject any stylesheet into the page: the opaque surface is only the window background color", () => {
    for (const code of [source("src/main/main.ts"), source("src/main/window-appearance.ts")]) {
      expect(code).not.toMatch(/insertCSS|removeInsertedCSS|OPAQUE_MATERIAL_CSS/u);
    }
    expect(source("src/main/main.ts")).toContain("createdWindow.setBackgroundColor(appearance.backgroundColor)");
  });
});

describe("main window creation", () => {
  const main = source("src/main/main.ts");
  const window = main.slice(main.indexOf("const createMainWindow"), main.indexOf("createdWindow.setAspectRatio(1)"));

  it("applies the material options and keeps the frame, size limits, aspect ratio and security options as they were", () => {
    expect(window).toContain("...windowAppearance.options");
    for (const option of ["width: 440", "height: 440", "minWidth: 360", "minHeight: 360", "useContentSize: true", "maximizable: false", "fullscreenable: false", "contextIsolation: true", "nodeIntegration: false", "sandbox: true", "webSecurity: true", "backgroundThrottling: false", 'preload: path.join(__dirname, "preload.js")']) {
      expect(window).toContain(option);
    }
    expect(main).toContain("createdWindow.setAspectRatio(1)");
    expect(main).not.toMatch(/frame:\s*false/u);
    expect(main).not.toMatch(/transparent:\s*true/u);
    expect(main).not.toMatch(/maxWidth|maxHeight/u);
  });

  it("follows the system theme through nativeTheme 'updated' and never reads the registry or adds a channel", () => {
    expect(main).toContain('nativeTheme.on("updated", applyWindowAppearance)');
    expect(main).toContain('nativeTheme.removeListener("updated", applyWindowAppearance)');
    expect(main).toContain("nativeTheme.shouldUseHighContrastColors");
    expect(main).toContain("nativeTheme.prefersReducedTransparency");
    expect(main).toContain("os.release()");
    expect(main).toContain('if (process.platform === "win32") createdWindow.setBackgroundMaterial(');
    for (const code of [main, source("src/main/window-appearance.ts")]) {
      expect(code).not.toMatch(/HKCU|HKLM|\breg\b\s+query|winreg|child_process|execSync|EnableTransparency/u);
    }
    expect(source("src/shared/contracts.ts")).not.toMatch(/appearance|material|transparen/iu);
    expect(source("src/preload/preload.ts")).not.toMatch(/appearance|material|nativeTheme|transparen/iu);
  });

  it("keeps the permission handlers and navigation denial untouched", () => {
    for (const fragment of ["setPermissionCheckHandler", "setPermissionRequestHandler", 'setWindowOpenHandler(() => ({ action: "deny" }))', 'webContents.on("will-navigate"', "isTrustedAudioMicrophoneRequest"]) {
      expect(main).toContain(fragment);
    }
  });
});
