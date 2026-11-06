import type { SpotifySearchKind } from "../../shared/action-contracts";
import { normalizeApplicationAlias } from "../applications/known-application-catalog";
import { validateSpotifySearchQuery } from "../applications/spotify-search";
import type {
  SpotifyApiClient,
  SpotifyPlaybackState,
  SpotifySearchCandidate,
  SpotifySearchType
} from "./spotify-api-client";
import type { SpotifyAuthService } from "./spotify-auth-service";
import { spotifyFailure, spotifySuccess, type SpotifyResult } from "./spotify-failures";

/** Relative volume changes are computed in Main from the current state with this bounded step. */
export const SPOTIFY_VOLUME_STEP = 10;
const MAX_DISPLAY_LENGTH = 60;

const TYPE_BY_KIND: Readonly<Record<SpotifySearchKind, SpotifySearchType>> = {
  TRACK: "track",
  ARTIST: "artist",
  ALBUM: "album",
  PLAYLIST: "playlist",
  ANY: "track"
};

/** Text that came from Spotify is shown and spoken only after control characters and quote marks are removed. */
export const toDisplayText = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const text = value.replace(/[\p{C}«»]/gu, "").replace(/\s+/gu, " ").trim().slice(0, MAX_DISPLAY_LENGTH).trim();
  return text.length > 0 ? text : undefined;
};

export type PlayedItem = { title: string; artist?: string };
export type NowPlaying = { state: "PLAYING" | "PAUSED" | "NONE"; title?: string; artist?: string };

export type SpotifyPlaybackService = {
  playByQuery: (query: unknown, kind: unknown) => Promise<SpotifyResult<PlayedItem>>;
  pause: () => Promise<SpotifyResult<null>>;
  resume: () => Promise<SpotifyResult<null>>;
  next: () => Promise<SpotifyResult<null>>;
  previous: () => Promise<SpotifyResult<null>>;
  setVolume: (input: unknown) => Promise<SpotifyResult<{ level: number }>>;
  whatIsPlaying: () => Promise<SpotifyResult<NowPlaying>>;
};

/**
 * Deterministic ranking in Main: a normalized exact match on the name first, otherwise Spotify's first
 * result. The chosen Spotify URI comes from the API response, never from the person or the model.
 */
export const rankCandidates = (query: string, candidates: readonly SpotifySearchCandidate[]): SpotifySearchCandidate | undefined => {
  const wanted = normalizeApplicationAlias(query);
  return candidates.find((candidate) => normalizeApplicationAlias(candidate.name) === wanted) ?? candidates[0];
};

export const createSpotifyPlaybackService = (dependencies: {
  auth: Pick<SpotifyAuthService, "getAccessToken" | "refreshAfterUnauthorized">;
  client: SpotifyApiClient;
}): SpotifyPlaybackService => {
  const { auth, client } = dependencies;

  /** Runs an API operation with a valid token and retries once with a refreshed token after a 401. */
  const withToken = async <T>(operation: (accessToken: string) => Promise<SpotifyResult<T>>): Promise<SpotifyResult<T>> => {
    const token = await auth.getAccessToken();
    if (!token.ok) return token;
    const first = await operation(token.data);
    if (first.ok || first.error.code !== "SPOTIFY_AUTH_EXPIRED") return first;
    const refreshed = await auth.refreshAfterUnauthorized();
    return refreshed.ok ? operation(refreshed.data) : refreshed;
  };

  const command = (run: (accessToken: string) => Promise<SpotifyResult<null>>) => (): Promise<SpotifyResult<null>> => withToken(run);

  return {
    playByQuery: async (query, kind) => {
      const validated = validateSpotifySearchQuery(query);
      const searchKind: SpotifySearchKind = kind === undefined ? "ANY" : (kind as SpotifySearchKind);
      if (!validated || !(searchKind in TYPE_BY_KIND)) return spotifyFailure("SPOTIFY_INVALID_REQUEST");
      const type = TYPE_BY_KIND[searchKind];
      return withToken(async (accessToken) => {
        const found = await client.search(accessToken, validated, type);
        if (!found.ok) return found;
        const chosen = rankCandidates(validated, found.data);
        if (!chosen) return spotifyFailure("SPOTIFY_NO_RESULTS");
        const started = await client.play(accessToken, { type: type === "track" ? "track" : "context", uri: chosen.uri });
        if (!started.ok) return started;
        const title = toDisplayText(chosen.name);
        return title ? spotifySuccess({ title, ...(toDisplayText(chosen.artist) ? { artist: toDisplayText(chosen.artist) as string } : {}) }) : spotifyFailure("SPOTIFY_UNEXPECTED_RESPONSE");
      });
    },
    pause: command((accessToken) => client.pause(accessToken)),
    resume: command((accessToken) => client.play(accessToken)),
    next: command((accessToken) => client.next(accessToken)),
    previous: command((accessToken) => client.previous(accessToken)),
    setVolume: async (input) => {
      const request = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      const keys = Object.keys(request);
      if (keys.length !== 1) return spotifyFailure("SPOTIFY_INVALID_REQUEST");
      if (keys[0] === "level") {
        const level = request.level;
        if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100) return spotifyFailure("SPOTIFY_INVALID_REQUEST");
        const set = await withToken((accessToken) => client.setVolume(accessToken, level));
        return set.ok ? spotifySuccess({ level }) : set;
      }
      if (keys[0] !== "change" || (request.change !== "UP" && request.change !== "DOWN")) return spotifyFailure("SPOTIFY_INVALID_REQUEST");
      const direction = request.change === "UP" ? 1 : -1;
      return withToken(async (accessToken) => {
        const state = await client.getPlayback(accessToken);
        if (!state.ok) return state;
        if (state.data === null) return spotifyFailure("SPOTIFY_NO_ACTIVE_DEVICE");
        if (state.data.volumePercent === undefined) return spotifyFailure("SPOTIFY_UNEXPECTED_RESPONSE");
        const level = Math.max(0, Math.min(100, Math.round(state.data.volumePercent) + direction * SPOTIFY_VOLUME_STEP));
        const set = await client.setVolume(accessToken, level);
        return set.ok ? spotifySuccess({ level }) : set;
      });
    },
    whatIsPlaying: () =>
      withToken(async (accessToken): Promise<SpotifyResult<NowPlaying>> => {
        const state: SpotifyResult<SpotifyPlaybackState | null> = await client.getPlayback(accessToken);
        if (!state.ok) return state;
        if (state.data === null) return spotifyFailure("SPOTIFY_NO_ACTIVE_DEVICE");
        const title = toDisplayText(state.data.title);
        if (!title) return spotifySuccess({ state: "NONE" });
        const artist = toDisplayText(state.data.artist);
        return spotifySuccess({ state: state.data.isPlaying ? "PLAYING" : "PAUSED", title, ...(artist ? { artist } : {}) });
      })
  };
};
