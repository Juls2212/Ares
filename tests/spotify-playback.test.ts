import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
  dialog: {},
  safeStorage: {},
  shell: { openExternal: vi.fn(async (_url: string) => undefined) }
}));

import { createActionExecutor } from "../src/main/actions/action-executor";
import { createActionOrchestrator } from "../src/main/actions/action-orchestrator";
import type { ActionHistoryService } from "../src/main/actions/action-history-service";
import { getActionPolicy } from "../src/main/actions/action-policy";
import { createSpotifyActionExecutor } from "../src/main/actions/spotify-action-executor";
import { createAssistantInterpreter } from "../src/main/assistant/assistant-interpreter";
import { OPENAI_INTERPRETATION_OUTPUT_SCHEMA } from "../src/main/assistant/openai-structured-provider";
import { parseSpotifyControlCommand } from "../src/main/assistant/spotify-control-phrases";
import { attachSpokenActionResponse } from "../src/main/ipc/register-action-ipc";
import type { SpotifyApiClient, SpotifySearchCandidate } from "../src/main/spotify/spotify-api-client";
import { SPOTIFY_FAILURES, spotifyFailure, type SpotifyFailureCode } from "../src/main/spotify/spotify-failures";
import {
  createSpotifyPlaybackService,
  rankCandidates,
  SPOTIFY_VOLUME_STEP,
  toDisplayText
} from "../src/main/spotify/spotify-playback-service";

const source = (file: string): string => readFileSync(path.resolve(process.cwd(), file), "utf8");
const ok = <T>(data: T) => ({ ok: true as const, data });

const track = (name: string, artist: string | undefined, id: string): SpotifySearchCandidate => ({
  uri: `spotify:track:${id.padEnd(22, "A")}`,
  name,
  ...(artist ? { artist } : {})
});

const createPlayback = (overrides: Partial<Record<keyof SpotifyApiClient, unknown>> = {}) => {
  const client = {
    exchangeCode: vi.fn(),
    refresh: vi.fn(),
    search: vi.fn(async (_token: string, _query: string, _type: string) => ok([track("Despacito", "Luis Fonsi", "one")])),
    play: vi.fn(async (_token: string, _target?: unknown) => ok(null)),
    pause: vi.fn(async (_token: string) => ok(null)),
    next: vi.fn(async (_token: string) => ok(null)),
    previous: vi.fn(async (_token: string) => ok(null)),
    setVolume: vi.fn(async (_token: string, _percent: number) => ok(null)),
    getPlayback: vi.fn(async (_token: string) => ok({ isPlaying: true, title: "Despacito", artist: "Luis Fonsi", volumePercent: 50 })),
    ...overrides
  };
  const auth = {
    getAccessToken: vi.fn(async () => ok("token-one")),
    refreshAfterUnauthorized: vi.fn(async () => ok("token-two"))
  };
  return { client, auth, service: createSpotifyPlaybackService({ auth, client: client as unknown as SpotifyApiClient }) };
};

describe("search ranking and URI selection", () => {
  it("prefers a normalized exact name match and otherwise the first result", () => {
    const candidates = [track("Despacito (Remix)", "A", "a"), track("DESPACITO", "B", "b"), track("Otra", "C", "c")];
    expect(rankCandidates("despacito", candidates)?.artist).toBe("B");
    expect(rankCandidates("Despácito", candidates)?.artist).toBe("B");
    expect(rankCandidates("algo distinto", candidates)?.artist).toBe("A");
    expect(rankCandidates("x", [])).toBeUndefined();
  });

  it("plays the URI taken from the API response as a track and says which one it chose", async () => {
    const { service, client } = createPlayback({
      search: vi.fn(async () => ok([track("Despacito Remix", "Otro", "remix"), track("Despacito", "Luis Fonsi", "exact")]))
    });
    await expect(service.playByQuery("Despacito", undefined)).resolves.toEqual({ ok: true, data: { title: "Despacito", artist: "Luis Fonsi" } });
    expect(client.search).toHaveBeenCalledWith("token-one", "Despacito", "track");
    expect(client.play).toHaveBeenCalledExactlyOnceWith("token-one", { type: "track", uri: `spotify:track:${"exact".padEnd(22, "A")}` });
  });

  it.each([
    ["TRACK", "track", "track"],
    ["ANY", "track", "track"],
    ["ARTIST", "artist", "context"],
    ["ALBUM", "album", "context"],
    ["PLAYLIST", "playlist", "context"]
  ])("maps kind %s to the %s search and a %s start", async (kind, type, startType) => {
    const { service, client } = createPlayback({
      search: vi.fn(async () => ok([{ uri: `spotify:${type}:${"x".padEnd(22, "B")}`, name: "Nombre" }]))
    });
    await expect(service.playByQuery("Nombre", kind)).resolves.toEqual({ ok: true, data: { title: "Nombre" } });
    expect(client.search).toHaveBeenCalledWith("token-one", "Nombre", type);
    expect(client.play).toHaveBeenCalledWith("token-one", { type: startType, uri: `spotify:${type}:${"x".padEnd(22, "B")}` });
  });

  it("answers no results without playing anything", async () => {
    const { service, client } = createPlayback({ search: vi.fn(async () => ok([])) });
    await expect(service.playByQuery("Nada", undefined)).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NO_RESULTS" } });
    expect(client.play).not.toHaveBeenCalled();
  });

  it("rejects a query that is an id, URI or URL and an unknown kind before any request", async () => {
    const { service, client, auth } = createPlayback();
    for (const query of ["spotify:track:4uLU6hMCjMI75M1A2tKUQC", "https://open.spotify.com/track/1", "../x", "", undefined, 5]) {
      await expect(service.playByQuery(query, undefined)).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_INVALID_REQUEST" } });
    }
    await expect(service.playByQuery("Despacito", "SONG")).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_INVALID_REQUEST" } });
    expect(client.search).not.toHaveBeenCalled();
    expect(auth.getAccessToken).not.toHaveBeenCalled();
  });

  it("limits and sanitizes the spoken title and artist to 60 characters", async () => {
    const long = "T".repeat(80);
    const { service } = createPlayback({
      search: vi.fn(async () => ok([track(`«${long}»\u0000\n`, `  ${"A".repeat(70)}  `, "x")]))
    });
    const result = await service.playByQuery("T", undefined);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.title).toBe("T".repeat(60));
    expect(result.data.artist).toBe("A".repeat(60));
    expect(toDisplayText("  «Hola»​  mundo ")).toBe("Hola mundo");
    expect(toDisplayText("\u0000«»")).toBeUndefined();
    expect(toDisplayText(undefined)).toBeUndefined();
  });

  it("propagates a Premium, allowlist or device failure from starting playback", async () => {
    for (const code of ["SPOTIFY_PREMIUM_REQUIRED", "SPOTIFY_NOT_ALLOWLISTED", "SPOTIFY_NO_ACTIVE_DEVICE"] as const) {
      const { service } = createPlayback({ play: vi.fn(async () => spotifyFailure(code)) });
      await expect(service.playByQuery("Despacito", undefined)).resolves.toMatchObject({ ok: false, error: { code } });
    }
  });
});

describe("token handling around operations", () => {
  it("refreshes once after a 401 and retries with the new token", async () => {
    const pause = vi.fn()
      .mockResolvedValueOnce(spotifyFailure("SPOTIFY_AUTH_EXPIRED"))
      .mockResolvedValueOnce(ok(null));
    const { service, auth } = createPlayback({ pause });
    await expect(service.pause()).resolves.toEqual({ ok: true, data: null });
    expect(auth.refreshAfterUnauthorized).toHaveBeenCalledTimes(1);
    expect(pause.mock.calls.map(([token]) => token)).toEqual(["token-one", "token-two"]);
  });

  it("does not loop on a second 401 and surfaces a failed refresh", async () => {
    const twice = createPlayback({ pause: vi.fn(async () => spotifyFailure("SPOTIFY_AUTH_EXPIRED")) });
    await expect(twice.service.pause()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_AUTH_EXPIRED" } });
    expect(twice.client.pause).toHaveBeenCalledTimes(2);

    const failed = createPlayback({ pause: vi.fn(async () => spotifyFailure("SPOTIFY_AUTH_EXPIRED")) });
    failed.auth.refreshAfterUnauthorized.mockResolvedValueOnce(spotifyFailure("SPOTIFY_AUTH_EXPIRED") as never);
    await expect(failed.service.pause()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_AUTH_EXPIRED" } });
    expect(failed.client.pause).toHaveBeenCalledTimes(1);
  });

  it("stops before any request when not connected", async () => {
    const { service, client, auth } = createPlayback();
    auth.getAccessToken.mockResolvedValueOnce(spotifyFailure("SPOTIFY_NOT_CONNECTED") as never);
    await expect(service.next()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NOT_CONNECTED" } });
    expect(client.next).not.toHaveBeenCalled();
  });
});

describe("controls, volume and now playing", () => {
  it("maps pause, resume, next and previous to their calls with no body or target", async () => {
    const { service, client } = createPlayback();
    await service.pause();
    await service.resume();
    await service.next();
    await service.previous();
    expect(client.pause).toHaveBeenCalledWith("token-one");
    expect(client.play).toHaveBeenCalledExactlyOnceWith("token-one");
    expect(client.next).toHaveBeenCalledWith("token-one");
    expect(client.previous).toHaveBeenCalledWith("token-one");
  });

  it("sets an explicit level only for integers from 0 to 100", async () => {
    const { service, client } = createPlayback();
    await expect(service.setVolume({ level: 40 })).resolves.toEqual({ ok: true, data: { level: 40 } });
    await expect(service.setVolume({ level: 0 })).resolves.toEqual({ ok: true, data: { level: 0 } });
    await expect(service.setVolume({ level: 100 })).resolves.toEqual({ ok: true, data: { level: 100 } });
    for (const input of [{ level: -1 }, { level: 101 }, { level: 40.5 }, { level: "40" }, { level: 40, change: "UP" }, {}, { change: "SIDEWAYS" }, { other: 1 }, null, "40"]) {
      await expect(service.setVolume(input)).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_INVALID_REQUEST" } });
    }
    expect((client.setVolume as unknown as { mock: { calls: Array<[string, number]> } }).mock.calls.map(([, level]) => level)).toEqual([40, 0, 100]);
  });

  it("computes relative changes in Main from the current volume with a bounded step of 10", async () => {
    expect(SPOTIFY_VOLUME_STEP).toBe(10);
    const up = createPlayback();
    await expect(up.service.setVolume({ change: "UP" })).resolves.toEqual({ ok: true, data: { level: 60 } });
    expect(up.client.setVolume).toHaveBeenCalledWith("token-one", 60);

    const down = createPlayback({ getPlayback: vi.fn(async () => ok({ isPlaying: true, volumePercent: 25 })) });
    await expect(down.service.setVolume({ change: "DOWN" })).resolves.toEqual({ ok: true, data: { level: 15 } });

    const top = createPlayback({ getPlayback: vi.fn(async () => ok({ isPlaying: true, volumePercent: 97 })) });
    await expect(top.service.setVolume({ change: "UP" })).resolves.toEqual({ ok: true, data: { level: 100 } });
    const bottom = createPlayback({ getPlayback: vi.fn(async () => ok({ isPlaying: true, volumePercent: 4 })) });
    await expect(bottom.service.setVolume({ change: "DOWN" })).resolves.toEqual({ ok: true, data: { level: 0 } });
  });

  it("reports no active device without changing anything, and an unexpected state without a volume", async () => {
    const none = createPlayback({ getPlayback: vi.fn(async () => ok(null)) });
    await expect(none.service.setVolume({ change: "UP" })).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NO_ACTIVE_DEVICE" } });
    expect(none.client.setVolume).not.toHaveBeenCalled();
    const unknown = createPlayback({ getPlayback: vi.fn(async () => ok({ isPlaying: true })) });
    await expect(unknown.service.setVolume({ change: "UP" })).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_UNEXPECTED_RESPONSE" } });
  });

  it("describes what is playing, what is paused, nothing, and a missing device", async () => {
    const playing = createPlayback();
    await expect(playing.service.whatIsPlaying()).resolves.toEqual({ ok: true, data: { state: "PLAYING", title: "Despacito", artist: "Luis Fonsi" } });
    const paused = createPlayback({ getPlayback: vi.fn(async () => ok({ isPlaying: false, title: "Pausa", artist: "Alguien" })) });
    await expect(paused.service.whatIsPlaying()).resolves.toEqual({ ok: true, data: { state: "PAUSED", title: "Pausa", artist: "Alguien" } });
    const nothing = createPlayback({ getPlayback: vi.fn(async () => ok({ isPlaying: false })) });
    await expect(nothing.service.whatIsPlaying()).resolves.toEqual({ ok: true, data: { state: "NONE" } });
    const device = createPlayback({ getPlayback: vi.fn(async () => ok(null)) });
    await expect(device.service.whatIsPlaying()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NO_ACTIVE_DEVICE" } });
  });

  it("never launches an application or moves playback to another device when there is no active device", async () => {
    const { shell } = await import("electron");
    const { service, client } = createPlayback({ play: vi.fn(async () => spotifyFailure("SPOTIFY_NO_ACTIVE_DEVICE")) });
    await expect(service.playByQuery("Despacito", undefined)).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NO_ACTIVE_DEVICE" } });
    await service.resume();
    expect(shell.openExternal).not.toHaveBeenCalled();
    expect(Object.keys(client).filter((name) => /transfer|device|launch|open/iu.test(name))).toEqual([]);
  });
});

const createFlow = (options: {
  auth?: Partial<Record<"connect" | "disconnect" | "getStatus", unknown>>;
  playback?: Partial<Record<string, unknown>>;
} = {}) => {
  const auth = {
    connect: vi.fn(async () => ok(null)),
    disconnect: vi.fn(async () => ok(null)),
    getStatus: vi.fn(async () => ({ configured: true, connected: true })),
    ...options.auth
  };
  const playback = {
    playByQuery: vi.fn(async (_query: unknown, _kind: unknown) => ok({ title: "Canción Secreta", artist: "Artista Privado" })),
    pause: vi.fn(async () => ok(null)),
    resume: vi.fn(async () => ok(null)),
    next: vi.fn(async () => ok(null)),
    previous: vi.fn(async () => ok(null)),
    setVolume: vi.fn(async (_input: unknown) => ok({ level: 40 })),
    whatIsPlaying: vi.fn(async () => ok({ state: "PLAYING", title: "Canción Secreta", artist: "Artista Privado" })),
    ...options.playback
  };
  const executorLog = vi.fn();
  const unused = { execute: vi.fn() } as never;
  const executor = createActionExecutor({
    plannerExecutor: unused,
    applicationExecutor: unused,
    approvedWebExecutor: unused,
    filesExecutor: unused,
    messagingExecutor: unused,
    spotifyExecutor: createSpotifyActionExecutor({ auth: auth as never, playback: playback as never, logError: executorLog })
  });
  const recordTerminal = vi.fn(async (_input: unknown) => ({ ok: true as const, data: {} as never }));
  let counter = 0;
  const orchestratorLog = vi.fn();
  const orchestrator = createActionOrchestrator({
    executor,
    historyService: { recordTerminal, list: vi.fn() } as unknown as ActionHistoryService,
    generateIdentifier: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    now: () => new Date("2026-09-17T10:00:00.000Z"),
    logError: orchestratorLog
  });
  return { orchestrator, auth, playback, recordTerminal, executorLog, orchestratorLog };
};

const spoken = (result: Parameters<typeof attachSpokenActionResponse>[1]): string[] => {
  const remembered: string[] = [];
  attachSpokenActionResponse(1, result, { clear: vi.fn(), remember: (_id: number, text: string) => { remembered.push(text); return {} as never; } } as never);
  return remembered;
};

describe("connection actions", () => {
  it("asks for a standard confirmation before opening anything, then connects once", async () => {
    const flow = createFlow();
    const proposed = await flow.orchestrator.propose({ action: "CONNECT_SPOTIFY", input: {} });
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected a confirmation.");
    expect(proposed.data).toMatchObject({
      action: "CONNECT_SPOTIFY",
      riskLevel: 2,
      confirmation: {
        required: true,
        summary: "Ares abrirá la página de autorización de Spotify en tu navegador. Permite el control de la reproducción y vuelve aquí.",
        scopeSummary: "Cuenta de Spotify"
      }
    });
    expect(spoken(proposed)).toEqual([]);
    expect(flow.auth.connect).not.toHaveBeenCalled();

    const confirmed = await flow.orchestrator.confirm(proposed.data.confirmationId);
    expect(confirmed).toMatchObject({ ok: true, data: { status: "SUCCEEDED", userSummary: "Spotify quedó conectado." } });
    expect(flow.auth.connect).toHaveBeenCalledTimes(1);
    await expect(flow.orchestrator.confirm(proposed.data.confirmationId)).resolves.toMatchObject({ ok: false });
    expect(flow.auth.connect).toHaveBeenCalledTimes(1);
  });

  it("does not connect when the review is cancelled", async () => {
    const flow = createFlow();
    const proposed = await flow.orchestrator.propose({ action: "CONNECT_SPOTIFY", input: {} });
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected a confirmation.");
    await expect(flow.orchestrator.cancel(proposed.data.confirmationId)).resolves.toMatchObject({ ok: true, data: { status: "CANCELLED" } });
    expect(flow.auth.connect).not.toHaveBeenCalled();
  });

  it.each<[SpotifyFailureCode, string]>([
    ["SPOTIFY_NOT_CONFIGURED", "VALIDATION_FAILED"],
    ["SPOTIFY_SECURE_STORAGE_UNAVAILABLE", "VALIDATION_FAILED"],
    ["SPOTIFY_CONNECT_CANCELLED", "CANCELLED"],
    ["SPOTIFY_CONNECT_TIMEOUT", "EXECUTION_FAILED"],
    ["SPOTIFY_CONNECT_PORT_BUSY", "EXECUTION_FAILED"],
    ["SPOTIFY_BROWSER_UNAVAILABLE", "EXECUTION_FAILED"],
    ["SPOTIFY_NETWORK_ERROR", "EXECUTION_FAILED"]
  ])("reports %s as %s with its own message", async (code, status) => {
    const flow = createFlow({ auth: { connect: vi.fn(async () => spotifyFailure(code)) } });
    const proposed = await flow.orchestrator.propose({ action: "CONNECT_SPOTIFY", input: {} });
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected a confirmation.");
    const result = await flow.orchestrator.confirm(proposed.data.confirmationId);
    expect(result).toMatchObject({ ok: true, data: { status, errorCode: code, userSummary: SPOTIFY_FAILURES[code] } });
    expect(spoken(result)).toEqual(status === "CANCELLED" ? [] : [SPOTIFY_FAILURES[code]]);
  });

  it("disconnects after a standard confirmation and answers the status from local state", async () => {
    const flow = createFlow();
    const proposed = await flow.orchestrator.propose({ action: "DISCONNECT_SPOTIFY", input: {} });
    if (!proposed.ok || !("confirmationId" in proposed.data)) throw new Error("Expected a confirmation.");
    expect(proposed.data).toMatchObject({ riskLevel: 2, confirmation: { summary: "Se borrarán las credenciales de Spotify guardadas en este equipo." } });
    expect(flow.auth.disconnect).not.toHaveBeenCalled();
    await expect(flow.orchestrator.confirm(proposed.data.confirmationId)).resolves.toMatchObject({ ok: true, data: { userSummary: "Desconecté Spotify." } });
    expect(flow.auth.disconnect).toHaveBeenCalledTimes(1);

    const connected = await flow.orchestrator.propose({ action: "GET_SPOTIFY_STATUS", input: {} });
    expect(connected).toMatchObject({ ok: true, data: { status: "SUCCEEDED", riskLevel: 1, userSummary: "Spotify está conectado." } });
    const disconnected = createFlow({ auth: { getStatus: vi.fn(async () => ({ configured: true, connected: false })) } });
    await expect(disconnected.orchestrator.propose({ action: "GET_SPOTIFY_STATUS", input: {} })).resolves.toMatchObject({ ok: true, data: { userSummary: "Spotify no está conectado." } });
    const unconfigured = createFlow({ auth: { getStatus: vi.fn(async () => ({ configured: false, connected: false })) } });
    await expect(unconfigured.orchestrator.propose({ action: "GET_SPOTIFY_STATUS", input: {} })).resolves.toMatchObject({
      ok: true, data: { userSummary: SPOTIFY_FAILURES.SPOTIFY_NOT_CONFIGURED }
    });
  });
});

describe("playback actions", () => {
  it("is a direct action set: every control runs without a dialog", () => {
    for (const action of ["PLAY_SPOTIFY_MUSIC", "PAUSE_SPOTIFY", "RESUME_SPOTIFY", "NEXT_SPOTIFY_TRACK", "PREVIOUS_SPOTIFY_TRACK", "SET_SPOTIFY_VOLUME", "WHAT_IS_PLAYING", "GET_SPOTIFY_STATUS"] as const) {
      expect(getActionPolicy(action)).toMatchObject({ approval: "DIRECT", riskLevel: 1, availability: "IMPLEMENTED" });
    }
    expect(getActionPolicy("CONNECT_SPOTIFY")).toMatchObject({ approval: "CONFIRMATION_REQUIRED", riskLevel: 2 });
    expect(getActionPolicy("DISCONNECT_SPOTIFY")).toMatchObject({ approval: "CONFIRMATION_REQUIRED", riskLevel: 2 });
  });

  it("plays by query and says which track and artist it chose", async () => {
    const flow = createFlow();
    const result = await flow.orchestrator.propose({ action: "PLAY_SPOTIFY_MUSIC", input: { query: "canción", kind: "TRACK" } });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "SUCCEEDED", userSummary: "Reproduciendo «Canción Secreta» de Artista Privado." }
    });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(flow.playback.playByQuery).toHaveBeenCalledWith("canción", "TRACK");
    expect(spoken(result)).toEqual(["Reproduciendo «Canción Secreta» de Artista Privado."]);
  });

  it.each([
    ["PAUSE_SPOTIFY", "pause", "Pausé la música."],
    ["RESUME_SPOTIFY", "resume", "Sigo con la música."],
    ["NEXT_SPOTIFY_TRACK", "next", "Pasé a la siguiente canción."],
    ["PREVIOUS_SPOTIFY_TRACK", "previous", "Volví a la canción anterior."]
  ] as const)("runs %s", async (action, method, text) => {
    const flow = createFlow();
    await expect(flow.orchestrator.propose({ action, input: {} })).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED", userSummary: text } });
    expect(flow.playback[method]).toHaveBeenCalledTimes(1);
  });

  it("sets and changes the volume and says what is playing", async () => {
    const flow = createFlow();
    await expect(flow.orchestrator.propose({ action: "SET_SPOTIFY_VOLUME", input: { level: 40 } })).resolves.toMatchObject({ ok: true, data: { userSummary: "Volumen en 40." } });
    await expect(flow.orchestrator.propose({ action: "SET_SPOTIFY_VOLUME", input: { change: "UP" } })).resolves.toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(flow.playback.setVolume.mock.calls.map(([input]) => input)).toEqual([{ level: 40 }, { change: "UP" }]);
    await expect(flow.orchestrator.propose({ action: "WHAT_IS_PLAYING", input: {} })).resolves.toMatchObject({
      ok: true, data: { userSummary: "Está sonando «Canción Secreta» de Artista Privado." }
    });
    const paused = createFlow({ playback: { whatIsPlaying: vi.fn(async () => ok({ state: "PAUSED", title: "Tema", artist: undefined })) } });
    await expect(paused.orchestrator.propose({ action: "WHAT_IS_PLAYING", input: {} })).resolves.toMatchObject({ ok: true, data: { userSummary: "En pausa: «Tema»." } });
    const none = createFlow({ playback: { whatIsPlaying: vi.fn(async () => ok({ state: "NONE" })) } });
    await expect(none.orchestrator.propose({ action: "WHAT_IS_PLAYING", input: {} })).resolves.toMatchObject({ ok: true, data: { userSummary: "No hay nada sonando en Spotify." } });
  });

  it.each<[SpotifyFailureCode, string]>([
    ["SPOTIFY_NOT_CONNECTED", "VALIDATION_FAILED"],
    ["SPOTIFY_NOT_CONFIGURED", "VALIDATION_FAILED"],
    ["SPOTIFY_AUTH_EXPIRED", "VALIDATION_FAILED"],
    ["SPOTIFY_PREMIUM_REQUIRED", "VALIDATION_FAILED"],
    ["SPOTIFY_NOT_ALLOWLISTED", "VALIDATION_FAILED"],
    ["SPOTIFY_NO_ACTIVE_DEVICE", "VALIDATION_FAILED"],
    ["SPOTIFY_NO_RESULTS", "VALIDATION_FAILED"],
    ["SPOTIFY_RATE_LIMITED", "EXECUTION_FAILED"],
    ["SPOTIFY_NETWORK_ERROR", "EXECUTION_FAILED"],
    ["SPOTIFY_UNEXPECTED_RESPONSE", "EXECUTION_FAILED"],
    ["SPOTIFY_INVALID_REQUEST", "VALIDATION_FAILED"]
  ])("reports %s with its own bounded message and no dialog", async (code, status) => {
    const flow = createFlow({ playback: { playByQuery: vi.fn(async () => spotifyFailure(code)) } });
    const result = await flow.orchestrator.propose({ action: "PLAY_SPOTIFY_MUSIC", input: { query: "Despacito" } });
    expect(result).toMatchObject({ ok: true, data: { status, errorCode: code, userSummary: SPOTIFY_FAILURES[code] } });
    expect(result.ok && "lifecycleState" in result.data).toBe(false);
    expect(spoken(result)).toEqual([SPOTIFY_FAILURES[code]]);
  });

  it("uses the exact Spanish messages for every category", () => {
    expect(SPOTIFY_FAILURES.SPOTIFY_NO_ACTIVE_DEVICE).toBe("Abre Spotify en tu computador y vuelve a intentarlo.");
    expect(SPOTIFY_FAILURES.SPOTIFY_RATE_LIMITED).toContain("Intenta de nuevo en un momento");
    expect(Object.keys(SPOTIFY_FAILURES)).toEqual(expect.arrayContaining([
      "SPOTIFY_NOT_CONNECTED", "SPOTIFY_NOT_CONFIGURED", "SPOTIFY_AUTH_EXPIRED", "SPOTIFY_PREMIUM_REQUIRED", "SPOTIFY_NOT_ALLOWLISTED",
      "SPOTIFY_NO_ACTIVE_DEVICE", "SPOTIFY_NO_RESULTS", "SPOTIFY_RATE_LIMITED", "SPOTIFY_NETWORK_ERROR", "SPOTIFY_UNEXPECTED_RESPONSE",
      "SPOTIFY_CONNECT_CANCELLED", "SPOTIFY_CONNECT_TIMEOUT"
    ]));
    for (const message of Object.values(SPOTIFY_FAILURES)) {
      expect(message).not.toMatch(/https?:|token|secret|\{|\}|Bearer|status/iu);
      expect(message.length).toBeLessThanOrEqual(130);
    }
  });

  it("accepts no identifier, URI, URL or extra field in any submission", async () => {
    const flow = createFlow();
    for (const submission of [
      { action: "PLAY_SPOTIFY_MUSIC", input: { query: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" } },
      { action: "PLAY_SPOTIFY_MUSIC", input: { query: "https://open.spotify.com/track/1" } },
      { action: "PLAY_SPOTIFY_MUSIC", input: { query: "Despacito", uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" } },
      { action: "PLAY_SPOTIFY_MUSIC", input: { query: "Despacito", id: "4uLU6hMCjMI75M1A2tKUQC" } },
      { action: "PLAY_SPOTIFY_MUSIC", input: { query: "Despacito", kind: "SONG" } },
      { action: "PLAY_SPOTIFY_MUSIC", input: { query: "Despacito", deviceId: "x" } },
      { action: "PLAY_SPOTIFY_MUSIC", input: {} },
      { action: "SET_SPOTIFY_VOLUME", input: { level: 101 } },
      { action: "SET_SPOTIFY_VOLUME", input: { level: -5 } },
      { action: "SET_SPOTIFY_VOLUME", input: { level: 40.5 } },
      { action: "SET_SPOTIFY_VOLUME", input: { level: "40" } },
      { action: "SET_SPOTIFY_VOLUME", input: { level: 40, change: "UP" } },
      { action: "SET_SPOTIFY_VOLUME", input: { change: "LOUDER" } },
      { action: "SET_SPOTIFY_VOLUME", input: {} },
      { action: "PAUSE_SPOTIFY", input: { deviceId: "x" } },
      { action: "NEXT_SPOTIFY_TRACK", input: { count: 3 } },
      { action: "CONNECT_SPOTIFY", input: { clientId: "0123456789abcdef", redirectUri: "http://x" } },
      { action: "CONNECT_SPOTIFY", input: { code: "abc" } },
      { action: "DISCONNECT_SPOTIFY", input: { token: "abc" } },
      { action: "GET_SPOTIFY_STATUS", input: { refresh: true } },
      { action: "WHAT_IS_PLAYING", input: "x" },
      { action: "PAUSE_SPOTIFY" }
    ]) {
      await expect(flow.orchestrator.propose(submission)).resolves.toMatchObject({ ok: false, error: { code: "ACTION_PROPOSAL_INVALID" } });
    }
    expect(flow.auth.connect).not.toHaveBeenCalled();
    expect(flow.playback.playByQuery).not.toHaveBeenCalled();
    for (const action of ["TRANSFER_PLAYBACK", "ADD_TO_PLAYLIST", "FOLLOW_ARTIST", "GET_SPOTIFY_TOKEN"]) {
      await expect(flow.orchestrator.propose({ action, input: {} })).resolves.toMatchObject({ ok: false });
    }
  });

  it("keeps tracks, artists, queries and tokens out of history, logs and errors", async () => {
    const flow = createFlow();
    await flow.orchestrator.propose({ action: "PLAY_SPOTIFY_MUSIC", input: { query: "Consulta Privada 99" } });
    await flow.orchestrator.propose({ action: "WHAT_IS_PLAYING", input: {} });
    const proposed = await flow.orchestrator.propose({ action: "CONNECT_SPOTIFY", input: {} });
    if (proposed.ok && "confirmationId" in proposed.data) await flow.orchestrator.confirm(proposed.data.confirmationId);
    const failing = createFlow({ playback: { playByQuery: vi.fn(async () => { throw new Error("Bearer AccessTokenSecret123 https://api.spotify.com/v1/search?q=Consulta"); }) } });
    const failed = await failing.orchestrator.propose({ action: "PLAY_SPOTIFY_MUSIC", input: { query: "Consulta Privada 99" } });

    for (const current of [flow, failing]) {
      expect(JSON.stringify([current.recordTerminal.mock.calls, current.executorLog.mock.calls, current.orchestratorLog.mock.calls]))
        .not.toMatch(/Secreta|Privad|Consulta|99|Bearer|AccessToken|spotify\.com/u);
    }
    expect(failing.executorLog.mock.calls).toEqual([["Spotify action execution failed."]]);
    expect(failed).toMatchObject({ ok: true, data: { status: "EXECUTION_FAILED", errorCode: "SPOTIFY_UNEXPECTED_RESPONSE" } });
    expect(JSON.stringify(failed)).not.toMatch(/Bearer|AccessToken|spotify\.com|Consulta/u);
    expect(flow.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      action: "PLAY_SPOTIFY_MUSIC",
      userSummary: "La acción de música se completó.",
      metadata: { scopeKind: "MUSIC", resultKind: "SUCCEEDED" }
    }));
  });

  it("speaks only the track and artist (each at most 60 characters) and fixed texts", async () => {
    const flow = createFlow();
    const result = await flow.orchestrator.propose({ action: "PLAY_SPOTIFY_MUSIC", input: { query: "Consulta Privada 99" } });
    const text = spoken(result).join(" ");
    expect(text).toBe("Reproduciendo «Canción Secreta» de Artista Privado.");
    expect(text).not.toMatch(/Consulta|99|spotify:|https?:/u);
  });
});

describe("voice routing", () => {
  const conversational = JSON.stringify({ state: "CONVERSATIONAL", summary: "Conversación", responseText: "Hola", drafts: [], clarifications: [] });
  const interpret = async (
    instruction: string,
    options: { connected?: boolean; registered?: boolean; aliases?: string[]; output?: string } = {}
  ) => {
    const provider = vi.fn(async () => options.output ?? conversational);
    const interpreter = createAssistantInterpreter({
      getConfiguration: () => ({ apiKey: "", model: "" }),
      createProvider: () => ({ interpret: provider }),
      now: () => new Date("2026-09-20T15:00:00.000Z"),
      timeZone: () => "America/Bogota",
      isSpotifyAppRegistered: async () => options.registered ?? false,
      isSpotifyConnected: async () => options.connected ?? false
    });
    const result = await interpreter.interpret({ instruction }, { knownApplicationAliases: options.aliases ?? [] });
    return { result, provider };
  };
  const drafts = (result: Awaited<ReturnType<typeof interpret>>["result"]) => (result.ok ? result.data.drafts : []);
  const summary = (result: Awaited<ReturnType<typeof interpret>>["result"]) => (result.ok ? result.data.summary : "");
  const NOT_CONNECTED = "Para reproducir música necesito conectar tu cuenta de Spotify. Di «conecta Spotify».";
  const HINT = " Mientras tanto, «busca algo en Spotify» abre la búsqueda en la aplicación.";

  it.each([
    ["conecta Spotify", "CONNECT_SPOTIFY"],
    ["Conéctate a mi cuenta de Spotify.", "CONNECT_SPOTIFY"],
    ["desconecta Spotify", "DISCONNECT_SPOTIFY"],
    ["¿Spotify está conectado?", "GET_SPOTIFY_STATUS"],
    ["pausa", "PAUSE_SPOTIFY"],
    ["Pausa la música", "PAUSE_SPOTIFY"],
    ["pon pausa", "PAUSE_SPOTIFY"],
    ["continúa", "RESUME_SPOTIFY"],
    ["reanuda la música", "RESUME_SPOTIFY"],
    ["siguiente", "NEXT_SPOTIFY_TRACK"],
    ["siguiente canción", "NEXT_SPOTIFY_TRACK"],
    ["anterior", "PREVIOUS_SPOTIFY_TRACK"],
    ["vuelve a la anterior", "PREVIOUS_SPOTIFY_TRACK"],
    ["¿Qué está sonando?", "WHAT_IS_PLAYING"],
    ["qué canción es esta", "WHAT_IS_PLAYING"]
  ])("maps «%s» to %s without the provider, connected or not", async (utterance, action) => {
    for (const connected of [true, false]) {
      const { result, provider } = await interpret(utterance, { connected });
      expect(drafts(result)).toEqual([{ action, input: {} }]);
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["sube el volumen", { change: "UP" }],
    ["sube el volumen un poco", { change: "UP" }],
    ["más volumen", { change: "UP" }],
    ["baja el volumen", { change: "DOWN" }],
    ["baja la música", { change: "DOWN" }],
    ["pon el volumen en 40", { level: 40 }],
    ["Pon el volumen al 70 por ciento.", { level: 70 }],
    ["ajusta el volumen a 0", { level: 0 }],
    ["pon el volumen a 100", { level: 100 }],
    ["sube el volumen al máximo", { level: 100 }]
  ])("maps «%s» to a bounded volume", async (utterance, input) => {
    const { result, provider } = await interpret(utterance);
    expect(drafts(result)).toEqual([{ action: "SET_SPOTIFY_VOLUME", input }]);
    expect(provider).not.toHaveBeenCalled();
  });

  it("asks for a volume between 0 and 100 instead of clamping silently", async () => {
    for (const utterance of ["pon el volumen en 140", "pon el volumen en 1000"]) {
      const { result, provider } = await interpret(utterance);
      expect(result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: "El volumen debe estar entre 0 y 100." } });
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["pon Despacito", { query: "Despacito" }],
    ["reproduce Shape of You", { query: "Shape of You" }],
    ["pon la canción Despacito", { query: "Despacito", kind: "TRACK" }],
    ["reproduce el álbum Un Verano Sin Ti", { query: "Un Verano Sin Ti", kind: "ALBUM" }],
    ["pon música de Shakira", { query: "Shakira", kind: "ARTIST" }],
    ["pon Despacito en Spotify", { query: "Despacito" }],
    ["reproduce la playlist Rock Clásico en Spotify", { query: "Rock Clásico", kind: "PLAYLIST" }]
  ])("with Spotify connected, «%s» plays through the Web API", async (utterance, input) => {
    for (const registered of [true, false]) {
      const { result, provider } = await interpret(utterance, { connected: true, registered });
      expect(drafts(result)).toEqual([{ action: "PLAY_SPOTIFY_MUSIC", input }]);
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it.each(["pon Despacito", "reproduce Shape of You", "pon música de Shakira", "pon Despacito en Spotify"])(
    "without a connection, «%s» offers to connect, opens no dialog and never falls back silently",
    async (utterance) => {
      const plain = await interpret(utterance, { connected: false, registered: false });
      expect(plain.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: NOT_CONNECTED } });
      const withApp = await interpret(utterance, { connected: false, registered: true });
      expect(withApp.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [], summary: `${NOT_CONNECTED}${HINT}` } });
      for (const outcome of [plain, withApp]) {
        expect(drafts(outcome.result)).toEqual([]);
        expect(outcome.provider).not.toHaveBeenCalled();
        expect(summary(outcome.result)).not.toMatch(/Despacito|Shakira|Shape/u);
      }
    }
  );

  it("keeps the Phase 4.1 routing for «busca … en Spotify» and the web actions, connected or not", async () => {
    for (const connected of [true, false]) {
      const app = await interpret("busca Despacito en Spotify", { connected, registered: true });
      expect(drafts(app.result)).toEqual([{ action: "SEARCH_SPOTIFY_APP", input: { query: "Despacito" } }]);
      const web = await interpret("busca Despacito en Spotify", { connected, registered: false });
      expect(drafts(web.result)).toEqual([{ action: "SEARCH_APPROVED_SITE", input: { site: "SPOTIFY", query: "Despacito" } }]);
      const youtube = await interpret("pon Despacito en YouTube", { connected, registered: true });
      expect(drafts(youtube.result)).toEqual([{ action: "SEARCH_APPROVED_SITE", input: { site: "YOUTUBE", query: "Despacito" } }]);
      const google = await interpret("busca recetas en Google", { connected });
      expect(drafts(google.result)).toEqual([{ action: "SEARCH_APPROVED_SITE", input: { site: "GOOGLE", query: "recetas" } }]);
      const open = await interpret("abre YouTube", { connected });
      expect(drafts(open.result)).toEqual([{ action: "OPEN_APPROVED_PAGE", input: { site: "YOUTUBE" } }]);
    }
  });

  it("keeps the alias-only clarification for «Spotify»", async () => {
    const { result } = await interpret("Spotify", { connected: true });
    expect(result).toMatchObject({ ok: true, data: { summary: "¿Quieres que abra o que registre Spotify?", drafts: [] } });
  });

  it("does not steal ordinary requests that start with «pon» or are common words", async () => {
    for (const utterance of ["pon una alarma", "pon el volumen en el escritorio", "pon un recordatorio a las 5", "pon música", "pon la alarma a las 6", "qué hora es"]) {
      const { provider } = await interpret(utterance, { connected: true });
      expect(provider).toHaveBeenCalledTimes(1);
    }
    expect(parseSpotifyControlCommand("qué clima hace")).toBeUndefined();
  });

  describe("provider drafts", () => {
    const providerDraft = (action: string, extra: Record<string, unknown>) => ({
      action,
      input: null,
      weeklyRoutine: null,
      habitAction: null,
      approvedWeb: null,
      catalogApplication: null,
      filesAction: null,
      messagingAction: null,
      spotifySearch: null,
      spotifyControl: null,
      ...extra
    });
    const ready = (draft: unknown) => JSON.stringify({ state: "READY", summary: "ok", responseText: "", drafts: [draft], clarifications: [] });

    it("accepts PLAY_SPOTIFY_MUSIC with a spoken query and asks to connect when disconnected", async () => {
      const output = ready(providerDraft("PLAY_SPOTIFY_MUSIC", { spotifySearch: { query: "Natalia Lafourcade", kind: "ARTIST", playRequested: null } }));
      const connected = await interpret("quiero escuchar a Natalia Lafourcade", { connected: true, output });
      expect(drafts(connected.result)).toEqual([{ action: "PLAY_SPOTIFY_MUSIC", input: { query: "Natalia Lafourcade", kind: "ARTIST" } }]);
      const disconnected = await interpret("quiero escuchar a Natalia Lafourcade", { connected: false, output });
      expect(disconnected.result).toMatchObject({ ok: true, data: { state: "NEEDS_CLARIFICATION", drafts: [] } });
      expect(JSON.stringify(disconnected.result)).toContain("conectar tu cuenta de Spotify");
    });

    it("rejects invented queries, ids, URIs and unknown fields", async () => {
      const invented = await interpret("quiero escuchar algo", {
        connected: true,
        output: ready(providerDraft("PLAY_SPOTIFY_MUSIC", { spotifySearch: { query: "Bad Bunny", kind: null, playRequested: null } }))
      });
      expect(drafts(invented.result)).toEqual([]);
      for (const spotifySearch of [
        { query: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", kind: null, playRequested: null },
        { query: "https://open.spotify.com/x", kind: null, playRequested: null },
        { query: "Natalia", kind: null, playRequested: null, uri: "spotify:track:x" },
        { query: "Natalia", kind: "SONG", playRequested: null }
      ]) {
        const { result } = await interpret("quiero escuchar Natalia", { connected: true, output: ready(providerDraft("PLAY_SPOTIFY_MUSIC", { spotifySearch })) });
        expect(drafts(result)).toEqual([]);
      }
    });

    it("turns a search draft that asked to play into a play or a connect question, and leaves plain searches alone", async () => {
      const output = ready(providerDraft("SEARCH_SPOTIFY_APP", { spotifySearch: { query: "Natalia Lafourcade", kind: null, playRequested: true } }));
      const connected = await interpret("quiero oír Natalia Lafourcade", { connected: true, registered: true, output });
      expect(drafts(connected.result)).toEqual([{ action: "PLAY_SPOTIFY_MUSIC", input: { query: "Natalia Lafourcade" } }]);
      const disconnected = await interpret("quiero oír Natalia Lafourcade", { connected: false, registered: true, output });
      expect(drafts(disconnected.result)).toEqual([]);
      const search = ready(providerDraft("SEARCH_SPOTIFY_APP", { spotifySearch: { query: "Natalia Lafourcade", kind: null, playRequested: null } }));
      const plain = await interpret("quiero oír Natalia Lafourcade", { connected: true, registered: true, output: search });
      expect(drafts(plain.result)).toEqual([{ action: "SEARCH_SPOTIFY_APP", input: { query: "Natalia Lafourcade" } }]);
    });

    it("maps the volume variant only to a bounded level or a direction", async () => {
      for (const [spotifyControl, input] of [
        [{ level: 30, change: null }, { level: 30 }],
        [{ level: null, change: "DOWN" }, { change: "DOWN" }]
      ] as const) {
        const { result } = await interpret("ponlo más suave", { output: ready(providerDraft("SET_SPOTIFY_VOLUME", { spotifyControl })) });
        expect(drafts(result)).toEqual([{ action: "SET_SPOTIFY_VOLUME", input }]);
      }
      for (const spotifyControl of [
        { level: 101, change: null }, { level: 30, change: "UP" }, { level: null, change: null }, { level: null, change: "LOUDER" },
        { level: 30, change: null, deviceId: "x" }
      ]) {
        const { result } = await interpret("ponlo más suave", { output: ready(providerDraft("SET_SPOTIFY_VOLUME", { spotifyControl })) });
        expect(drafts(result)).toEqual([]);
      }
    });

    it("accepts the no-input actions with an empty JSON input only", async () => {
      for (const action of ["PAUSE_SPOTIFY", "CONNECT_SPOTIFY", "WHAT_IS_PLAYING"]) {
        const ok = await interpret("haz eso", { output: ready({ ...providerDraft(action, {}), input: "{}" }) });
        expect(drafts(ok.result)).toEqual([{ action, input: {} }]);
        const extra = await interpret("haz eso", { output: ready({ ...providerDraft(action, {}), input: JSON.stringify({ deviceId: "x" }) }) });
        expect(drafts(extra.result)).toEqual([]);
      }
    });
  });
});

describe("strict schema and source confinement", () => {
  type SchemaNode = { type?: string; properties?: Record<string, SchemaNode>; required?: string[]; additionalProperties?: boolean; anyOf?: SchemaNode[]; items?: SchemaNode };
  const collect = (node: SchemaNode, found: SchemaNode[] = []): SchemaNode[] => {
    if (node.type === "object") found.push(node);
    for (const property of Object.values(node.properties ?? {})) collect(property, found);
    for (const variant of node.anyOf ?? []) collect(variant, found);
    if (node.items) collect(node.items, found);
    return found;
  };
  const schema = OPENAI_INTERPRETATION_OUTPUT_SCHEMA as unknown as SchemaNode;

  it("keeps every nested object closed and has no id, URI, URL, device or token field", () => {
    for (const object of collect(schema)) {
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required ?? [])].sort()).toEqual(Object.keys(object.properties ?? {}).sort());
    }
    const variants = ((schema.properties?.drafts as SchemaNode).items as SchemaNode).anyOf ?? [];
    for (const variant of variants) expect(variant.required).toEqual(expect.arrayContaining(["spotifySearch", "spotifyControl"]));
    const control = variants[0].properties?.spotifyControl as SchemaNode;
    const object = (control.anyOf ?? []).find((entry) => entry.type === "object");
    expect(Object.keys(object?.properties ?? {}).sort()).toEqual(["change", "level"]);
    expect(object?.properties?.level).toEqual({ anyOf: [{ type: "integer", minimum: 0, maximum: 100 }, { type: "null" }] });
    expect(JSON.stringify([control, variants[0].properties?.spotifySearch])).not.toMatch(/uri|url|id"|device|token|code|secret|link|path/iu);
    expect(variants[1].properties?.spotifyControl).toEqual({ type: "null" });
  });

  const listSources = (directory: string): string[] =>
    readdirSync(path.resolve(process.cwd(), directory), { recursive: true, encoding: "utf8" })
      .filter((entry) => /\.tsx?$/u.test(entry))
      .map((entry) => path.join(directory, entry));
  const spotifyFiles = [...listSources("src/main/spotify"), "src/main/actions/spotify-action-executor.ts", "src/main/assistant/spotify-control-phrases.ts", "src/main/assistant/streaming-phrases.ts"];
  const base = (file: string): string => path.basename(file);

  it("performs HTTP only in the single API client module", () => {
    const using = spotifyFiles.filter((file) => /\bfetch\(|XMLHttpRequest|WebSocket|node:https:/u.test(source(file).replace(/\/\/.*$/gmu, "")));
    expect(using.map(base)).toEqual(["spotify-api-client.ts"]);
    expect(source("src/main/spotify/spotify-api-client.ts")).toContain("redirect: \"manual\"");
  });

  it("opens a link only in the authorization launcher and listens only in the loopback server", () => {
    expect(spotifyFiles.filter((file) => source(file).includes("openExternal")).map(base)).toEqual(["spotify-authorize-launcher.ts"]);
    expect(spotifyFiles.filter((file) => /node:http\b/u.test(source(file))).map(base)).toEqual(["spotify-loopback-server.ts"]);
    expect(source("src/main/spotify/spotify-loopback-server.ts")).toContain("SPOTIFY_LOOPBACK_HOST");
    expect(source("src/main/spotify/spotify-config.ts")).toContain('SPOTIFY_LOOPBACK_HOST = "127.0.0.1"');
  });

  it("has no client secret, no extra scope, no library or profile endpoint and no device transfer", () => {
    const code = spotifyFiles.map(source).join("\n");
    expect(code).not.toMatch(/client_secret|clientSecret|SPOTIFY_CLIENT_SECRET/u);
    expect(code).not.toMatch(/user-read-email|user-read-private|playlist-|user-library|user-follow|streaming/u);
    expect(code).not.toMatch(/\/me\/(?:playlists|tracks|albums|following|devices)|\/v1\/me["'`]|transfer/u);
    expect(code).not.toMatch(/localStorage|console\.(?:log|info|debug)|child_process|node:fs|\bspawn\(/u);
    for (const file of spotifyFiles) {
      for (const call of source(file).match(/logError\([^)]*\)/gu) ?? []) expect(call).toMatch(/logError\(("[^"$]*"|message)\)/u);
    }
  });

  it("adds no renderer, preload or IPC surface and never reads the environment file", () => {
    expect(source("src/preload/preload.ts")).not.toMatch(/spotify/iu);
    expect(source("src/shared/contracts.ts")).not.toMatch(/spotify/iu);
    // Only the action label table mentions Spotify in the renderer; there is no component, state or channel.
    expect(listSources("src/renderer").filter((file) => /spotify/iu.test(source(file))).map(base)).toEqual(["app-state.ts"]);
    expect(source("src/renderer/app/app-state.ts").match(/spotify/giu)?.length).toBeGreaterThan(0);
    expect(spotifyFiles.map(source).join("\n")).not.toMatch(/readFileSync|\.env["'`]/u);
    expect(source("src/main/spotify/spotify-config.ts")).toContain("process.env");
  });
});
