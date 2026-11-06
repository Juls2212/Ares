import {
  SPOTIFY_ACCOUNTS_ORIGIN,
  SPOTIFY_ALLOWED_HOSTS,
  SPOTIFY_API_ORIGIN,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_TOKEN_PATH
} from "./spotify-config";
import { spotifyFailure, spotifySuccess, type SpotifyFailureCode, type SpotifyResult } from "./spotify-failures";

/**
 * The single module that performs HTTP requests for the Spotify integration. Every request goes to one of
 * two fixed hosts through a fixed endpoint template, times out after 10 seconds, never follows a redirect,
 * retries a 429 once within a bounded wait, and maps every outcome to the closed failure taxonomy. Tokens,
 * URLs, response bodies and exceptions never leave this module.
 */
export const SPOTIFY_REQUEST_TIMEOUT_MS = 10_000;
export const SPOTIFY_MAX_RETRY_AFTER_MS = 5_000;
export const SPOTIFY_SEARCH_LIMIT = 10;

export type SpotifySearchType = "track" | "artist" | "album" | "playlist";
export type SpotifyPlayTarget = { type: "track"; uri: string } | { type: "context"; uri: string };

export type SpotifyTokenGrant = { accessToken: string; refreshToken?: string; expiresInSeconds: number };
export type SpotifySearchCandidate = { uri: string; name: string; artist?: string };
export type SpotifyPlaybackState = { isPlaying: boolean; title?: string; artist?: string; volumePercent?: number };

export type SpotifyApiClient = {
  exchangeCode: (input: { clientId: string; code: string; verifier: string }) => Promise<SpotifyResult<SpotifyTokenGrant>>;
  refresh: (input: { clientId: string; refreshToken: string }) => Promise<SpotifyResult<SpotifyTokenGrant>>;
  search: (accessToken: string, query: string, type: SpotifySearchType) => Promise<SpotifyResult<SpotifySearchCandidate[]>>;
  play: (accessToken: string, target?: SpotifyPlayTarget) => Promise<SpotifyResult<null>>;
  pause: (accessToken: string) => Promise<SpotifyResult<null>>;
  next: (accessToken: string) => Promise<SpotifyResult<null>>;
  previous: (accessToken: string) => Promise<SpotifyResult<null>>;
  setVolume: (accessToken: string, percent: number) => Promise<SpotifyResult<null>>;
  /** Resolves to null when Spotify reports no active playback device. */
  getPlayback: (accessToken: string) => Promise<SpotifyResult<SpotifyPlaybackState | null>>;
};

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect: "manual";
  signal: AbortSignal;
}) => Promise<{
  status: number;
  type?: string;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}>;

type ClientDependencies = {
  fetch: FetchLike;
  sleep: (milliseconds: number) => Promise<void>;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
  timeoutMs: number;
  logError: (message: string) => void;
};

/** Closed endpoint templates: origin, path and method. Nothing else can be requested. */
const ENDPOINTS = {
  TOKEN: { origin: SPOTIFY_ACCOUNTS_ORIGIN, path: SPOTIFY_TOKEN_PATH, method: "POST", player: false },
  SEARCH: { origin: SPOTIFY_API_ORIGIN, path: "/v1/search", method: "GET", player: false },
  PLAY: { origin: SPOTIFY_API_ORIGIN, path: "/v1/me/player/play", method: "PUT", player: true },
  PAUSE: { origin: SPOTIFY_API_ORIGIN, path: "/v1/me/player/pause", method: "PUT", player: true },
  NEXT: { origin: SPOTIFY_API_ORIGIN, path: "/v1/me/player/next", method: "POST", player: true },
  PREVIOUS: { origin: SPOTIFY_API_ORIGIN, path: "/v1/me/player/previous", method: "POST", player: true },
  VOLUME: { origin: SPOTIFY_API_ORIGIN, path: "/v1/me/player/volume", method: "PUT", player: true },
  STATE: { origin: SPOTIFY_API_ORIGIN, path: "/v1/me/player", method: "GET", player: true }
} as const;

type EndpointName = keyof typeof ENDPOINTS;
const QUERY_KEYS: Readonly<Record<EndpointName, readonly string[]>> = {
  TOKEN: [],
  SEARCH: ["q", "type", "limit"],
  PLAY: [],
  PAUSE: [],
  NEXT: [],
  PREVIOUS: [],
  VOLUME: ["volume_percent"],
  STATE: []
};

const SPOTIFY_URI = /^spotify:(?:track|artist|album|playlist):[A-Za-z0-9]{22}$/u;
const RESULT_KEY: Readonly<Record<SpotifySearchType, string>> = {
  track: "tracks",
  artist: "artists",
  album: "albums",
  playlist: "playlists"
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RawResponse = { status: number; body: unknown } | { failure: SpotifyFailureCode };

export const createSpotifyApiClient = (overrides: Partial<ClientDependencies> = {}): SpotifyApiClient => {
  const dependencies: ClientDependencies = {
    fetch: (url, init) => fetch(url, init),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    setTimer: (callback, delay) => setTimeout(callback, delay),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    timeoutMs: SPOTIFY_REQUEST_TIMEOUT_MS,
    logError: (message) => console.error(message),
    ...overrides
  };

  const buildUrl = (name: EndpointName, query: Record<string, string>): string | undefined => {
    const endpoint = ENDPOINTS[name];
    const url = new URL(endpoint.path, endpoint.origin);
    for (const [key, value] of Object.entries(query)) {
      if (!QUERY_KEYS[name].includes(key)) return undefined;
      url.searchParams.set(key, value);
    }
    return url.protocol === "https:" && SPOTIFY_ALLOWED_HOSTS.has(url.host) && url.pathname === endpoint.path
      ? url.toString()
      : undefined;
  };

  const attempt = async (
    name: EndpointName,
    options: { accessToken?: string; query?: Record<string, string>; json?: unknown; form?: Record<string, string> }
  ): Promise<RawResponse & { retryAfterMs?: number }> => {
    const url = buildUrl(name, options.query ?? {});
    if (!url) return { failure: "SPOTIFY_UNEXPECTED_RESPONSE" };
    const headers: Record<string, string> = {};
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    let body: string | undefined;
    if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(options.form).toString();
    } else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    const controller = new AbortController();
    const timer = dependencies.setTimer(() => controller.abort(), dependencies.timeoutMs);
    try {
      const response = await dependencies.fetch(url, {
        method: ENDPOINTS[name].method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
        signal: controller.signal
      });
      // A redirect is never followed, so the request can never reach another host.
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        return { failure: "SPOTIFY_UNEXPECTED_RESPONSE" };
      }
      let parsed: unknown;
      if (response.status !== 204) {
        try {
          parsed = await response.json();
        } catch {
          parsed = undefined;
        }
      }
      const rawRetryAfter = response.headers.get("retry-after");
      const retryAfter = rawRetryAfter !== null && rawRetryAfter.trim() !== "" ? Number(rawRetryAfter) : Number.NaN;
      return {
        status: response.status,
        body: parsed,
        ...(Number.isFinite(retryAfter) && retryAfter >= 0 ? { retryAfterMs: Math.min(retryAfter * 1000, SPOTIFY_MAX_RETRY_AFTER_MS) } : {})
      };
    } catch {
      dependencies.logError("Spotify request failed.");
      return { failure: "SPOTIFY_NETWORK_ERROR" };
    } finally {
      dependencies.clearTimer(timer);
    }
  };

  /** One bounded retry after a 429, waiting for Retry-After (capped), then the rate-limit failure. */
  const send = async (
    name: EndpointName,
    options: Parameters<typeof attempt>[1]
  ): Promise<{ status: number; body: unknown } | { failure: SpotifyFailureCode }> => {
    let result = await attempt(name, options);
    if ("status" in result && result.status === 429) {
      await dependencies.sleep(result.retryAfterMs ?? 1_000);
      result = await attempt(name, options);
      if ("status" in result && result.status === 429) return { failure: "SPOTIFY_RATE_LIMITED" };
    }
    return result;
  };

  const errorReason = (body: unknown): { reason?: string; message?: string } => {
    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    return {
      reason: typeof error?.reason === "string" ? error.reason : undefined,
      message: typeof error?.message === "string" ? error.message : undefined
    };
  };

  const mapStatus = (name: EndpointName, status: number, body: unknown): SpotifyFailureCode => {
    if (name === "TOKEN") return status === 400 || status === 401 ? "SPOTIFY_AUTH_EXPIRED" : "SPOTIFY_UNEXPECTED_RESPONSE";
    if (status === 401) return "SPOTIFY_AUTH_EXPIRED";
    if (status === 403) {
      const { reason, message } = errorReason(body);
      if (reason === "PREMIUM_REQUIRED") return "SPOTIFY_PREMIUM_REQUIRED";
      if (reason === "NO_ACTIVE_DEVICE") return "SPOTIFY_NO_ACTIVE_DEVICE";
      return /premium/iu.test(message ?? "") ? "SPOTIFY_PREMIUM_REQUIRED" : "SPOTIFY_NOT_ALLOWLISTED";
    }
    if (status === 404 && ENDPOINTS[name].player) return "SPOTIFY_NO_ACTIVE_DEVICE";
    return "SPOTIFY_UNEXPECTED_RESPONSE";
  };

  const command = async (
    name: EndpointName,
    accessToken: string,
    options: { query?: Record<string, string>; json?: unknown } = {}
  ): Promise<SpotifyResult<null>> => {
    const result = await send(name, { accessToken, ...options });
    if ("failure" in result) return spotifyFailure(result.failure);
    return result.status >= 200 && result.status < 300 ? spotifySuccess(null) : spotifyFailure(mapStatus(name, result.status, result.body));
  };

  const parseGrant = (body: unknown): SpotifyResult<SpotifyTokenGrant> => {
    if (!isRecord(body) || typeof body.access_token !== "string" || body.access_token.length === 0) {
      return spotifyFailure("SPOTIFY_UNEXPECTED_RESPONSE");
    }
    const expires = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
    return spotifySuccess({
      accessToken: body.access_token,
      ...(typeof body.refresh_token === "string" && body.refresh_token.length > 0 ? { refreshToken: body.refresh_token } : {}),
      expiresInSeconds: expires
    });
  };

  const token = async (form: Record<string, string>): Promise<SpotifyResult<SpotifyTokenGrant>> => {
    const result = await send("TOKEN", { form });
    if ("failure" in result) return spotifyFailure(result.failure);
    return result.status === 200 ? parseGrant(result.body) : spotifyFailure(mapStatus("TOKEN", result.status, result.body));
  };

  const parseCandidates = (body: unknown, type: SpotifySearchType): SpotifyResult<SpotifySearchCandidate[]> => {
    const section = isRecord(body) ? body[RESULT_KEY[type]] : undefined;
    if (!isRecord(section) || !Array.isArray(section.items)) return spotifyFailure("SPOTIFY_UNEXPECTED_RESPONSE");
    const candidates: SpotifySearchCandidate[] = [];
    for (const item of section.items) {
      // Playlist results may contain null entries; anything without a well-formed URI and name is skipped.
      if (!isRecord(item) || typeof item.uri !== "string" || !SPOTIFY_URI.test(item.uri) || typeof item.name !== "string") continue;
      const artists = Array.isArray(item.artists) ? item.artists : [];
      const first = artists.find((artist): artist is Record<string, unknown> => isRecord(artist) && typeof artist.name === "string");
      candidates.push({ uri: item.uri, name: item.name, ...(first ? { artist: first.name as string } : {}) });
    }
    return spotifySuccess(candidates);
  };

  return {
    exchangeCode: ({ clientId, code, verifier }) =>
      token({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier
      }),
    refresh: ({ clientId, refreshToken }) =>
      token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
    search: async (accessToken, query, type) => {
      const result = await send("SEARCH", { accessToken, query: { q: query, type, limit: String(SPOTIFY_SEARCH_LIMIT) } });
      if ("failure" in result) return spotifyFailure(result.failure);
      return result.status === 200 ? parseCandidates(result.body, type) : spotifyFailure(mapStatus("SEARCH", result.status, result.body));
    },
    play: (accessToken, target) =>
      command("PLAY", accessToken, {
        ...(target === undefined ? {} : { json: target.type === "track" ? { uris: [target.uri] } : { context_uri: target.uri } })
      }),
    pause: (accessToken) => command("PAUSE", accessToken),
    next: (accessToken) => command("NEXT", accessToken),
    previous: (accessToken) => command("PREVIOUS", accessToken),
    setVolume: (accessToken, percent) =>
      Number.isInteger(percent) && percent >= 0 && percent <= 100
        ? command("VOLUME", accessToken, { query: { volume_percent: String(percent) } })
        : Promise.resolve(spotifyFailure("SPOTIFY_INVALID_REQUEST")),
    getPlayback: async (accessToken) => {
      const result = await send("STATE", { accessToken });
      if ("failure" in result) return spotifyFailure(result.failure);
      // 204 means there is no active playback device.
      if (result.status === 204) return spotifySuccess(null);
      if (result.status !== 200) return spotifyFailure(mapStatus("STATE", result.status, result.body));
      const body = result.body;
      if (!isRecord(body)) return spotifyFailure("SPOTIFY_UNEXPECTED_RESPONSE");
      const item = isRecord(body.item) ? body.item : undefined;
      const artists = item && Array.isArray(item.artists) ? item.artists : [];
      const artist = artists.find((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.name === "string");
      const device = isRecord(body.device) ? body.device : undefined;
      return spotifySuccess({
        isPlaying: body.is_playing === true,
        ...(typeof item?.name === "string" ? { title: item.name } : {}),
        ...(artist ? { artist: artist.name as string } : {}),
        ...(typeof device?.volume_percent === "number" ? { volumePercent: device.volume_percent } : {})
      });
    }
  };
};
