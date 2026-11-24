import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  COMMAND_INPUT_LABEL,
  CommandInput,
  LOCAL_MODE_HINT,
  VOICE_NEEDS_KEY_MESSAGE,
  isCommandShortcut,
  textToSubmit
} from "../src/renderer/features/assistant/command-input";
import { AresView } from "../src/renderer/views/ares-view";
import { ASSISTANT_INSTRUCTION_MAX_LENGTH } from "../src/shared/assistant-contracts";
import { getSystemCapabilitiesResult } from "../src/main/system/system-service";
import { readSource } from "./helpers/read-source";

const key = (overrides: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...overrides
});

describe("typed command input: the shortcut and the submitted text", () => {
  it("opens with Ctrl+K (or Cmd+K) and nothing else", () => {
    expect(isCommandShortcut(key())).toBe(true);
    expect(isCommandShortcut(key({ key: "K" }))).toBe(true);
    expect(isCommandShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isCommandShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(isCommandShortcut(key({ key: "j" }))).toBe(false);
    expect(isCommandShortcut(key({ altKey: true }))).toBe(false);
    expect(isCommandShortcut(key({ shiftKey: true }))).toBe(false);
  });

  it("submits trimmed text, never empty text, and never more than the interpreter accepts", () => {
    expect(textToSubmit("  qué hora es  ")).toBe("qué hora es");
    expect(textToSubmit("   ")).toBeUndefined();
    expect(textToSubmit("")).toBeUndefined();
    expect(textToSubmit("a".repeat(ASSISTANT_INSTRUCTION_MAX_LENGTH + 500))).toHaveLength(ASSISTANT_INSTRUCTION_MAX_LENGTH);
  });

  it("limits the field to the existing instruction limit, which the interpreter uses too", () => {
    expect(ASSISTANT_INSTRUCTION_MAX_LENGTH).toBe(2_000);
    expect(readSource("src/main/assistant/assistant-interpreter.ts")).toContain("const MAX_INSTRUCTION_LENGTH = ASSISTANT_INSTRUCTION_MAX_LENGTH;");
  });
});

describe("typed command input: the field", () => {
  const markup = renderToStaticMarkup(createElement(CommandInput, { onSubmit: vi.fn(), onClose: vi.fn() }));

  it("is one single-line text field with a Spanish accessible name and the length limit", () => {
    expect(markup).toContain(`aria-label="${COMMAND_INPUT_LABEL}"`);
    expect(COMMAND_INPUT_LABEL).toBe("Escribe una instrucción para Ares");
    expect(markup).toContain('type="text"');
    expect(markup).toContain(`maxLength="${ASSISTANT_INSTRUCTION_MAX_LENGTH}"`);
    expect(markup.match(/<input\b/gu)).toHaveLength(1);
    expect(markup).not.toContain("<textarea");
  });

  it("submits on Enter, clears the field, closes on submit and on Escape, and never stores or logs the text", () => {
    const source = readSource("src/renderer/features/assistant/command-input.tsx");
    expect(source).toContain("onSubmit={submit}");
    expect(source).toMatch(/field\.current\.value = ""/u);
    expect(source).toMatch(/onSubmit\(text\);\s*onClose\(\);/u);
    expect(source).toMatch(/event\.key !== "Escape"/u);
    expect(source).not.toMatch(/console\.|localStorage|sessionStorage|window\.ares|fetch\(/u);
  });
});

describe("typed command input: hidden by default and wired to the same submission as a transcript", () => {
  const app = readSource("src/renderer/app/App.tsx");
  const view = readSource("src/renderer/views/ares-view.tsx");

  it("is not in the markup until it is opened, and the microphone stays the only visible control", () => {
    const base = {
      technicalState: "SUCCESS" as const, voiceLabel: "En espera", voiceState: "IDLE" as const, orbState: "idle" as const, isInterpreting: false,
      draftStates: {}, onStartRecording: vi.fn(), onSendRecording: vi.fn(), onPropose: vi.fn(), onResolveConfirmation: vi.fn()
    };
    const closed = renderToStaticMarkup(createElement(AresView, base));
    expect(closed).not.toContain("command-input");
    expect(closed.match(/<button\b/gu)).toHaveLength(1);
    expect(app).toContain("useState(false)");
    expect(view).toContain("commandOpen = false");
    const open = renderToStaticMarkup(createElement(AresView, { ...base, commandOpen: true, onCommandSubmit: vi.fn(), onCommandClose: vi.fn() }));
    expect(open).toContain("command-input__field");
  });

  it("opens with Ctrl+K and submits through the very function that submits a transcribed text", () => {
    expect(app).toContain("isCommandShortcut(event)");
    expect(app).toContain("setCommandOpen(true)");
    const typed = app.slice(app.indexOf("const submitTypedInstruction"), app.indexOf("const submitInstruction = async"));
    expect(typed).toContain("voiceSubmission.current.submit");
    expect(typed).toContain("submitInstruction(instruction, true");
    expect(typed).toContain("requestProposal(index, draft");
    expect(typed).toContain("setHeardText(text)");
    expect(typed).not.toMatch(/window\.ares\.[a-z]+\.[a-zA-Z]+\(/u);
    const transcribed = app.slice(app.indexOf("const transcribeAudio"), app.indexOf("useEffect(() => {\n    if (spokenResponse)"));
    expect(transcribed).toContain("voiceSubmission.current.submit");
    expect(transcribed).toContain("submitInstruction(text, true");
  });

  it("returns focus to the microphone button when it closes", () => {
    expect(view).toMatch(/if \(wasCommandOpen\.current && !commandOpen\) micReference\.current\?\.focus\(\)/u);
  });

  it("uses theme tokens only, with a forced-colors rule", () => {
    const css = readSource("src/renderer/styles/ares-hud.css");
    const block = css.slice(css.indexOf(".command-input {"), css.indexOf("/* ---------- Base plate"));
    expect(block).toContain("var(--line2)");
    expect(block).toContain("var(--text)");
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/iu);
    expect(css).toContain(".command-input__field { border: 2px solid CanvasText");
  });
});

describe("typed command input: when the OpenAI key is missing", () => {
  const app = readSource("src/renderer/app/App.tsx");

  it("says in bounded Spanish that voice needs the key and that typing works", () => {
    expect(VOICE_NEEDS_KEY_MESSAGE).toBe("La voz necesita la clave de OpenAI. Puedes escribir con Ctrl+K.");
    expect(LOCAL_MODE_HINT).toBe("Modo local: escribe con Ctrl+K");
    expect(VOICE_NEEDS_KEY_MESSAGE.length).toBeLessThan(80);
    expect(VOICE_NEEDS_KEY_MESSAGE).not.toMatch(/sk-|OPENAI_API_KEY|\.env/u);
  });

  it("offers the hint from the capabilities and explains it when the microphone is pressed, without recording", () => {
    expect(app).toMatch(/if \(!capabilitiesResult\.data\.voice\) \{\s*voiceConfigured\.current = false;\s*setVoiceMessage\(LOCAL_MODE_HINT\);/u);
    const start = app.slice(app.indexOf("const startRecording"), app.indexOf("setHeardText(undefined);", app.indexOf("const startRecording")));
    expect(start).toMatch(/if \(!voiceConfigured\.current\) \{\s*setVoiceMessage\(VOICE_NEEDS_KEY_MESSAGE\);\s*return;/u);
  });

  it("learns the same from a transcription configuration failure", () => {
    expect(app).toMatch(/result\.error\.code === VOICE_ERROR_CODES\.configuration\) \{\s*voiceConfigured\.current = false;\s*return setVoiceMessage\(VOICE_NEEDS_KEY_MESSAGE\);/u);
  });

  it("reports voice as unavailable without the key, keeps the assistant available and exposes nothing else", () => {
    expect(getSystemCapabilitiesResult()).toMatchObject({ ok: true, data: { voice: true, assistant: true } });
    expect(getSystemCapabilitiesResult(() => false)).toMatchObject({ ok: true, data: { voice: false, assistant: true } });
    expect(getSystemCapabilitiesResult(() => { throw new Error("no key"); })).toMatchObject({ ok: true, data: { voice: false, assistant: true } });
    expect(JSON.stringify(getSystemCapabilitiesResult(() => false))).not.toMatch(/key|OPENAI|sk-/iu);
  });
});
