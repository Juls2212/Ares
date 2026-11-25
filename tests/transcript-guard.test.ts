import { describe, expect, it, vi } from "vitest";

import { DEFAULT_TRANSCRIPTION_MODEL, getOpenAiTranscriptionConfiguration } from "../src/main/config/openai-environment";
import { createVoiceTranscriptionService } from "../src/main/voice/voice-transcription-service";
import {
  REPEAT_EXAMPLES,
  TRANSCRIBE_OUTCOMES,
  evaluateTranscript,
  formatTranscribeLine,
  repeatRequestMessage
} from "../src/shared/transcript-guard";
import {
  VOICE_AUDIO_BITS_PER_SECOND,
  VOICE_AUDIO_CONSTRAINTS,
  VOICE_MIN_RECORDING_MS
} from "../src/shared/voice-capture";
import { readSource } from "./helpers/read-source";

describe("transcript guard: accepted text", () => {
  it.each([
    "abre la calculadora",
    "¿Qué hora es?",
    "Busca mis recibos del año pasado",
    "Escríbele a María José Núñez que llego tarde",
    "Pon música de Shakira",
    "dime cómo está mi equipo",
    "qué tengo hoy en la agenda",
    "abre Spotify",
    "ok",
    "sí",
    "Recuérdame llamar a Andrés mañana a las 8"
  ])("accepts %s", (text) => {
    expect(evaluateTranscript(text)).toBe("TRANSCRIPT_OK");
  });

  it("accepts Spanish with a few English words, names and brands", () => {
    expect(evaluateTranscript("abre Google Chrome y busca the best pizza")).toBe("TRANSCRIPT_OK");
    expect(evaluateTranscript("pon un recordatorio para el meeting de las tres")).toBe("TRANSCRIPT_OK");
  });
});

describe("transcript guard: rejected text", () => {
  it("rejects empty and blank text and anything that is not a string", () => {
    for (const value of ["", "   ", "\n\t", undefined, null, 5, {}]) expect(evaluateTranscript(value)).toBe("TRANSCRIPT_EMPTY");
  });

  it("rejects text that is mostly non-Latin script as another language", () => {
    for (const text of ["こんにちは、今日の天気は？", "Привет, как дела", "你好，现在几点了", "مرحبا كيف حالك", "안녕하세요 지금 몇 시예요", "γεια σου τι κάνεις"]) {
      expect(evaluateTranscript(text)).toBe("TRANSCRIPT_REJECTED_LANGUAGE");
    }
    expect(evaluateTranscript("abre 你好吗朋友们")).toBe("TRANSCRIPT_REJECTED_LANGUAGE");
  });

  it("rejects text with too few letters, punctuation, digits and filler only", () => {
    for (const text of ["a", "...", "?", "12", "¡!", "😀", "eh", "Mmm", "eh, mm, ah", "Hmm... uh"]) {
      expect(evaluateTranscript(text)).toBe("TRANSCRIPT_TOO_SHORT");
    }
  });

  it("rejects the usual speech-model hallucinations on silence", () => {
    for (const text of ["Subtítulos realizados por la comunidad de Amara.org", "Gracias por ver el vídeo", "Thanks for watching!", "Suscríbete al canal"]) {
      expect(evaluateTranscript(text)).toBe("TRANSCRIPT_REJECTED_LANGUAGE");
    }
  });

  it("rejects an obviously English sentence but not a short or mixed command", () => {
    expect(evaluateTranscript("what is the time in this city")).toBe("TRANSCRIPT_REJECTED_LANGUAGE");
    expect(evaluateTranscript("please open the browser for me")).toBe("TRANSCRIPT_REJECTED_LANGUAGE");
    expect(evaluateTranscript("open Chrome")).toBe("TRANSCRIPT_OK");
    expect(evaluateTranscript("abre the browser")).toBe("TRANSCRIPT_OK");
  });

  it("is pure: the same input gives the same outcome and nothing is mutated", () => {
    const text = "Привет";
    expect(evaluateTranscript(text)).toBe(evaluateTranscript(text));
  });
});

describe("request to repeat", () => {
  it("is fixed Spanish that varies, never contains the transcript, and rejects the OK outcome by type", () => {
    const messages = REPEAT_EXAMPLES.map((_, index) => repeatRequestMessage("TRANSCRIPT_REJECTED_LANGUAGE", index));
    expect(new Set(messages).size).toBe(REPEAT_EXAMPLES.length);
    for (const message of messages) expect(message).toMatch(/Repite con una frase corta y natural/u);
    expect(repeatRequestMessage("TRANSCRIPT_TOO_SHORT", 0)).toMatch(/^Te escuché muy poco\./u);
    expect(repeatRequestMessage("TRANSCRIPT_EMPTY", 1)).toMatch(/^No se entendió lo que dijiste\./u);
    expect(repeatRequestMessage("TRANSCRIPT_EMPTY", -3)).toBe(repeatRequestMessage("TRANSCRIPT_EMPTY", -3));
    expect(repeatRequestMessage("TRANSCRIPT_EMPTY", 1e9)).toMatch(/«/u);
  });
});

describe("transcription service with the guard and the diagnostic line", () => {
  const audio = new Uint8Array(2048).buffer;
  const build = (text: string, extra: Record<string, unknown> = {}) => {
    const logInfo = vi.fn();
    const logError = vi.fn();
    const service = createVoiceTranscriptionService({
      getConfiguration: () => ({ apiKey: "private-key", transcriptionModel: "gpt-4o-transcribe" }),
      createProvider: () => ({ transcribe: async () => text }),
      logInfo,
      logError,
      ...extra
    } as never);
    return { service, logInfo, logError };
  };
  const transcribeLines = (logInfo: ReturnType<typeof vi.fn>) => logInfo.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("transcribe "));

  it("returns accepted Spanish and logs one privacy-safe line", async () => {
    const { service, logInfo } = build("Abre la calculadora");
    await expect(service.transcribe({ audio, mimeType: "audio/webm", durationMs: 2400 })).resolves.toEqual({ ok: true, data: { text: "Abre la calculadora" } });
    expect(transcribeLines(logInfo)).toEqual(["transcribe model=gpt-4o-transcribe lang=es durationMs=2400 bytes=2048 outcome=TRANSCRIPT_OK"]);
  });

  it("does not return rejected text, asks to repeat in Spanish and logs the closed outcome without the text", async () => {
    const { service, logInfo, logError } = build("こんにちは、今日の天気は？");
    const result = await service.transcribe({ audio, mimeType: "audio/webm", durationMs: 1500 });
    expect(result).toMatchObject({ ok: false, error: { code: "VOICE_TRANSCRIPT_REJECTED_LANGUAGE" } });
    expect(JSON.stringify(result)).not.toContain("こんにちは");
    expect((result as { error: { userMessage: string } }).error.userMessage).toMatch(/Repite con una frase corta y natural/u);
    expect(transcribeLines(logInfo)).toEqual(["transcribe model=gpt-4o-transcribe lang=es durationMs=1500 bytes=2048 outcome=TRANSCRIPT_REJECTED_LANGUAGE"]);
    expect(JSON.stringify([logInfo.mock.calls, logError.mock.calls])).not.toMatch(/こんにちは|private-key/u);
  });

  it("rejects filler, varies the example between two rejections, and keeps the empty-text behavior", async () => {
    const { service, logInfo } = build("mmm");
    const first = await service.transcribe({ audio, mimeType: "audio/webm", durationMs: 900 });
    const second = await service.transcribe({ audio, mimeType: "audio/webm", durationMs: 900 });
    expect(first).toMatchObject({ ok: false, error: { code: "VOICE_TRANSCRIPT_TOO_SHORT" } });
    expect((first as { error: { userMessage: string } }).error.userMessage).not.toBe((second as { error: { userMessage: string } }).error.userMessage);
    expect(transcribeLines(logInfo)[0]).toContain("outcome=TRANSCRIPT_TOO_SHORT");

    const empty = build("   ");
    await expect(empty.service.transcribe({ audio, mimeType: "audio/webm", durationMs: 900 })).resolves.toMatchObject({ ok: false, error: { code: "VOICE_TRANSCRIPT_EMPTY" } });
    expect(transcribeLines(empty.logInfo)[0]).toContain("outcome=TRANSCRIPT_EMPTY");
  });

  it("logs provider and configuration failures with their own outcome", async () => {
    const failing = build("x", { createProvider: () => ({ transcribe: async () => { throw { status: 500 }; } }) });
    await failing.service.transcribe({ audio, mimeType: "audio/webm", durationMs: 1200 });
    expect(transcribeLines(failing.logInfo)[0]).toContain("outcome=PROVIDER_FAILED");

    const unconfigured = build("x", { getConfiguration: () => { throw new Error("no key"); } });
    await unconfigured.service.transcribe({ audio, mimeType: "audio/webm", durationMs: 1200 });
    expect(transcribeLines(unconfigured.logInfo)[0]).toBe("transcribe model=custom lang=es durationMs=1200 bytes=2048 outcome=CONFIGURATION_UNAVAILABLE");
  });
});

describe("diagnostic line format", () => {
  it("has the fixed shape and only closed or bounded values", () => {
    expect(formatTranscribeLine({ model: "gpt-4o-mini-transcribe", durationMs: 1830.9, bytes: 40_000, outcome: "TRANSCRIPT_OK" }))
      .toBe("transcribe model=gpt-4o-mini-transcribe lang=es durationMs=1830 bytes=40000 outcome=TRANSCRIPT_OK");
    for (const outcome of TRANSCRIBE_OUTCOMES) expect(formatTranscribeLine({ model: "m", durationMs: 1, bytes: 1, outcome })).toContain(`outcome=${outcome}`);
  });

  it("never prints a hostile model name, a negative or huge number, or an unknown outcome", () => {
    const line = formatTranscribeLine({ model: "C:\\Users\\Ana\\sk-secret value", durationMs: -5, bytes: 1e15, outcome: "hola que tal" });
    expect(line).toBe("transcribe model=custom lang=es durationMs=0 bytes=100000000 outcome=INVALID");
    expect(line).not.toMatch(/Ana|secret|hola/u);
    expect(formatTranscribeLine({ model: undefined, durationMs: NaN, bytes: "9", outcome: undefined })).toBe("transcribe model=custom lang=es durationMs=0 bytes=0 outcome=INVALID");
  });
});

describe("transcription model and capture settings", () => {
  it("defaults to gpt-4o-transcribe when the variable is unset or blank, and keeps the override", () => {
    expect(DEFAULT_TRANSCRIPTION_MODEL).toBe("gpt-4o-transcribe");
    expect(getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "k" } as never).transcriptionModel).toBe("gpt-4o-transcribe");
    expect(getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "k", OPENAI_TRANSCRIPTION_MODEL: "  " } as never).transcriptionModel).toBe("gpt-4o-transcribe");
    expect(getOpenAiTranscriptionConfiguration({ OPENAI_API_KEY: "k", OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe" } as never).transcriptionModel).toBe("gpt-4o-mini-transcribe");
  });

  it("sends Spanish and no recognition hint to the provider", () => {
    const provider = readSource("src/main/voice/openai-transcription-provider.ts");
    expect(provider).toContain('language: "es"');
    expect(provider).not.toMatch(/^\s*prompt\s*:/mu);
    expect(provider).not.toMatch(/temperature/u);
    expect(readSource("src/main/voice/voice-transcription-service.ts")).not.toContain("TRANSCRIPTION_PROMPT_HINT");
  });

  it("requests mono audio with echo cancellation, noise suppression and automatic gain control, and a minimum length", () => {
    expect(VOICE_AUDIO_CONSTRAINTS).toEqual({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    expect(VOICE_MIN_RECORDING_MS).toBe(400);
    expect(VOICE_AUDIO_BITS_PER_SECOND).toBe(64_000);
    const app = readSource("src/renderer/app/App.tsx");
    expect(app).toContain("getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS })");
    expect(app).toContain("audioBitsPerSecond: VOICE_AUDIO_BITS_PER_SECOND");
    expect(app).toContain("minimumDurationMs: VOICE_MIN_RECORDING_MS");
  });

  it("makes no network call and uses no language service in the guard", () => {
    expect(readSource("src/shared/transcript-guard.ts")).not.toMatch(/fetch\(|import\s.*from\s+"(?!\.)|require\(|XMLHttpRequest/u);
  });
});

describe("minimum recording length", () => {
  const record = async (elapsedMs: number, minimumDurationMs?: number) => {
    const { createManualVoiceRecorder } = await import("../src/renderer/features/voice/manual-voice-recorder");
    let clock = 0;
    let recorder: { state: "inactive" | "recording" | "paused"; mimeType: string; ondataavailable: ((event: BlobEvent) => unknown) | null; onstop: ((event: Event) => unknown) | null; start: () => void; stop: () => void } | undefined;
    const onAudio = vi.fn();
    const onUnavailable = vi.fn();
    const voice = createManualVoiceRecorder({
      getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
      createRecorder: () => (recorder = { state: "inactive", mimeType: "audio/webm", ondataavailable: null, onstop: null, start: () => { recorder!.state = "recording"; }, stop: () => { recorder!.state = "inactive"; recorder!.onstop?.(new Event("stop")); } }),
      isMimeTypeSupported: (mime) => mime === "audio/webm",
      createBlob: (parts, options) => new Blob(parts, options),
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: vi.fn(),
      onRecording: vi.fn(), onProcessing: vi.fn(), onUnavailable, onCancelled: vi.fn(), onAudio,
      now: () => clock,
      minimumDurationMs
    });
    await voice.start();
    recorder?.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
    clock = elapsedMs;
    voice.stop();
    return { onAudio, onUnavailable };
  };

  it("does not send a tap, and sends a real recording", async () => {
    const tap = await record(150, VOICE_MIN_RECORDING_MS);
    expect(tap.onAudio).not.toHaveBeenCalled();
    expect(tap.onUnavailable).toHaveBeenCalledWith(expect.stringContaining("muy corta"));
    const spoken = await record(1200, VOICE_MIN_RECORDING_MS);
    expect(spoken.onAudio).toHaveBeenCalledOnce();
    expect(spoken.onUnavailable).not.toHaveBeenCalled();
  });

  it("applies no minimum unless one is given", async () => {
    const outcome = await record(10);
    expect(outcome.onAudio).toHaveBeenCalledOnce();
  });
});
