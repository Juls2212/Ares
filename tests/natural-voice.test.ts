import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { composeFinalResponse } from "../src/main/voice/final-response-composer";
import { capSpokenText } from "../src/main/voice/spoken-text-cap";
import { createSpeechService } from "../src/main/voice/speech-service";
import { VOICE_CAPTURE_FAILURES } from "../src/shared/voice-diagnostics";
import { createRotatingPicker, firstVariant } from "../src/shared/phrase-variation";
import {
  TURN_STAGES,
  createTurnRing,
  createTurnTimer,
  formatTurnTiming
} from "../src/shared/turn-timing";

const DENYLIST = /borrador|capacidad|acción no|no fue posible|el sistema|esquema|propuesta de acción/iu;
const sentencesOf = (message: string): string[] => message.trim().split(/(?<=[.!?])\s+/u).filter((part) => part.length > 0);

const goldenMessages = (): [string, string][] => {
  const golden = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/golden/failure-outcome-golden.json"), "utf8")) as Record<string, unknown>;
  return Object.entries(golden)
    .filter(([key]) => key.endsWith("Table"))
    .flatMap(([table, value]): [string, string][] => {
      const entries: [string, unknown][] = typeof (value as { userMessage?: unknown }).userMessage === "string" ? [["", value]] : Object.entries(value as Record<string, unknown>);
      return entries.flatMap(([code, entry]): [string, string][] => {
        const message = typeof entry === "string" ? entry : (entry as { userMessage?: unknown }).userMessage;
        return typeof message === "string" ? [[`${table}.${code}`, message]] : [];
      });
    });
};

describe("natural wording", () => {
  it("keeps jargon out of every failure message, and every message short", () => {
    const messages = [...goldenMessages(), ...Object.entries(VOICE_CAPTURE_FAILURES.messages).map(([code, message]): [string, string] => [`voice.${code}`, message])];
    expect(messages.length).toBeGreaterThan(60);
    for (const [code, message] of messages) {
      expect(message, code).not.toMatch(DENYLIST);
      expect(message.length, code).toBeLessThanOrEqual(220);
      expect(sentencesOf(message).length, `${code}: ${message}`).toBeLessThanOrEqual(2);
    }
  });

  it("no longer prefixes interpreter output with «El borrador N:» and asks in a friendly way", async () => {
    const draft = (action: string, input: unknown) => JSON.stringify({
      state: "READY", summary: "x", responseText: "", clarifications: [],
      drafts: [{ action, input: JSON.stringify(input), approvedWeb: null }]
    });
    const interpreter = (output: string) => createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }), createProvider: () => ({ interpret: async () => output })
    });
    const result = await interpreter(draft("OPEN_APPLICATION", { alias: "spotify" })).interpret({ instruction: "abre Spotify" }, { knownApplicationAliases: [], knownCatalogApplications: [] });
    expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", summary: "Aún no tengo esa aplicación registrada. Pídeme que la registre primero." } });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(DENYLIST);
    expect(text).not.toMatch(/El borrador \d/u);
  });

  it("never mentions drafts in what the composer says, and keeps variants equivalent", () => {
    const outcome = (action: string, data: unknown) => ({ action, status: "SUCCEEDED", data }) as never;
    const cases = [
      outcome("OPEN_APPLICATION", { applicationName: "Spotify" }),
      outcome("SEARCH_APPROVED_SITE", { site: "GOOGLE" }),
      outcome("CREATE_TASK", { record: { id: "x" } }),
      outcome("CREATE_EVENT", { record: { id: "x" } })
    ];
    for (const item of cases) {
      const seen = new Set<string>();
      const picker = createRotatingPicker(0);
      for (let round = 0; round < 6; round += 1) seen.add(composeFinalResponse(item, picker)!);
      expect(seen.size).toBeGreaterThanOrEqual(2);
      for (const phrase of seen) {
        expect(phrase).not.toMatch(DENYLIST);
        expect(sentencesOf(phrase).length).toBeLessThanOrEqual(2);
      }
      expect(composeFinalResponse(item)).toBe(composeFinalResponse(item, firstVariant));
    }
    expect(composeFinalResponse(cases[0]!)).toBe("Listo, abrí Spotify.");
  });
});

describe("variation pickers", () => {
  it("are deterministic for an injected seed and rotate in order", () => {
    const variants = ["a", "b", "c"];
    const first = createRotatingPicker(1);
    const second = createRotatingPicker(1);
    const sequence = [0, 1, 2, 3, 4].map(() => first(variants));
    expect(sequence).toEqual(["b", "c", "a", "b", "c"]);
    expect([0, 1, 2, 3, 4].map(() => second(variants))).toEqual(sequence);
    expect(createRotatingPicker(-4.5)(variants)).toBe("a");
    expect(createRotatingPicker(Number.NaN)(variants)).toBe("a");
    expect(createRotatingPicker(0)([])).toBe("");
    expect(firstVariant(variants)).toBe("a");
  });
});

describe("spoken text cap", () => {
  it("leaves short replies untouched and never cuts inside a sentence", () => {
    expect(capSpokenText("Listo, abrí Spotify.")).toBe("Listo, abrí Spotify.");
    expect(capSpokenText("Una. Dos.")).toBe("Una. Dos.");
    expect(capSpokenText("Una frase. Dos frases. Tres frases. Cuatro frases.")).toBe("Una frase. Dos frases.");
    expect(capSpokenText("Hace 14,5 grados. Mañana llueve. Pasado mañana no.")).toBe("Hace 14,5 grados. Mañana llueve.");
    const long = `${"palabra ".repeat(40).trim()}.`;
    expect(capSpokenText(`${long} Otra frase corta.`)).toBe(long);
    expect(capSpokenText("")).toBe("");
    const veryLong = Array.from({ length: 30 }, (_, index) => `Frase número ${index}.`).join(" ");
    const capped = capSpokenText(veryLong);
    expect(capped.length).toBeLessThanOrEqual(240);
    expect(capped.endsWith(".")).toBe(true);
    expect(sentencesOf(capped).length).toBeLessThanOrEqual(2);
  });

  it("is applied to the synthesized text only, not to the remembered response shown on screen", async () => {
    const provider = vi.fn(async () => ({ audio: new Uint8Array([1, 2, 3]).buffer, mimeType: "audio/mpeg" as const }));
    const service = createSpeechService(() => provider);
    const text = "Primera frase. Segunda frase. Tercera frase. Cuarta frase.";
    const response = service.remember(1, text)!;
    expect(response.text).toBe(text);
    await service.speak(1, { responseId: response.responseId });
    expect(provider).toHaveBeenCalledWith("Primera frase. Segunda frase.", expect.anything());
  });
});

describe("turn timing", () => {
  it("emits one fixed-format line with stage names and millisecond durations only", () => {
    let clock = 1_000;
    const log = vi.fn();
    const ring = createTurnRing(3);
    const timer = createTurnTimer(log, () => clock, ring);
    for (const [stage, at] of [["recording_stopped", 1_000], ["transcription_done", 1_800], ["interpretation_done", 2_500], ["response_composed", 2_600], ["tts_first_audio", 3_300], ["playback_started", 3_350]] as const) {
      clock = at;
      timer.mark(stage);
    }
    timer.finish();
    timer.finish();
    timer.mark("execution_done");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toBe("turn-timing recording_stopped=0 transcription_done=800 interpretation_done=1500 response_composed=1600 tts_first_audio=2300 playback_started=2350 total_to_audio=2350");
    expect(ring.entries()).toHaveLength(1);
  });

  it("ignores hostile stage names and values, stays bounded, and never throws if logging does", () => {
    const secret = "Ana García C:\\Users\\Ana crear tarea sk-SECRET";
    const log = vi.fn();
    let clock = 0;
    const timer = createTurnTimer(log, () => clock, createTurnRing());
    for (const stage of [secret, "constructor", "__proto__", "", undefined, null, 5, {}, [TURN_STAGES[0]]]) timer.mark(stage);
    clock = Number.POSITIVE_INFINITY;
    timer.mark("recording_stopped");
    timer.finish();
    const line = String(log.mock.calls[0]![0]);
    expect(line).toMatch(/^turn-timing(?: [a-z_]+=\d+)*$/u);
    expect(line).not.toMatch(/Ana|Users|tarea|SECRET/u);
    expect(formatTurnTiming({ recording_stopped: 9e12, transcription_done: -5, playback_started: Number.NaN, ...({ [secret]: 1 } as object) })).toBe("turn-timing recording_stopped=600000 transcription_done=0");
    expect(() => createTurnTimer(() => { throw new Error("private"); }, () => 0, createTurnRing()).finish()).not.toThrow();
  });

  it("keeps only the most recent turns in memory", () => {
    const ring = createTurnRing(3);
    for (let index = 0; index < 10; index += 1) ring.push({ recording_stopped: index });
    expect(ring.entries().map((entry) => entry.recording_stopped)).toEqual([7, 8, 9]);
  });
});
