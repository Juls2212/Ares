import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createBackgroundLifecycle,
  type ManagedTray,
  type ManagedWindow,
  type TrayMenuItem
} from "../src/main/background/background-lifecycle";
import { createGlobalVoiceShortcutLifecycle, DEFAULT_VOICE_SHORTCUT } from "../src/main/voice/global-voice-shortcut";
import { VOICE_SHORTCUTS, formatShortcutForDisplay } from "../src/shared/settings-contracts";
import { VOICE_MAX_RECORDING_DURATION_MS } from "../src/shared/voice-contracts";

const source = (file: string): string => readFileSync(file, "utf8");

type CloseListener = (event: { preventDefault: () => void }) => void;

const createWindow = () => {
  const listeners = new Map<string, CloseListener>();
  const state = { visible: true };
  const window: ManagedWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => state.visible,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(() => { state.visible = false; }),
    on: (event, listener) => { listeners.set(event, listener); }
  };
  const close = () => {
    const event = { preventDefault: vi.fn() };
    listeners.get("close")?.(event);
    return event;
  };
  return { window, close };
};

const createHarness = (
  label: { current: string | undefined },
  options: { balloon?: "ok" | "throws" | "absent"; window?: ManagedWindow } = {}
) => {
  const tray: ManagedTray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    ...(options.balloon === "absent" ? {} : {
      displayBalloon: vi.fn(() => { if (options.balloon === "throws") throw new Error("private C:\\detail"); })
    })
  };
  const menus: TrayMenuItem[][] = [];
  const lifecycle = createBackgroundLifecycle({
    app: { requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn(), on: vi.fn() },
    getMainWindow: () => options.window,
    createMainWindow: vi.fn(async () => undefined),
    createTray: () => tray,
    buildMenu: (items) => { menus.push(items); return { menu: items }; },
    logError: vi.fn(),
    getShortcutLabel: () => label.current
  });
  return { lifecycle, tray, menus };
};

const labelsOf = (items: TrayMenuItem[] | undefined) => items?.map((item) => ("label" in item ? item.label : item.type));

describe("one-time orb hint", () => {
  const app = source("src/renderer/app/App.tsx");

  it("is shown once per session, only when the shortcut is active, and cleared after a short time", () => {
    expect(app).toContain("let shortcutHintShown = false;");
    expect(app).toContain('result.data.effectiveStatus === "ACTIVE" && !shortcutHintShown');
    expect(app).toContain("shortcutHintShown = true;");
    expect(app).toContain("Atajo: ${formatShortcutForDisplay(result.data.preferences.shortcut)}");
    expect(app).toContain("SHORTCUT_HINT_DURATION_MS = 8_000");
    expect(app).toContain("shortcutHint={shortcutHint}");
  });

  it("renders only while idle and never over a response, as static text safe for both themes and reduced motion", () => {
    const view = source("src/renderer/views/ares-view.tsx");
    expect(view).toContain('shortcutHint && exclusiveCoreState === "IDLE" && !coreResponse');
    expect(view).toContain('className="shortcut-hint" role="note"');
    const css = source("src/renderer/styles/ares.css");
    const start = css.indexOf(".shortcut-hint {");
    const block = css.slice(start, css.indexOf("}", start) + 1);
    expect(block).toContain("pointer-events: none;");
    expect(block).toContain("var(--ink)");
    expect(block).toContain("var(--core-soft-line)");
    expect(block).toContain("bottom: .55rem;");
    expect(block).not.toMatch(/animation|transition/);
  });
});

describe("recording limits found in code", () => {
  it("define 60 s in the shared contract and 10 s as the renderer's active limit", () => {
    expect(VOICE_MAX_RECORDING_DURATION_MS).toBe(60_000);
    expect(source("src/renderer/app/App.tsx")).toContain("maximumDurationMs: 10_000");
    expect(source("src/renderer/features/voice/manual-voice-recorder.ts")).toContain("dependencies.maximumDurationMs ?? VOICE_MAX_RECORDING_DURATION_MS");
  });
});
