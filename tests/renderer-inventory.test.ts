import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { listSourceFiles, readSource } from "./helpers/read-source";

/** Inventory of the renderer after the legacy UI, ares.css and Tailwind were removed (Refactor 2.1). */

const DELETED_PATHS = [
  "src/renderer/features/calendar",
  "src/renderer/views/calendar-view.tsx",
  "src/renderer/features/assistant/ares-information-panels.tsx",
  "src/renderer/features/assistant/ares-habit-summary.ts",
  "src/renderer/features/assistant/ares-today-summary.ts",
  "src/renderer/features/assistant/ares-mini-calendar.tsx",
  "src/renderer/features/assistant/local-clock.tsx",
  "src/renderer/features/settings/utility-panel.tsx",
  "src/renderer/features/voice/browser-speech-adapter.ts",
  "src/renderer/features/voice/browser-speech-controls.tsx",
  "src/renderer/features/voice/voice-command-controls.tsx",
  "src/renderer/styles/ares.css"
];

const EXPECTED_RENDERER_FILES = [
  "src/renderer/app/App.tsx",
  "src/renderer/app/app-state.ts",
  "src/renderer/components/glass-orb.tsx",
  "src/renderer/components/orb-visuals.ts",
  "src/renderer/features/assistant/idle-guidance.tsx",
  "src/renderer/features/assistant/interpretation-result.tsx",
  "src/renderer/features/assistant/response-area.ts",
  "src/renderer/features/assistant/response-core-reveal.ts",
  "src/renderer/features/messaging/contact-form-dialog.tsx",
  "src/renderer/features/settings/color-scheme-button.tsx",
  "src/renderer/features/settings/color-schemes.ts",
  "src/renderer/features/settings/theme-preference.ts",
  "src/renderer/features/settings/use-theme-preference.ts",
  "src/renderer/features/voice/global-voice-shortcut-controller.ts",
  "src/renderer/features/voice/manual-voice-recorder.ts",
  "src/renderer/features/voice/orb-amplitude.ts",
  "src/renderer/features/voice/recording-cancellation.ts",
  "src/renderer/features/voice/recording-limits.ts",
  "src/renderer/features/voice/response-playback.ts",
  "src/renderer/features/voice/response-speech-controls.tsx",
  "src/renderer/features/voice/speech-eligibility.ts",
  "src/renderer/features/voice/speech-end-detector.ts",
  "src/renderer/features/voice/voice-transcript-submission.ts",
  "src/renderer/global.d.ts",
  "src/renderer/main.tsx",
  "src/renderer/views/ares-view.tsx"
];

const rendererFiles = listSourceFiles("src/renderer");
const rendererSources = rendererFiles.map((file) => [file, readSource(file)] as const);

describe("renderer inventory after the legacy UI removal", () => {
  it("no longer has any deleted path", () => {
    for (const deleted of DELETED_PATHS) expect(existsSync(path.resolve(process.cwd(), deleted)), deleted).toBe(false);
  });

  it("contains exactly the expected TypeScript sources", () => {
    expect(rendererFiles).toEqual([...EXPECTED_RENDERER_FILES].sort());
  });

  it("has only the glass stylesheet", () => {
    const styles = readdirSync(path.resolve(process.cwd(), "src/renderer/styles"));
    expect(styles).toEqual(["ares-glass.css"]);
  });

  it("never imports a deleted module, Tailwind or the legacy stylesheet", () => {
    const forbidden = /calendar|ares-information-panels|ares-habit-summary|ares-today-summary|ares-mini-calendar|local-clock|utility-panel|browser-speech|voice-command-controls|ares\.css|tailwind/iu;
    for (const [file, text] of rendererSources) {
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu)) expect(match[1], `${file} imports ${match[1]}`).not.toMatch(forbidden);
    }
    expect(readSource("src/renderer/main.tsx")).not.toMatch(/ares\.css|tailwind/iu);
  });

  it("has no Tailwind entry in package.json, the lockfile or the renderer Vite config", () => {
    const manifest = JSON.parse(readSource("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
    expect(names.filter((name) => /tailwind/iu.test(name))).toEqual([]);
    expect(readSource("package-lock.json")).not.toMatch(/tailwind/iu);
    expect(readSource("vite.renderer.config.ts")).not.toMatch(/tailwind/iu);
  });

  it("keeps the renderer entry mounting the orb view and the glass stylesheet only", () => {
    const entry = readSource("src/renderer/main.tsx");
    expect(entry).toContain('import "./styles/ares-glass.css"');
    expect(entry.match(/import "[^"]+\.css"/gu)).toHaveLength(1);
    expect(entry).toContain("<App />");
    const app = readSource("src/renderer/app/App.tsx");
    expect(app).toContain("<AresView");
    expect(readSource("src/renderer/views/ares-view.tsx")).toContain("<GlassOrb");
  });

  it("has no text input, calendar component or settings panel in the mounted views", () => {
    for (const file of ["src/renderer/app/App.tsx", "src/renderer/views/ares-view.tsx"]) {
      const text = readSource(file);
      expect(text, file).not.toMatch(/<input\b|<textarea\b|<select\b/u);
      expect(text, file).not.toMatch(/Calendar|UtilityPanel|HabitPlanner|WeeklyRoutinePlanner|BrowserSpeechControls|VoiceCommandControls/u);
    }
  });

  it("keeps the dead panel state out of App.tsx and never calls the panel-only preload methods", () => {
    const app = readSource("src/renderer/app/App.tsx");
    for (const dead of ["registerCatalogApplication", "registerCustomApplication", "customDisplayName", "selectedCatalogApplication", "updateVoicePreferences", "voicePreferencesMessage"]) {
      expect(app, dead).not.toContain(dead);
    }
    for (const [file, text] of rendererSources) {
      expect(text, file).not.toMatch(/window\.ares\??\.(?:planner|habits|dashboard|applications)\b/u);
    }
  });

  it("still reads the voice shortcut preferences for the one-time hint", () => {
    const app = readSource("src/renderer/app/App.tsx");
    expect(app).toContain("window.ares.settings.voice.get()");
    expect(app).not.toContain("window.ares.settings.voice.update");
    expect(app).toContain("formatShortcutForDisplay");
  });
});
