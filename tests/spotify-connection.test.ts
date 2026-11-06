import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  ipcMain: { handle: vi.fn() },
  dialog: {},
  safeStorage: {},
  shell: { openExternal: vi.fn(async (_url: string) => undefined) }
}));

import { createSpotifyApiClient } from "../src/main/spotify/spotify-api-client";
import { createSpotifyAuthService, SPOTIFY_REFRESH_MARGIN_MS } from "../src/main/spotify/spotify-auth-service";
import {
  buildAuthorizeUrl,
  createSpotifyAuthorizeLauncher,
  isAllowedAuthorizeUrl
} from "../src/main/spotify/spotify-authorize-launcher";
import {
  getSpotifyClientId,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPE_PARAMETER,
  SPOTIFY_SCOPES
} from "../src/main/spotify/spotify-config";
import { SPOTIFY_FAILURES } from "../src/main/spotify/spotify-failures";
import {
  createSpotifyLoopbackServer,
  type LoopbackRequest,
  type LoopbackResponse,
  type LoopbackServerLike
} from "../src/main/spotify/spotify-loopback-server";
import { generateAuthorizationState, generatePkcePair, toCodeChallenge } from "../src/main/spotify/spotify-pkce";
import {
  createSpotifyTokenStore,
  type SpotifyConnectionRepository,
  type SpotifySecretStorage
} from "../src/main/spotify/spotify-token-store";

const CLIENT_ID = "0123456789abcdef0123456789abcdef";
const SECRET_TOKEN = "AccessTokenSecret123";
const SECRET_REFRESH = "RefreshTokenSecret456";
const CODE = "AuthorizationCode789";

describe("PKCE and state", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    expect(toCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("creates a 43-128 character base64url verifier whose challenge is its SHA-256", () => {
    const { verifier, challenge } = generatePkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/u);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(generatePkcePair().verifier).not.toBe(verifier);
  });

  it("uses an unguessable state and takes its randomness from the injected source", () => {
    expect(generateAuthorizationState()).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(generateAuthorizationState(() => Buffer.alloc(24, 1))).toBe(Buffer.alloc(24, 1).toString("base64url"));
    expect(generateAuthorizationState()).not.toBe(generateAuthorizationState());
  });
});

describe("fixed configuration", () => {
  it("uses the exact redirect URI and only the two playback scopes", () => {
    expect(SPOTIFY_REDIRECT_URI).toBe("http://127.0.0.1:8888/callback");
    expect([...SPOTIFY_SCOPES]).toEqual(["user-read-playback-state", "user-modify-playback-state"]);
    expect(SPOTIFY_SCOPE_PARAMETER).toBe("user-read-playback-state user-modify-playback-state");
    expect(SPOTIFY_SCOPE_PARAMETER).not.toMatch(/playlist|library|email|private|follow|streaming/u);
  });

  it("reads the Client ID only from the given environment and rejects unusable values", () => {
    expect(getSpotifyClientId({ SPOTIFY_CLIENT_ID: ` ${CLIENT_ID} ` } as NodeJS.ProcessEnv)).toBe(CLIENT_ID);
    for (const value of [undefined, "", "   ", "short", "has space in it 0123456789", "with-dash-0123456789abcdef", "x".repeat(65)]) {
      expect(getSpotifyClientId({ SPOTIFY_CLIENT_ID: value } as NodeJS.ProcessEnv)).toBeUndefined();
    }
    expect(getSpotifyClientId({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("authorization URL allowlist and launcher", () => {
  const challenge = toCodeChallenge("verifier");
  const state = "abcdefghijklmnopqrstuvwxyz012345";
  const url = buildAuthorizeUrl({ clientId: CLIENT_ID, challenge, state });

  it("builds exactly the fixed authorize URL with the fixed parameters", () => {
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://accounts.spotify.com/authorize");
    expect([...parsed.searchParams.keys()]).toEqual([
      "client_id", "response_type", "redirect_uri", "code_challenge_method", "code_challenge", "state", "scope"
    ]);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
      scope: SPOTIFY_SCOPE_PARAMETER
    });
    expect(url).not.toMatch(/client_secret|show_dialog|token/u);
    expect(isAllowedAuthorizeUrl(url)).toBe(true);
  });

  it.each([
    ["another host", (u: URL) => { u.host = "accounts.spotify.com.evil.example"; }],
    ["another path", (u: URL) => { u.pathname = "/api/token"; }],
    ["http", (u: URL) => { u.protocol = "http:"; }],
    ["a port", (u: URL) => { u.port = "444"; }],
    ["credentials", (u: URL) => { u.username = "user"; }],
    ["a fragment", (u: URL) => { u.hash = "x"; }],
    ["an extra parameter", (u: URL) => { u.searchParams.set("show_dialog", "true"); }],
    ["a missing parameter", (u: URL) => { u.searchParams.delete("state"); }],
    ["a duplicated parameter", (u: URL) => { u.searchParams.append("state", state); }],
    ["another redirect URI", (u: URL) => { u.searchParams.set("redirect_uri", "http://localhost:8888/callback"); }],
    ["another response type", (u: URL) => { u.searchParams.set("response_type", "token"); }],
    ["the plain challenge method", (u: URL) => { u.searchParams.set("code_challenge_method", "plain"); }],
    ["a wider scope", (u: URL) => { u.searchParams.set("scope", `${SPOTIFY_SCOPE_PARAMETER} user-read-email`); }],
    ["a bad client id", (u: URL) => { u.searchParams.set("client_id", "bad id"); }],
    ["a short challenge", (u: URL) => { u.searchParams.set("code_challenge", "short"); }],
    ["a short state", (u: URL) => { u.searchParams.set("state", "short"); }]
  ])("rejects %s", (_label, mutate) => {
    const changed = new URL(url);
    mutate(changed);
    expect(isAllowedAuthorizeUrl(changed.toString())).toBe(false);
  });

  it("rejects things that are not URLs", () => {
    for (const value of ["", "not a url", "file:///C:/x", "javascript:alert(1)", "spotify:search:x"]) {
      expect(isAllowedAuthorizeUrl(value)).toBe(false);
    }
  });

  it("opens only the validated URL and reports a failed open without leaking it", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const logError = vi.fn();
    const launcher = createSpotifyAuthorizeLauncher({ openExternal, logError });
    await expect(launcher.open({ clientId: CLIENT_ID, challenge, state })).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);

    await expect(launcher.open({ clientId: "bad id", challenge, state })).resolves.toBe(false);
    await expect(launcher.open({ clientId: CLIENT_ID, challenge: "x", state })).resolves.toBe(false);
    expect(openExternal).toHaveBeenCalledTimes(1);

    const failing = createSpotifyAuthorizeLauncher({
      openExternal: async () => { throw new Error(`cannot open ${url}`); },
      logError
    });
    await expect(failing.open({ clientId: CLIENT_ID, challenge, state })).resolves.toBe(false);
    expect(logError.mock.calls).toEqual([["Spotify authorization page could not be opened."]]);
    expect(JSON.stringify(logError.mock.calls)).not.toMatch(/accounts\.spotify|code_challenge|client_id/u);
  });
});

type Handler = (request: LoopbackRequest, response: LoopbackResponse) => void;

const createFakeServer = (options: { listenError?: string } = {}) => {
  let handler: Handler = () => undefined;
  const listeners: Record<string, (error: { code?: string }) => void> = {};
  const server = {
    listen: vi.fn((_options: { host: string; port: number }, callback: () => void) => {
      if (options.listenError) listeners.error?.({ code: options.listenError });
      else callback();
    }),
    on: vi.fn((event: "error", listener: (error: { code?: string }) => void) => { listeners[event] = listener; }),
    close: vi.fn(),
    closeAllConnections: vi.fn()
  } satisfies LoopbackServerLike;
  const timers: Array<{ callback: () => void; delay: number; active: boolean }> = [];
  const loopback = createSpotifyLoopbackServer({
    createServer: (requestHandler) => { handler = requestHandler; return server; },
    setTimer: (callback, delay) => { const timer = { callback, delay, active: true }; timers.push(timer); return timer; },
    clearTimer: (timer) => { (timer as { active: boolean }).active = false; },
    logError: vi.fn()
  });
  const send = (target: string, overrides: Partial<LoopbackRequest> = {}) => {
    const responses: Array<{ status: number; headers: Record<string, string>; body: string }> = [];
    const response: LoopbackResponse = {
      writeHead: (status, headers) => { responses.push({ status, headers, body: "" }); },
      end: (body) => { responses[responses.length - 1].body = body ?? ""; }
    };
    handler({ method: "GET", url: target, headers: { host: "127.0.0.1:8888" }, socket: { remoteAddress: "127.0.0.1" }, ...overrides }, response);
    return responses[0];
  };
  return { loopback, server, send, timers };
};

describe("loopback callback server", () => {
  const STATE = "state-value-0123456789abcdef";

  it("listens on 127.0.0.1:8888 only and finishes once with the code for the right state", async () => {
    const { loopback, server, send, timers } = createFakeServer();
    const started = await loopback.start(STATE);
    if (!started.ok) throw new Error("Expected to listen.");
    expect(server.listen.mock.calls[0][0]).toEqual({ host: "127.0.0.1", port: 8888 });
    expect(timers[0].delay).toBe(2 * 60 * 1000);

    const page = send(`/callback?code=${CODE}&state=${STATE}`);

    await expect(started.outcome).resolves.toEqual({ status: "CODE", code: CODE });
    expect(page.status).toBe(200);
    expect(page.headers["Cache-Control"]).toBe("no-store");
    expect(page.body).toContain("Puedes cerrar esta ventana");
    expect(page.body).not.toContain(CODE);
    expect(page.body).not.toContain(STATE);
    expect(server.close).toHaveBeenCalled();
    expect(timers[0].active).toBe(false);
  });

  it.each([
    ["a wrong state", `/callback?code=${CODE}&state=other`, 400],
    ["a missing state", `/callback?code=${CODE}`, 400],
    ["a code with forbidden characters", `/callback?code=ab%3Cc&state=${STATE}`, 400],
    ["an empty code", `/callback?code=&state=${STATE}`, 400],
    ["another path", `/other?code=${CODE}&state=${STATE}`, 404],
    ["the root path", `/?code=${CODE}&state=${STATE}`, 404]
  ])("rejects %s with a plain page and keeps waiting", async (_label, target, status) => {
    const { loopback, server, send } = createFakeServer();
    const started = await loopback.start(STATE);
    if (!started.ok) throw new Error("Expected to listen.");
    const page = send(target);
    expect(page.status).toBe(status);
    expect(page.body).not.toMatch(new RegExp(`${CODE}|${STATE}|other`, "u"));
    expect(server.close).not.toHaveBeenCalled();
    send(`/callback?code=${CODE}&state=${STATE}`);
    await expect(started.outcome).resolves.toMatchObject({ status: "CODE" });
  });

  it("rejects another method, another host header and a non-loopback peer", async () => {
    const { loopback, send } = createFakeServer();
    const started = await loopback.start(STATE);
    if (!started.ok) throw new Error("Expected to listen.");
    const target = `/callback?code=${CODE}&state=${STATE}`;
    expect(send(target, { method: "POST" }).status).toBe(405);
    expect(send(target, { headers: { host: "evil.example" } }).status).toBe(400);
    expect(send(target, { headers: { host: "127.0.0.1:9999" } }).status).toBe(400);
    expect(send(target, { socket: { remoteAddress: "192.168.1.20" } }).status).toBe(400);
    loopback.cancel();
    await expect(started.outcome).resolves.toEqual({ status: "CANCELLED" });
  });

  it("reports a denied authorization without a code", async () => {
    const { loopback, send } = createFakeServer();
    const started = await loopback.start(STATE);
    if (!started.ok) throw new Error("Expected to listen.");
    const page = send(`/callback?error=access_denied&state=${STATE}`);
    await expect(started.outcome).resolves.toEqual({ status: "DENIED" });
    expect(page.body).toContain("No se conectó Spotify");
  });

  it("closes itself on the timeout and on cancel", async () => {
    const timed = createFakeServer();
    const started = await timed.loopback.start(STATE);
    if (!started.ok) throw new Error("Expected to listen.");
    timed.timers[0].callback();
    await expect(started.outcome).resolves.toEqual({ status: "TIMEOUT" });
    expect(timed.server.close).toHaveBeenCalled();

    const cancelled = createFakeServer();
    const second = await cancelled.loopback.start(STATE);
    if (!second.ok) throw new Error("Expected to listen.");
    cancelled.loopback.cancel();
    await expect(second.outcome).resolves.toEqual({ status: "CANCELLED" });
    expect(cancelled.server.close).toHaveBeenCalled();
    expect(cancelled.timers[0].active).toBe(false);
  });

  it("reports a busy port or another listen error without waiting", async () => {
    await expect(createFakeServer({ listenError: "EADDRINUSE" }).loopback.start(STATE)).resolves.toEqual({ ok: false, reason: "PORT_BUSY" });
    await expect(createFakeServer({ listenError: "EACCES" }).loopback.start(STATE)).resolves.toEqual({ ok: false, reason: "FAILED" });
  });

  it("is one-shot: a callback after completion changes nothing", async () => {
    const { loopback, send, server } = createFakeServer();
    const started = await loopback.start(STATE);
    if (!started.ok) throw new Error("Expected to listen.");
    send(`/callback?code=first&state=${STATE}`);
    send(`/callback?code=second&state=${STATE}`);
    await expect(started.outcome).resolves.toEqual({ status: "CODE", code: "first" });
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});

const createStorage = (available = true) => {
  const storage: SpotifySecretStorage = {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((plain: string) => Buffer.from(`enc:${Buffer.from(plain).toString("hex")}`)),
    decryptString: vi.fn((encrypted: Buffer) => Buffer.from(encrypted.toString().slice(4), "hex").toString())
  };
  return storage;
};

const createRepository = () => {
  let stored: unknown;
  const repository: SpotifyConnectionRepository = {
    get: vi.fn(async () => stored),
    save: vi.fn(async (value) => { stored = value; }),
    remove: vi.fn(async () => { stored = undefined; })
  };
  return { repository, peek: () => stored };
};

const tokens = { accessToken: SECRET_TOKEN, refreshToken: SECRET_REFRESH, expiresAt: 5_000_000 };

describe("token storage", () => {
  it("stores only encrypted data and reads it back", async () => {
    const storage = createStorage();
    const { repository, peek } = createRepository();
    const store = createSpotifyTokenStore({ storage, repository, logError: vi.fn() });

    await expect(store.save(tokens)).resolves.toEqual({ ok: true, data: null });

    expect(storage.encryptString).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(peek())).not.toMatch(new RegExp(`${SECRET_TOKEN}|${SECRET_REFRESH}|accessToken|refreshToken`, "u"));
    expect(peek()).toMatchObject({ version: 1, ciphertext: expect.any(String) });

    const fresh = createSpotifyTokenStore({ storage, repository, logError: vi.fn() });
    await expect(fresh.load()).resolves.toEqual({ ok: true, data: tokens });
  });

  it("refuses to store anything without safeStorage and never writes plaintext", async () => {
    const storage = createStorage(false);
    const { repository } = createRepository();
    const store = createSpotifyTokenStore({ storage, repository, logError: vi.fn() });
    expect(store.canStore()).toBe(false);
    await expect(store.save(tokens)).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_SECURE_STORAGE_UNAVAILABLE" } });
    expect(repository.save).not.toHaveBeenCalled();
    expect(storage.encryptString).not.toHaveBeenCalled();
  });

  it("treats an encryption failure or unreadable data as a controlled failure without leaking anything", async () => {
    const logError = vi.fn();
    const storage = createStorage();
    storage.encryptString = vi.fn(() => { throw new Error(`boom ${SECRET_TOKEN}`); });
    const { repository } = createRepository();
    const failing = createSpotifyTokenStore({ storage, repository, logError });
    const saved = await failing.save(tokens);
    expect(saved).toMatchObject({ ok: false, error: { code: "SPOTIFY_SECURE_STORAGE_UNAVAILABLE" } });
    expect(JSON.stringify([saved, logError.mock.calls])).not.toContain(SECRET_TOKEN);

    const corrupted = createSpotifyTokenStore({
      storage: createStorage(),
      repository: { get: async () => ({ version: 1, ciphertext: "!!!not-valid!!!" }), save: vi.fn(), remove: vi.fn() },
      logError
    });
    await expect(corrupted.load()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_SECURE_STORAGE_UNAVAILABLE" } });
  });

  it("clears the stored connection and answers not connected afterwards", async () => {
    const { repository, peek } = createRepository();
    const store = createSpotifyTokenStore({ storage: createStorage(), repository, logError: vi.fn() });
    await store.save(tokens);
    await store.clear();
    expect(peek()).toBeUndefined();
    await expect(store.load()).resolves.toEqual({ ok: true, data: undefined });
  });

  it("returns undefined when nothing is stored and rejects malformed tokens", async () => {
    const { repository } = createRepository();
    const store = createSpotifyTokenStore({ storage: createStorage(), repository, logError: vi.fn() });
    await expect(store.load()).resolves.toEqual({ ok: true, data: undefined });
    await expect(store.save({ accessToken: "", refreshToken: "x", expiresAt: 1 })).resolves.toMatchObject({ ok: false });
    expect(repository.save).not.toHaveBeenCalled();
  });
});

const createAuth = (options: {
  clientId?: string | undefined;
  canStore?: boolean;
  start?: Awaited<ReturnType<ReturnType<typeof createSpotifyLoopbackServer>["start"]>>;
  opened?: boolean;
  stored?: typeof tokens;
  now?: number;
} = {}) => {
  const order: string[] = [];
  const storage = createStorage(options.canStore ?? true);
  const { repository, peek } = createRepository();
  const store = createSpotifyTokenStore({ storage, repository, logError: vi.fn() });
  const loopback = {
    start: vi.fn(async (_state: string) => {
      order.push("listen");
      return options.start ?? { ok: true as const, outcome: Promise.resolve({ status: "CODE" as const, code: CODE }) };
    }),
    cancel: vi.fn()
  };
  const launcher = { open: vi.fn(async (_parameters: { clientId: string; challenge: string; state: string }) => { order.push("open"); return options.opened ?? true; }) };
  const client = {
    exchangeCode: vi.fn(async (_input: { clientId: string; code: string; verifier: string }) =>
      ({ ok: true as const, data: { accessToken: SECRET_TOKEN, refreshToken: SECRET_REFRESH, expiresInSeconds: 3600 } })),
    refresh: vi.fn(async (_input: { clientId: string; refreshToken: string }) =>
      ({ ok: true as const, data: { accessToken: "NewAccessToken", expiresInSeconds: 3600 } }) as { ok: true; data: { accessToken: string; refreshToken?: string; expiresInSeconds: number } } | { ok: false; error: { code: keyof typeof SPOTIFY_FAILURES; userMessage: string } })
  };
  const now = options.now ?? 1_000_000;
  const service = createSpotifyAuthService({
    getClientId: () => ("clientId" in options ? options.clientId : CLIENT_ID),
    store,
    client: client as never,
    loopback: loopback as never,
    launcher,
    generatePkce: () => ({ verifier: "fixed-verifier", challenge: toCodeChallenge("fixed-verifier") }),
    generateState: () => "fixed-state-0123456789abcdef",
    now: () => now
  });
  return { service, store, loopback, launcher, client, order, peek, repository, now, storage, seed: () => store.save(options.stored ?? tokens) };
};

describe("connect flow", () => {
  it("listens first, opens the allowlisted page with the PKCE challenge and state, exchanges the code and stores encrypted tokens", async () => {
    const flow = createAuth();
    await expect(flow.service.connect()).resolves.toEqual({ ok: true, data: null });

    expect(flow.order).toEqual(["listen", "open"]);
    expect(flow.loopback.start).toHaveBeenCalledWith("fixed-state-0123456789abcdef");
    expect(flow.launcher.open).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      challenge: toCodeChallenge("fixed-verifier"),
      state: "fixed-state-0123456789abcdef"
    });
    expect(flow.client.exchangeCode).toHaveBeenCalledWith({ clientId: CLIENT_ID, code: CODE, verifier: "fixed-verifier" });
    expect(JSON.stringify(flow.peek())).not.toMatch(new RegExp(`${SECRET_TOKEN}|${SECRET_REFRESH}`, "u"));
    await expect(flow.service.getStatus()).resolves.toEqual({ configured: true, connected: true });
    const stored = await flow.store.load();
    expect(stored).toEqual({ ok: true, data: { accessToken: SECRET_TOKEN, refreshToken: SECRET_REFRESH, expiresAt: flow.now + 3_600_000 } });
  });

  it("reports an unconfigured connection without opening anything", async () => {
    const flow = createAuth({ clientId: undefined });
    await expect(flow.service.connect()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NOT_CONFIGURED" } });
    expect(flow.loopback.start).not.toHaveBeenCalled();
    expect(flow.launcher.open).not.toHaveBeenCalled();
  });

  it("refuses to start when the tokens could not be stored securely", async () => {
    const flow = createAuth({ canStore: false });
    await expect(flow.service.connect()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_SECURE_STORAGE_UNAVAILABLE" } });
    expect(flow.loopback.start).not.toHaveBeenCalled();
    expect(flow.launcher.open).not.toHaveBeenCalled();
    expect(flow.client.exchangeCode).not.toHaveBeenCalled();
    expect(flow.repository.save).not.toHaveBeenCalled();
  });

  it.each([
    ["a busy port", { ok: false as const, reason: "PORT_BUSY" as const }, "SPOTIFY_CONNECT_PORT_BUSY"],
    ["a listen failure", { ok: false as const, reason: "FAILED" as const }, "SPOTIFY_NETWORK_ERROR"]
  ])("maps %s without opening the browser", async (_label, start, code) => {
    const flow = createAuth({ start });
    await expect(flow.service.connect()).resolves.toMatchObject({ ok: false, error: { code } });
    expect(flow.launcher.open).not.toHaveBeenCalled();
  });

  it("cancels the receiver and reports a browser that could not be opened", async () => {
    const flow = createAuth({ opened: false, start: { ok: true, outcome: Promise.resolve({ status: "CANCELLED" as const }) } });
    await expect(flow.service.connect()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_BROWSER_UNAVAILABLE" } });
    expect(flow.loopback.cancel).toHaveBeenCalled();
    expect(flow.client.exchangeCode).not.toHaveBeenCalled();
  });

  it.each([
    ["a timeout", { status: "TIMEOUT" as const }, "SPOTIFY_CONNECT_TIMEOUT"],
    ["a denial", { status: "DENIED" as const }, "SPOTIFY_CONNECT_CANCELLED"],
    ["a cancel", { status: "CANCELLED" as const }, "SPOTIFY_CONNECT_CANCELLED"]
  ])("maps %s to its own failure and stores nothing", async (_label, outcome, code) => {
    const flow = createAuth({ start: { ok: true, outcome: Promise.resolve(outcome) } });
    await expect(flow.service.connect()).resolves.toMatchObject({ ok: false, error: { code } });
    expect(flow.client.exchangeCode).not.toHaveBeenCalled();
    expect(flow.repository.save).not.toHaveBeenCalled();
  });

  it("shares one attempt between concurrent connect requests", async () => {
    const flow = createAuth();
    const [first, second] = await Promise.all([flow.service.connect(), flow.service.connect()]);
    expect(first).toEqual(second);
    expect(flow.loopback.start).toHaveBeenCalledTimes(1);
  });

  it("does not store a grant that has no refresh token", async () => {
    const flow = createAuth();
    flow.client.exchangeCode.mockResolvedValueOnce({ ok: true, data: { accessToken: SECRET_TOKEN, expiresInSeconds: 3600 } } as never);
    await expect(flow.service.connect()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_UNEXPECTED_RESPONSE" } });
    expect(flow.repository.save).not.toHaveBeenCalled();
  });
});

describe("access tokens, refresh and disconnect", () => {
  it("returns the stored token while it is valid without any request", async () => {
    const flow = createAuth({ stored: { ...tokens, expiresAt: 1_000_000 + SPOTIFY_REFRESH_MARGIN_MS + 1_000 } });
    await flow.seed();
    await expect(flow.service.getAccessToken()).resolves.toEqual({ ok: true, data: SECRET_TOKEN });
    expect(flow.client.refresh).not.toHaveBeenCalled();
  });

  it("refreshes before expiry, keeps the old refresh token when none is returned, and stores the result encrypted", async () => {
    const flow = createAuth({ stored: { ...tokens, expiresAt: 1_000_000 + 1_000 } });
    await flow.seed();
    await expect(flow.service.getAccessToken()).resolves.toEqual({ ok: true, data: "NewAccessToken" });
    expect(flow.client.refresh).toHaveBeenCalledWith({ clientId: CLIENT_ID, refreshToken: SECRET_REFRESH });
    expect(JSON.stringify(flow.peek())).not.toMatch(/NewAccessToken|RefreshTokenSecret/u);
    await expect(flow.store.load()).resolves.toMatchObject({ ok: true, data: { accessToken: "NewAccessToken", refreshToken: SECRET_REFRESH } });
  });

  it("refreshes again after a 401 and shares one refresh between callers", async () => {
    const flow = createAuth();
    await flow.seed();
    const [first, second] = await Promise.all([flow.service.refreshAfterUnauthorized(), flow.service.refreshAfterUnauthorized()]);
    expect(first).toEqual({ ok: true, data: "NewAccessToken" });
    expect(second).toEqual(first);
    expect(flow.client.refresh).toHaveBeenCalledTimes(1);
  });

  it("clears the tokens and asks to connect again when the refresh is rejected", async () => {
    const flow = createAuth({ stored: { ...tokens, expiresAt: 1 } });
    await flow.seed();
    flow.client.refresh.mockResolvedValueOnce({ ok: false, error: { code: "SPOTIFY_AUTH_EXPIRED", userMessage: SPOTIFY_FAILURES.SPOTIFY_AUTH_EXPIRED } });
    await expect(flow.service.getAccessToken()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_AUTH_EXPIRED" } });
    expect(flow.peek()).toBeUndefined();
    await expect(flow.service.getStatus()).resolves.toEqual({ configured: true, connected: false });
    await expect(flow.service.getAccessToken()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NOT_CONNECTED" } });
  });

  it("keeps the tokens when the refresh only failed because of the network", async () => {
    const flow = createAuth({ stored: { ...tokens, expiresAt: 1 } });
    await flow.seed();
    flow.client.refresh.mockResolvedValueOnce({ ok: false, error: { code: "SPOTIFY_NETWORK_ERROR", userMessage: SPOTIFY_FAILURES.SPOTIFY_NETWORK_ERROR } });
    await expect(flow.service.getAccessToken()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NETWORK_ERROR" } });
    expect(flow.peek()).toBeDefined();
  });

  it("reports not connected and not configured", async () => {
    const flow = createAuth();
    await expect(flow.service.getAccessToken()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NOT_CONNECTED" } });
    const unconfigured = createAuth({ clientId: undefined, stored: { ...tokens, expiresAt: 1 } });
    await unconfigured.seed();
    await expect(unconfigured.service.getAccessToken()).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NOT_CONFIGURED" } });
    await expect(unconfigured.service.getStatus()).resolves.toEqual({ configured: false, connected: true });
  });

  it("disconnects by clearing the tokens and cancelling any waiting connection; the status needs no network", async () => {
    const flow = createAuth();
    await flow.seed();
    await expect(flow.service.getStatus()).resolves.toEqual({ configured: true, connected: true });
    expect(flow.client.refresh).not.toHaveBeenCalled();
    await expect(flow.service.disconnect()).resolves.toEqual({ ok: true, data: null });
    expect(flow.peek()).toBeUndefined();
    expect(flow.loopback.cancel).toHaveBeenCalled();
    await expect(flow.service.getStatus()).resolves.toEqual({ configured: true, connected: false });
    flow.service.shutdown();
    expect(flow.loopback.cancel).toHaveBeenCalledTimes(2);
  });
});

type FetchCall = { url: string; init: { method: string; headers: Record<string, string>; body?: string; redirect: string } };

const respond = (status: number, body?: unknown, headers: Record<string, string> = {}, type = "basic") => ({
  status,
  type,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new Error("no body"); return body; }
});

const createClient = (script: Array<ReturnType<typeof respond> | Error>) => {
  const calls: FetchCall[] = [];
  const sleep = vi.fn(async (_milliseconds: number) => undefined);
  const logError = vi.fn();
  let index = 0;
  const client = createSpotifyApiClient({
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = script[Math.min(index++, script.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    sleep,
    logError
  });
  return { client, calls, sleep, logError };
};

const TRACK_URI = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const ALBUM_URI = "spotify:album:1uyf3l2d4XYwiEqAb7t7fX";

describe("API client: allowlist, endpoints and bodies", () => {
  it("exchanges the code at the fixed token endpoint with PKCE and no client secret", async () => {
    const { client, calls } = createClient([respond(200, { access_token: SECRET_TOKEN, refresh_token: SECRET_REFRESH, expires_in: 3600 })]);
    await expect(client.exchangeCode({ clientId: CLIENT_ID, code: CODE, verifier: "verifier-value" })).resolves.toEqual({
      ok: true,
      data: { accessToken: SECRET_TOKEN, refreshToken: SECRET_REFRESH, expiresInSeconds: 3600 }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://accounts.spotify.com/api/token");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(Object.fromEntries(new URLSearchParams(calls[0].init.body))).toEqual({
      grant_type: "authorization_code",
      code: CODE,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: "verifier-value"
    });
    expect(calls[0].init.body).not.toMatch(/client_secret/u);
  });

  it("refreshes with the refresh token and the client id only", async () => {
    const { client, calls } = createClient([respond(200, { access_token: "n", expires_in: 100 })]);
    await expect(client.refresh({ clientId: CLIENT_ID, refreshToken: SECRET_REFRESH })).resolves.toEqual({
      ok: true, data: { accessToken: "n", expiresInSeconds: 100 }
    });
    expect(Object.fromEntries(new URLSearchParams(calls[0].init.body))).toEqual({
      grant_type: "refresh_token", refresh_token: SECRET_REFRESH, client_id: CLIENT_ID
    });
  });

  it("searches with the fixed endpoint, a limit of 10 and the fixed type, and parses closed results", async () => {
    const { client, calls } = createClient([respond(200, {
      tracks: { items: [
        { uri: TRACK_URI, name: "Despacito", artists: [{ name: "Luis Fonsi" }, { name: "Daddy Yankee" }] },
        { uri: "spotify:track:short", name: "Bad URI" },
        { uri: "spotify:user:4uLU6hMCjMI75M1A2tKUQC", name: "Not a track" },
        null,
        "text"
      ] }
    })]);
    const result = await client.search(SECRET_TOKEN, "Despacito & más", "track");
    expect(result).toEqual({ ok: true, data: [{ uri: TRACK_URI, name: "Despacito", artist: "Luis Fonsi" }] });
    expect(calls[0].url).toBe(`https://api.spotify.com/v1/search?q=${encodeURIComponent("Despacito & más").replace(/%20/gu, "+")}&type=track&limit=10`);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(calls[0].init.redirect).toBe("manual");
  });

  it.each([
    ["artist", "artists"],
    ["album", "albums"],
    ["playlist", "playlists"]
  ] as const)("reads %s results from their own section and skips null entries", async (type, section) => {
    const { client } = createClient([respond(200, { [section]: { items: [null, { uri: ALBUM_URI.replace("album", type), name: "Nombre" }] } })]);
    await expect(client.search("t", "x", type)).resolves.toEqual({ ok: true, data: [{ uri: ALBUM_URI.replace("album", type), name: "Nombre" }] });
  });

  it("rejects a search response of the wrong shape", async () => {
    for (const body of [undefined, {}, { tracks: {} }, { tracks: { items: "x" } }, "text"]) {
      const { client } = createClient([respond(200, body)]);
      await expect(client.search("t", "x", "track")).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_UNEXPECTED_RESPONSE" } });
    }
  });

  it("starts a track with uris and anything else with context_uri, and resumes with no body", async () => {
    const { client, calls } = createClient([respond(204), respond(204), respond(204)]);
    await client.play("t", { type: "track", uri: TRACK_URI });
    await client.play("t", { type: "context", uri: ALBUM_URI });
    await client.play("t");
    expect(calls.map((call) => call.url)).toEqual(Array(3).fill("https://api.spotify.com/v1/me/player/play"));
    expect(calls.map((call) => call.init.method)).toEqual(["PUT", "PUT", "PUT"]);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ uris: [TRACK_URI] });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ context_uri: ALBUM_URI });
    expect(calls[2].init.body).toBeUndefined();
  });

  it("uses the fixed endpoint and method for every control", async () => {
    const { client, calls } = createClient([respond(204)]);
    await client.pause("t");
    await client.next("t");
    await client.previous("t");
    await client.setVolume("t", 40);
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "PUT https://api.spotify.com/v1/me/player/pause",
      "POST https://api.spotify.com/v1/me/player/next",
      "POST https://api.spotify.com/v1/me/player/previous",
      "PUT https://api.spotify.com/v1/me/player/volume?volume_percent=40"
    ]);
    for (const call of calls) {
      expect(new URL(call.url).host).toBe("api.spotify.com");
      expect(call.init.redirect).toBe("manual");
    }
  });

  it("validates the volume before any request", async () => {
    const { client, calls } = createClient([respond(204)]);
    for (const level of [-1, 101, 40.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(client.setVolume("t", level)).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_INVALID_REQUEST" } });
    }
    expect(calls).toHaveLength(0);
  });

  it("reads the playback state, treating 204 as no active device", async () => {
    const state = createClient([respond(200, {
      is_playing: true,
      item: { name: "Despacito", artists: [{ name: "Luis Fonsi" }] },
      device: { volume_percent: 55 }
    })]);
    await expect(state.client.getPlayback("t")).resolves.toEqual({
      ok: true, data: { isPlaying: true, title: "Despacito", artist: "Luis Fonsi", volumePercent: 55 }
    });
    expect(state.calls[0].url).toBe("https://api.spotify.com/v1/me/player");
    await expect(createClient([respond(204)]).client.getPlayback("t")).resolves.toEqual({ ok: true, data: null });
    await expect(createClient([respond(200, "x")]).client.getPlayback("t")).resolves.toMatchObject({ ok: false });
  });
});

describe("API client: errors, retries and leakage", () => {
  it.each([
    ["a 401", respond(401, { error: { message: "token secret" } }), "SPOTIFY_AUTH_EXPIRED"],
    ["a Premium 403", respond(403, { error: { status: 403, message: "Player command failed: Premium required", reason: "PREMIUM_REQUIRED" } }), "SPOTIFY_PREMIUM_REQUIRED"],
    ["an allowlist 403", respond(403, { error: { status: 403, message: "User not registered in the Developer Dashboard" } }), "SPOTIFY_NOT_ALLOWLISTED"],
    ["a plain 403", respond(403), "SPOTIFY_NOT_ALLOWLISTED"],
    ["a 404 on a player endpoint", respond(404, { error: { reason: "NO_ACTIVE_DEVICE" } }), "SPOTIFY_NO_ACTIVE_DEVICE"],
    ["a 500", respond(500, { error: "boom" }), "SPOTIFY_UNEXPECTED_RESPONSE"],
    ["a 400", respond(400, { error: "bad" }), "SPOTIFY_UNEXPECTED_RESPONSE"],
    ["a redirect", respond(302, undefined, { location: "https://evil.example" }), "SPOTIFY_UNEXPECTED_RESPONSE"],
    ["an opaque redirect", respond(0, undefined, {}, "opaqueredirect"), "SPOTIFY_UNEXPECTED_RESPONSE"]
  ])("maps %s to its own category with a fixed message", async (_label, response, code) => {
    const { client } = createClient([response]);
    const result = await client.pause(SECRET_TOKEN);
    expect(result).toEqual({ ok: false, error: { code, userMessage: SPOTIFY_FAILURES[code as keyof typeof SPOTIFY_FAILURES] } });
    expect(JSON.stringify(result)).not.toMatch(/secret|boom|evil|Premium required|Dashboard|Bearer/iu);
  });

  it("maps a 404 outside the player endpoints to an unexpected response and token errors to expired", async () => {
    await expect(createClient([respond(404)]).client.search("t", "x", "track")).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_UNEXPECTED_RESPONSE" } });
    await expect(createClient([respond(400, { error: "invalid_grant" })]).client.refresh({ clientId: CLIENT_ID, refreshToken: "r" })).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_AUTH_EXPIRED" } });
    await expect(createClient([respond(200, { nothing: true })]).client.exchangeCode({ clientId: CLIENT_ID, code: "c", verifier: "v" })).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_UNEXPECTED_RESPONSE" } });
  });

  it("turns a network error into a fixed failure and logs only a constant message", async () => {
    const { client, logError } = createClient([new Error(`getaddrinfo ENOTFOUND api.spotify.com Bearer ${SECRET_TOKEN}`)]);
    const result = await client.pause(SECRET_TOKEN);
    expect(result).toMatchObject({ ok: false, error: { code: "SPOTIFY_NETWORK_ERROR" } });
    expect(logError.mock.calls).toEqual([["Spotify request failed."]]);
    expect(JSON.stringify([result, logError.mock.calls])).not.toMatch(new RegExp(`${SECRET_TOKEN}|ENOTFOUND|api\\.spotify`, "u"));
  });

  it("aborts after the timeout and reports a network error", async () => {
    const client = createSpotifyApiClient({
      fetch: (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(new Error("aborted"))); }),
      timeoutMs: 10,
      logError: vi.fn()
    });
    await expect(client.pause("t")).resolves.toMatchObject({ ok: false, error: { code: "SPOTIFY_NETWORK_ERROR" } });
  });

  it("uses a ten-second default timeout", async () => {
    const timers: number[] = [];
    const client = createSpotifyApiClient({
      fetch: async () => respond(204),
      setTimer: (_callback, delay) => { timers.push(delay); return 1; },
      clearTimer: () => undefined
    });
    await client.pause("t");
    expect(timers).toEqual([10_000]);
  });

  it("retries a 429 exactly once after the bounded Retry-After and then succeeds", async () => {
    const { client, calls, sleep } = createClient([respond(429, undefined, { "retry-after": "2" }), respond(204)]);
    await expect(client.pause("t")).resolves.toEqual({ ok: true, data: null });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2_000);
  });

  it("caps a long Retry-After and gives up after the second 429", async () => {
    const { client, calls, sleep } = createClient([respond(429, undefined, { "retry-after": "99" }), respond(429, undefined, { "retry-after": "99" })]);
    await expect(client.pause("t")).resolves.toEqual({
      ok: false, error: { code: "SPOTIFY_RATE_LIMITED", userMessage: SPOTIFY_FAILURES.SPOTIFY_RATE_LIMITED }
    });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5_000);
  });

  it("waits a default second when a 429 has no usable Retry-After", async () => {
    const { client, sleep } = createClient([respond(429), respond(204)]);
    await client.pause("t");
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("never sends the Authorization header to the token endpoint and never requests another host", async () => {
    const { client, calls } = createClient([respond(200, { access_token: "a", expires_in: 1 })]);
    await client.refresh({ clientId: CLIENT_ID, refreshToken: "r" });
    await client.search("t", "x", "track").catch(() => undefined);
    for (const call of calls) expect(["accounts.spotify.com", "api.spotify.com"]).toContain(new URL(call.url).host);
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });
});
