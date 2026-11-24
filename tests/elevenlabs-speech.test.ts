import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ELEVENLABS_FAILURES,
  ELEVENLABS_MAX_AUDIO_BYTES,
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_OUTPUT_FORMAT,
  ELEVENLABS_VOICE_SETTINGS,
  ElevenLabsSpeechError,
  createElevenLabsSpeechProvider
} from "../src/main/voice/elevenlabs-speech-provider";
import { createFallbackSpeechProvider } from "../src/main/voice/speech-provider-selection";
import { createSpeechService } from "../src/main/voice/speech-service";
import { getElevenLabsSpeechConfiguration } from "../src/main/config/openai-environment";

const KEY = "sk-HOSTILE-KEY-123456";
const VOICE = "AbCdEfGhIjKlMnOpQrSt";
const configuration = { apiKey: KEY, voiceId: VOICE };
const audioResponse = (bytes: number[] = [1, 2, 3], type = "audio/mpeg", status = 200): Response => new Response(new Uint8Array(bytes), { status, headers: { "content-type": type } });
const run = (text = "Listo.") => createElevenLabsSpeechProvider(configuration)(text, new AbortController().signal);
const codeOf = async (promise: Promise<unknown>): Promise<string> => promise.then(() => "OK", (error: { code?: string }) => error.code ?? "UNKNOWN");

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("ElevenLabs provider", () => {
  it("sends one request with the expected URL, header names, model and body fields only", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    const result = await run("Hola  **mundo**.");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(new Uint8Array(result.audio)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`);
    expect(Object.keys(init.headers as object).sort()).toEqual(["accept", "content-type", "xi-api-key"]);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["language_code", "model_id", "text", "voice_settings"]);
    expect(body).toMatchObject({ text: "Hola mundo.", model_id: ELEVENLABS_MODEL_ID, language_code: "es", voice_settings: ELEVENLABS_VOICE_SETTINGS });
    expect(ELEVENLABS_MODEL_ID).toBe("eleven_flash_v2_5");
  });

  it.each([
    [401, "ELEVENLABS_UNAUTHORIZED"], [403, "ELEVENLABS_UNAUTHORIZED"], [402, "ELEVENLABS_QUOTA_EXCEEDED"], [429, "ELEVENLABS_QUOTA_EXCEEDED"],
    [404, "ELEVENLABS_VOICE_NOT_FOUND"], [422, "ELEVENLABS_VOICE_NOT_FOUND"], [500, "ELEVENLABS_UNAVAILABLE"], [503, "ELEVENLABS_UNAVAILABLE"], [400, "ELEVENLABS_RESPONSE_INVALID"]
  ])("maps HTTP %i to %s without retrying", async (status, code) => {
    const fetchMock = vi.fn(async () => new Response(`{"detail":"${KEY}"}`, { status }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await codeOf(run())).toBe(code);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps invalid responses: non-audio content type, empty body and oversize body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => audioResponse([1], "application/json")));
    expect(await codeOf(run())).toBe("ELEVENLABS_RESPONSE_INVALID");
    vi.stubGlobal("fetch", vi.fn(async () => audioResponse([])));
    expect(await codeOf(run())).toBe("ELEVENLABS_RESPONSE_INVALID");
    vi.stubGlobal("fetch", vi.fn(async () => audioResponse(new Array<number>(ELEVENLABS_MAX_AUDIO_BYTES + 1).fill(1))));
    expect(await codeOf(run())).toBe("ELEVENLABS_RESPONSE_INVALID");
  });

  it("retries a network error once, then reports UNAVAILABLE; a retry can succeed", async () => {
    const failing = vi.fn(async () => { throw new TypeError(`fetch failed ${KEY}`); });
    vi.stubGlobal("fetch", failing);
    expect(await codeOf(run())).toBe("ELEVENLABS_UNAVAILABLE");
    expect(failing).toHaveBeenCalledTimes(2);
    const flaky = vi.fn().mockRejectedValueOnce(new TypeError("down")).mockResolvedValueOnce(audioResponse());
    vi.stubGlobal("fetch", flaky);
    expect(await codeOf(run())).toBe("OK");
  });

  it("times out after 8 seconds without retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = codeOf(run());
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await pending).toBe("ELEVENLABS_TIMEOUT");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects hostile voice ids and a missing configuration before any request", async () => {
    const fetchMock = vi.fn(async () => audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    for (const voiceId of ["../v1/user", "abc/def/ghijkl", "voice?x=1&y=2", "a b c d e f g h", "short", "x".repeat(65), "", "voz%2F12345678", "voz\n12345678"]) {
      expect(await codeOf(createElevenLabsSpeechProvider({ apiKey: KEY, voiceId })("Hola.", signal)), voiceId).toBe("ELEVENLABS_NOT_CONFIGURED");
    }
    expect(await codeOf(createElevenLabsSpeechProvider(undefined)("Hola.", signal))).toBe("ELEVENLABS_NOT_CONFIGURED");
    expect(await codeOf(createElevenLabsSpeechProvider({ apiKey: "", voiceId: VOICE })("Hola.", signal))).toBe("ELEVENLABS_NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never lets the key, voice id or spoken text reach an error or a taxonomy message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`${KEY} ${VOICE} secreto`); }));
    const error = await run("texto secreto").catch((caught: Error) => caught);
    const text = JSON.stringify([String(error), (error as Error).message, ...Object.values(ELEVENLABS_FAILURES.messages)]);
    expect(text).not.toMatch(/HOSTILE|AbCdEf|secreto/u);
    expect(ELEVENLABS_FAILURES.codes).toHaveLength(7);
  });

  it("reads its settings only when both names are set", () => {
    expect(getElevenLabsSpeechConfiguration({ ELEVENLABS_API_KEY: " k ", ELEVENLABS_VOICE_ID: " v " } as never)).toEqual({ apiKey: "k", voiceId: "v" });
    expect(getElevenLabsSpeechConfiguration({ ELEVENLABS_API_KEY: "k" } as never)).toBeUndefined();
    expect(getElevenLabsSpeechConfiguration({ ELEVENLABS_VOICE_ID: "v" } as never)).toBeUndefined();
  });
});

describe("provider selection and fallback", () => {
  const openAi = vi.fn(async (_text: string, _signal: AbortSignal) => ({ audio: new Uint8Array([9]).buffer, mimeType: "audio/mpeg" as const }));
  const select = (configured: boolean, eleven: () => Promise<unknown>) => {
    const log = vi.fn();
    openAi.mockClear();
    const provider = createFallbackSpeechProvider({
      elevenLabsConfiguration: () => (configured ? configuration : undefined),
      createElevenLabs: () => eleven as never,
      createOpenAi: () => openAi,
      log
    });
    return { provider, log };
  };

  it("uses OpenAI without logging when ElevenLabs is not configured", async () => {
    const eleven = vi.fn(async () => undefined);
    const { provider, log } = select(false, eleven);
    await provider("Hola.", new AbortController().signal);
    expect(eleven).not.toHaveBeenCalled(); expect(openAi).toHaveBeenCalledOnce(); expect(log).not.toHaveBeenCalled();
  });

  it("uses ElevenLabs when configured and logs one success line", async () => {
    const { provider, log } = select(true, async () => ({ audio: new Uint8Array([1]).buffer, mimeType: "audio/mpeg" }));
    expect(new Uint8Array((await provider("Hola.", new AbortController().signal)).audio)[0]).toBe(1);
    expect(openAi).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([["Speech provider used [ELEVENLABS]."]]);
  });

  it.each([...ELEVENLABS_FAILURES.codes])("falls back to OpenAI for %s and logs only the code", async (code) => {
    const { provider, log } = select(true, async () => { throw new ElevenLabsSpeechError(code); });
    expect(new Uint8Array((await provider("Texto privado.", new AbortController().signal)).audio)[0]).toBe(9);
    expect(log.mock.calls).toEqual([[`Speech provider fallback to OpenAI [${code}].`]]);
  });

  it("falls back on an unexpected error without logging its text, and does not fall back when cancelled", async () => {
    const { provider, log } = select(true, async () => { throw new Error(`${KEY} Texto privado`); });
    await provider("x.", new AbortController().signal);
    expect(String(log.mock.calls[0]![0])).toBe("Speech provider fallback to OpenAI [ELEVENLABS_UNAVAILABLE].");
    const cancelled = new AbortController(); cancelled.abort();
    const second = select(true, async () => { throw new Error("aborted"); });
    await expect(second.provider("x.", cancelled.signal)).rejects.toThrow();
    expect(openAi).not.toHaveBeenCalled();
  });

  it("keeps the spoken-text cap, the response id and the cancel behavior of the speech service", async () => {
    const seen = vi.fn(async (_text: string, _signal: AbortSignal) => ({ audio: new Uint8Array([1]).buffer, mimeType: "audio/mpeg" as const }));
    const service = createSpeechService(() => createFallbackSpeechProvider({
      elevenLabsConfiguration: () => configuration, createElevenLabs: () => seen, createOpenAi: () => openAi, log: vi.fn()
    }));
    const response = service.remember(1, "Primera frase. Segunda frase. Tercera frase.")!;
    expect((await service.speak(1, { responseId: response.responseId })).ok).toBe(true);
    expect(seen).toHaveBeenCalledWith("Primera frase. Segunda frase.", expect.anything());
    expect(await service.speak(1, { responseId: "otro" })).toMatchObject({ ok: false, error: { code: "SPEECH_RESPONSE_INVALID" } });
    service.clear(1);
    expect(await service.speak(1, { responseId: response.responseId })).toMatchObject({ ok: false });
  });
});
