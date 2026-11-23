import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createAssistantInterpretationService, type AssistantInterpreter } from "../src/main/assistant/assistant-composition";
import type { ApplicationService } from "../src/main/applications/application-service";
import { formatInterpretationDiagnostic } from "../src/main/assistant/interpretation-diagnostic";
import { createVoiceTranscriptionService } from "../src/main/voice/voice-transcription-service";
import { formatVoiceDiagnostic } from "../src/shared/voice-diagnostics";

const LINE = /^interpret kind=(action|clarification|small_talk|unsupported|failure) capability=[A-Z_]+|none outcome=(success|failure|cancelled|clarification|none) domain=[A-Z_]+|none$/u;
const STRICT = /^interpret kind=[a-z_]+ capability=[A-Za-z_]+ outcome=[a-z_]+ domain=[A-Za-z_]+$/u;
const HOSTILE = "sk-SECRET Ana García C:\\Users\\Ana\\doc.pdf https://evil.example/?q=crear tarea";

const interpretationOf = (state: string, drafts: unknown[] = []) => ({
  ok: true as const,
  data: { state, summary: HOSTILE, drafts, clarifications: [{ question: HOSTILE }] }
}) as never;

describe("interpretation diagnostic line", () => {
  it("maps every interpretation state to a closed kind and outcome", () => {
    expect(formatInterpretationDiagnostic(interpretationOf("READY", [{ action: "OPEN_APPLICATION", input: { alias: HOSTILE } }])))
      .toBe("interpret kind=action capability=OPEN_APPLICATION outcome=success domain=APPLICATIONS");
    expect(formatInterpretationDiagnostic(interpretationOf("CONVERSATIONAL"))).toBe("interpret kind=small_talk capability=none outcome=success domain=none");
    expect(formatInterpretationDiagnostic(interpretationOf("NEEDS_CLARIFICATION"))).toBe("interpret kind=clarification capability=none outcome=clarification domain=none");
    expect(formatInterpretationDiagnostic(interpretationOf("REJECTED"))).toBe("interpret kind=unsupported capability=none outcome=none domain=none");
    expect(formatInterpretationDiagnostic(interpretationOf("UNAVAILABLE"))).toBe("interpret kind=failure capability=none outcome=failure domain=none");
    expect(formatInterpretationDiagnostic({ ok: false, error: { code: "X", userMessage: HOSTILE } } as never)).toBe("interpret kind=failure capability=none outcome=failure domain=none");
  });

  it("never prints hostile input: unknown states and unknown or hostile action names fall back to closed values", () => {
    for (const state of [HOSTILE, "constructor", "__proto__", "toString", ""]) {
      const line = formatInterpretationDiagnostic(interpretationOf(state, [{ action: HOSTILE, input: HOSTILE }]));
      expect(line).toBe("interpret kind=failure capability=none outcome=failure domain=none");
    }
    const unknownAction = formatInterpretationDiagnostic(interpretationOf("READY", [{ action: HOSTILE }, { action: "constructor" }]));
    expect(unknownAction).toBe("interpret kind=action capability=none outcome=success domain=none");
    for (const line of [unknownAction, formatInterpretationDiagnostic(interpretationOf("READY", [null as never]))]) {
      expect(line).toMatch(STRICT);
      expect(line).not.toMatch(/Ana|SECRET|evil|Users|crear|García/u);
    }
    expect(LINE.test("interpret kind=action capability=none outcome=success domain=none")).toBe(true);
  });

  it("is logged once per turn by the service and a throwing logger never changes the result", async () => {
    const result = { ok: true as const, data: { state: "NEEDS_CLARIFICATION" as const, summary: HOSTILE, drafts: [], clarifications: [] } };
    const logInfo = vi.fn();
    const interpret = vi.fn(async () => result);
    const listApplications = vi.fn(async () => ({ ok: true, data: { items: [] } })) as unknown as ApplicationService["listApplications"];
    const dependencies = { getInterpreter: () => ({ interpret } as unknown as AssistantInterpreter), getApplicationService: () => ({ listApplications }) };
    await expect(createAssistantInterpretationService({ ...dependencies, logInfo }).interpret({ text: "abre algo" })).resolves.toEqual(result);
    expect(logInfo.mock.calls).toEqual([["interpret kind=clarification capability=none outcome=clarification domain=none"]]);
    await expect(createAssistantInterpretationService({ ...dependencies, logInfo: () => { throw new Error("private"); } }).interpret({ text: "abre algo" })).resolves.toEqual(result);
  });
});

describe("the transcript never leaves the renderer's transient state", () => {
  const TRANSCRIPT = "Escríbele a Ana García el código 4482 en WhatsApp";

  it("is absent from voice diagnostics, Main logs and the result's log lines", async () => {
    const logInfo = vi.fn();
    const logError = vi.fn();
    const service = createVoiceTranscriptionService({ createProvider: () => ({ transcribe: async () => TRANSCRIPT }), logInfo, logError } as never);
    const result = await service.transcribe({ audio: new Uint8Array(512).buffer, mimeType: "audio/webm", durationMs: 1500 });
    expect(result).toMatchObject({ ok: true, data: { text: TRANSCRIPT } });
    expect(JSON.stringify([logInfo.mock.calls, logError.mock.calls])).not.toMatch(/Ana|Garc|4482|WhatsApp|Escr/u);
    expect(formatVoiceDiagnostic({ stage: "transcription_done", text: TRANSCRIPT, transcript: TRANSCRIPT } as never)).not.toMatch(/Ana|4482/u);
  });

  it("is never written by the renderer to the console, storage or history, and shows only a transient line", () => {
    const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
    const app = read("src/renderer/app/App.tsx");
    expect(app.match(/setHeardText\(/gu)?.length).toBe(3);
    expect(app).toContain("setHeardText(result.data.text)");
    expect(app).toContain("setTimeout(() => setHeardText(undefined), 8000)");
    expect(app).not.toMatch(/console\.\w+\([^)\n]*heardText/u);
    expect(app).not.toMatch(/(?:localStorage|sessionStorage|indexedDB)[^;\n]*heardText|heardText[^;\n]*(?:localStorage|sessionStorage|indexedDB)/u);
    expect(app).not.toMatch(/window\.ares\.[a-z]+\.[a-zA-Z]+\([^)\n]*heardText/u);
    const view = read("src/renderer/views/ares-view.tsx");
    expect(view).toContain("`Escuché: «${heardText}»`");
    expect(view).toMatch(/aria-live="polite"[^>]*className="heard-line"/u);
    for (const file of ["src/main/voice/voice-transcription-service.ts", "src/main/assistant/interpretation-diagnostic.ts", "src/shared/voice-diagnostics.ts"]) {
      expect(read(file)).not.toMatch(/(?:log\w*|console\.\w+)\([^)\n]*(?:\.text\b|\btranscript\b|\btext\b)/u);
    }
  });
});
