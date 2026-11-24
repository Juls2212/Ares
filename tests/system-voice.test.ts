import { afterEach, describe, expect, it, vi } from "vitest";

import { createResponsePlayback, type PlaybackEvent, type PlaybackState } from "../src/renderer/features/voice/response-playback";
import {
  NO_SYSTEM_VOICE_MESSAGE,
  SYSTEM_VOICE_FALLBACK_CODES,
  capForSystemVoice,
  createSystemVoice,
  selectSpanishVoice,
  type SynthesisLike,
  type UtteranceLike,
  type VoiceLike
} from "../src/renderer/features/voice/system-voice";
import { readSource } from "./helpers/read-source";

const voice = (lang: string, name = lang): VoiceLike => ({ lang, name });

describe("system voice: choosing a Spanish voice", () => {
  it("prefers es-CO, then es-MX, then es-ES, then any other Spanish voice", () => {
    const all = [voice("en-US"), voice("es-AR"), voice("es-ES"), voice("es-MX"), voice("es-CO"), voice("fr-FR")];
    expect(selectSpanishVoice(all)?.lang).toBe("es-CO");
    expect(selectSpanishVoice(all.filter((entry) => entry.lang !== "es-CO"))?.lang).toBe("es-MX");
    expect(selectSpanishVoice(all.filter((entry) => !["es-CO", "es-MX"].includes(entry.lang)))?.lang).toBe("es-ES");
    expect(selectSpanishVoice(all.filter((entry) => ["en-US", "es-AR", "fr-FR"].includes(entry.lang)))?.lang).toBe("es-AR");
    expect(selectSpanishVoice([voice("es")])?.lang).toBe("es");
  });

  it("accepts underscores and any case, takes the first of a tier, and never picks a non-Spanish voice", () => {
    expect(selectSpanishVoice([voice("ES_co", "first"), voice("es-CO", "second")])?.name).toBe("first");
    expect(selectSpanishVoice([voice("en-US"), voice("pt-BR"), voice("esperanto"), voice("")])).toBeUndefined();
    expect(selectSpanishVoice([])).toBeUndefined();
  });
});

describe("system voice: the text that is spoken", () => {
  it("applies the same cap the providers get: two sentences, and the agenda cap for a long answer", () => {
    expect(capForSystemVoice("Primera frase. Segunda frase. Tercera frase.")).toBe("Primera frase. Segunda frase.");
    const agenda = Array.from({ length: 6 }, (_unused, index) => `Tienes el evento número ${index + 1} con un título bastante largo para que la lista pase de cuatrocientos caracteres.`).join(" ");
    expect(agenda.length).toBeGreaterThan(400);
    expect(capForSystemVoice(agenda).split(/(?<=\.)\s/u).length).toBeGreaterThan(2);
    expect(capForSystemVoice(agenda).length).toBeLessThanOrEqual(600 + 100);
  });
});

type FakeUtterance = UtteranceLike & { text: string };
const fakeSynthesis = (voices: VoiceLike[], options: { late?: boolean } = {}) => {
  let current = options.late ? [] : voices;
  const listeners = new Set<() => void>();
  const spoken: FakeUtterance[] = [];
  const synthesis: SynthesisLike = {
    getVoices: () => current,
    speak: (utterance) => { spoken.push(utterance as unknown as FakeUtterance); },
    cancel: vi.fn(),
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); }
  };
  return {
    synthesis, spoken,
    loadVoices: () => { current = voices; for (const listener of [...listeners]) listener(); },
    listenerCount: () => listeners.size
  };
};
const createUtterance = (text: string): FakeUtterance => ({ text, lang: "", voice: undefined, rate: 0, pitch: 0, volume: 0, onstart: null, onend: null, onerror: null });
const handlers = () => ({ onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });

describe("system voice: speaking", () => {
  it("speaks the capped text with the chosen voice at the normal rate and reports start and end", async () => {
    const fake = fakeSynthesis([voice("en-US"), voice("es-MX"), voice("es-CO")]);
    const systemVoice = createSystemVoice({ getSynthesis: () => fake.synthesis, createUtterance });
    const events = handlers();
    expect(await systemVoice.speak("Una. Dos. Tres.", events)).toBe("STARTED");
    expect(fake.spoken).toHaveLength(1);
    const utterance = fake.spoken[0]!;
    expect(utterance).toMatchObject({ text: "Una. Dos.", lang: "es-CO", rate: 1, pitch: 1, volume: 1 });
    expect((utterance.voice as VoiceLike).lang).toBe("es-CO");
    utterance.onstart?.();
    utterance.onend?.();
    expect(events.onStart).toHaveBeenCalledOnce();
    expect(events.onEnd).toHaveBeenCalledOnce();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("reports an error from the engine", async () => {
    const fake = fakeSynthesis([voice("es-ES")]);
    const events = handlers();
    await createSystemVoice({ getSynthesis: () => fake.synthesis, createUtterance }).speak("Hola.", events);
    fake.spoken[0]!.onerror?.();
    expect(events.onError).toHaveBeenCalledOnce();
  });

  it("can be cancelled: the engine stops and a late event is ignored", async () => {
    const fake = fakeSynthesis([voice("es-ES")]);
    const systemVoice = createSystemVoice({ getSynthesis: () => fake.synthesis, createUtterance });
    const events = handlers();
    await systemVoice.speak("Hola.", events);
    const cancelCalls = vi.mocked(fake.synthesis.cancel).mock.calls.length;
    systemVoice.cancel();
    expect(vi.mocked(fake.synthesis.cancel).mock.calls.length).toBe(cancelCalls + 1);
    fake.spoken[0]!.onstart?.();
    fake.spoken[0]!.onend?.();
    fake.spoken[0]!.onerror?.();
    expect(events.onStart).not.toHaveBeenCalled();
    expect(events.onEnd).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("reports that there is no Spanish voice, and that there is no speech synthesis at all", async () => {
    const english = fakeSynthesis([voice("en-US"), voice("fr-FR")]);
    expect(await createSystemVoice({ getSynthesis: () => english.synthesis, createUtterance }).speak("Hola.", handlers())).toBe("NO_VOICE");
    expect(english.spoken).toHaveLength(0);
    expect(await createSystemVoice({ getSynthesis: () => undefined, createUtterance }).speak("Hola.", handlers())).toBe("UNAVAILABLE");
    expect(await createSystemVoice({ getSynthesis: () => fakeSynthesis([voice("es-CO")]).synthesis, createUtterance: () => { throw new Error("no utterance"); } }).speak("Hola.", handlers())).toBe("UNAVAILABLE");
    expect(await createSystemVoice({ getSynthesis: () => fakeSynthesis([voice("es-CO")]).synthesis, createUtterance }).speak("   ", handlers())).toBe("NO_VOICE");
    expect(() => createSystemVoice({ getSynthesis: () => undefined, createUtterance }).cancel()).not.toThrow();
  });

  it("waits for a voice list that loads late, and gives up after a moment", async () => {
    const late = fakeSynthesis([voice("es-MX")], { late: true });
    const systemVoice = createSystemVoice({ getSynthesis: () => late.synthesis, createUtterance });
    const pending = systemVoice.speak("Hola.", handlers());
    late.loadVoices();
    expect(await pending).toBe("STARTED");
    expect(late.spoken[0]).toMatchObject({ lang: "es-MX" });
    expect(late.listenerCount()).toBe(0);

    vi.useFakeTimers();
    try {
      const never = fakeSynthesis([voice("es-MX")], { late: true });
      const waiting = createSystemVoice({ getSynthesis: () => never.synthesis, createUtterance, voicesWaitMs: 500 }).speak("Hola.", handlers());
      await vi.advanceTimersByTimeAsync(500);
      expect(await waiting).toBe("NO_VOICE");
      expect(never.listenerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second request replaces the first", async () => {
    const fake = fakeSynthesis([voice("es-CO")]);
    const systemVoice = createSystemVoice({ getSynthesis: () => fake.synthesis, createUtterance });
    const first = handlers();
    const second = handlers();
    await systemVoice.speak("Primera.", first);
    await systemVoice.speak("Segunda.", second);
    fake.spoken[0]!.onend?.();
    fake.spoken[1]!.onend?.();
    expect(first.onEnd).not.toHaveBeenCalled();
    expect(second.onEnd).toHaveBeenCalledOnce();
  });
});

describe("system voice: nothing is logged, sent or stored", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("writes nothing to the console while speaking, cancelling or failing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const fake = fakeSynthesis([voice("es-CO")]);
    const systemVoice = createSystemVoice({ getSynthesis: () => fake.synthesis, createUtterance });
    await systemVoice.speak("Texto privado con 3001234567.", handlers());
    fake.spoken[0]!.onerror?.();
    systemVoice.cancel();
    await createSystemVoice({ getSynthesis: () => undefined, createUtterance }).speak("Texto privado.", handlers());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("has no IPC, network or storage in its source", () => {
    const source = readSource("src/renderer/features/voice/system-voice.ts");
    expect(source).not.toMatch(/window\.ares|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|console\./u);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ */
/* The fallback inside the playback state machine                                                                       */
/* ------------------------------------------------------------------------------------------------------------------ */

const failure = (code: string) => ({ ok: false as const, error: { code, userMessage: "x" } });

const playbackWith = (result: unknown, systemVoice: Parameters<typeof createResponsePlayback>[0]["systemVoice"]) => {
  const states: PlaybackState[] = [];
  const events: PlaybackEvent[] = [];
  const failures: string[] = [];
  const createAudio = vi.fn();
  const playback = createResponsePlayback({
    speak: vi.fn(async () => result) as never,
    systemVoice,
    createUrl: vi.fn(), revokeUrl: vi.fn(), createAudio: createAudio as never,
    onState: (state) => states.push(state),
    onFailure: (category) => failures.push(category),
    onPlaybackEvent: (event) => events.push(event)
  });
  return { playback, states, events, failures, createAudio };
};

describe("system voice: fallback when no provider can speak", () => {
  it("is used only for the two failure codes that mean no provider is available", () => {
    expect([...SYSTEM_VOICE_FALLBACK_CODES].sort()).toEqual(["SPEECH_CONFIGURATION_UNAVAILABLE", "SPEECH_PROVIDER_UNAVAILABLE"]);
  });

  it.each(["SPEECH_CONFIGURATION_UNAVAILABLE", "SPEECH_PROVIDER_UNAVAILABLE"])("speaks the response with the system voice after %s and finishes cleanly", async (code) => {
    let handlersRef: { onStart: () => void; onEnd: () => void; onError: () => void } | undefined;
    const speak = vi.fn(async (_id: string, given: NonNullable<typeof handlersRef>) => { handlersRef = given; return "STARTED" as const; });
    const cancel = vi.fn();
    const run = playbackWith(failure(code), { speak, cancel });
    await run.playback.play("response-1");
    expect(speak).toHaveBeenCalledWith("response-1", expect.any(Object));
    expect(run.states).toEqual(["IDLE", "LOADING"]);
    handlersRef!.onStart();
    handlersRef!.onEnd();
    expect(run.states).toEqual(["IDLE", "LOADING", "PLAYING", "IDLE", "FINISHED"]);
    expect(run.events.map((event) => event.type)).toEqual(["PLAYING", "ENDED"]);
    expect(run.failures).toEqual([]);
    expect(run.createAudio).not.toHaveBeenCalled();
  });

  it("stops the system voice through the existing stop path", async () => {
    const speak = vi.fn(async () => "STARTED" as const);
    const cancel = vi.fn();
    const run = playbackWith(failure("SPEECH_CONFIGURATION_UNAVAILABLE"), { speak, cancel });
    await run.playback.play("response-2");
    run.playback.stop();
    expect(cancel).toHaveBeenCalledOnce();
    expect(run.events.at(-1)).toMatchObject({ type: "STOPPED", responseId: "response-2" });
    expect(run.states.at(-1)).toBe("IDLE");
  });

  it("keeps the answer as text only, without an error, when there is no Spanish voice", async () => {
    const onNoVoice = vi.fn();
    const run = playbackWith(failure("SPEECH_PROVIDER_UNAVAILABLE"), { speak: async () => "NO_VOICE", cancel: vi.fn(), onNoVoice });
    await run.playback.play("response-3");
    expect(onNoVoice).toHaveBeenCalledOnce();
    expect(run.states).toEqual(["IDLE", "LOADING", "IDLE"]);
    expect(run.failures).toEqual([]);
    expect(run.events).toEqual([]);
    const unavailable = playbackWith(failure("SPEECH_CONFIGURATION_UNAVAILABLE"), { speak: async () => "UNAVAILABLE", cancel: vi.fn(), onNoVoice });
    await unavailable.playback.play("response-4");
    expect(unavailable.states).toEqual(["IDLE", "LOADING", "IDLE"]);
  });

  it("reports an engine error as the usual playback failure", async () => {
    let given: { onError: () => void } | undefined;
    const run = playbackWith(failure("SPEECH_CONFIGURATION_UNAVAILABLE"), { speak: async (_id, handlersArg) => { given = handlersArg; return "STARTED"; }, cancel: vi.fn() });
    await run.playback.play("response-5");
    given!.onError();
    expect(run.failures).toEqual(["AUDIO_PLAYBACK"]);
    expect(run.states.at(-1)).toBe("ERROR");
  });

  it("does not use the system voice for any other failure, and not when no fallback is configured", async () => {
    for (const code of ["SPEECH_BUSY", "SPEECH_TIMEOUT", "SPEECH_RESPONSE_INVALID", "SPEECH_AUDIO_INVALID"]) {
      const speak = vi.fn(async () => "STARTED" as const);
      const run = playbackWith(failure(code), { speak, cancel: vi.fn() });
      await run.playback.play("response-6");
      expect(speak, code).not.toHaveBeenCalled();
      expect(run.states.at(-1), code).toBe("ERROR");
    }
    const bare = playbackWith(failure("SPEECH_CONFIGURATION_UNAVAILABLE"), undefined);
    await bare.playback.play("response-7");
    expect(bare.states.at(-1)).toBe("ERROR");
  });
});

describe("system voice: wiring in the controls", () => {
  const controls = readSource("src/renderer/features/voice/response-speech-controls.tsx");

  it("shows the no-voice message once per session and speaks the on-screen text", () => {
    expect(NO_SYSTEM_VOICE_MESSAGE).toBe("No hay una voz en español instalada en este equipo. Puedes leer la respuesta.");
    expect(controls).toMatch(/if \(noVoiceNoticeShown\) return;\s*noVoiceNoticeShown = true;/u);
    expect(controls).toContain("current.responseId === responseId");
    expect(controls).toContain("cancel: systemVoice.cancel");
    // The existing stop path (Escape, the stop button, page hide) is the one that reaches the system voice.
    expect(controls).toContain("stopRef.current = controller.stop");
  });

  it("passes the notice up so the HUD shows it as its message", () => {
    expect(readSource("src/renderer/app/App.tsx")).toContain("onSpeechNotice={setVoiceMessage}");
    expect(readSource("src/renderer/views/ares-view.tsx")).toContain("onNotice={onSpeechNotice}");
  });
});
