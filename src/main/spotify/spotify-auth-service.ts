import type { SpotifyApiClient, SpotifyTokenGrant } from "./spotify-api-client";
import type { SpotifyAuthorizeLauncher } from "./spotify-authorize-launcher";
import { spotifyFailure, spotifySuccess, type SpotifyResult } from "./spotify-failures";
import type { SpotifyLoopbackServer } from "./spotify-loopback-server";
import { generateAuthorizationState, generatePkcePair, type PkcePair } from "./spotify-pkce";
import type { SpotifyTokenStore, SpotifyTokens } from "./spotify-token-store";

/** Refresh this long before the access token expires. */
export const SPOTIFY_REFRESH_MARGIN_MS = 60_000;

export type SpotifyAuthStatus = { configured: boolean; connected: boolean };

export type SpotifyAuthService = {
  /** Runs the whole PKCE flow: loopback receiver, browser, code exchange and encrypted storage. */
  connect: () => Promise<SpotifyResult<null>>;
  /** Clears the stored tokens. */
  disconnect: () => Promise<SpotifyResult<null>>;
  /** Answered from local state only; no network request is made. */
  getStatus: () => Promise<SpotifyAuthStatus>;
  /** A valid access token, refreshed first when it is about to expire. */
  getAccessToken: () => Promise<SpotifyResult<string>>;
  /** A new access token after the API answered 401. */
  refreshAfterUnauthorized: () => Promise<SpotifyResult<string>>;
  /** Cancels a connection that is waiting for the browser; used when the application quits. */
  shutdown: () => void;
};

type AuthDependencies = {
  getClientId: () => string | undefined;
  store: SpotifyTokenStore;
  client: Pick<SpotifyApiClient, "exchangeCode" | "refresh">;
  loopback: SpotifyLoopbackServer;
  launcher: SpotifyAuthorizeLauncher;
  generatePkce: () => PkcePair;
  generateState: () => string;
  now: () => number;
};

export const createSpotifyAuthService = (
  overrides: Pick<AuthDependencies, "getClientId" | "store" | "client" | "loopback" | "launcher"> & Partial<AuthDependencies>
): SpotifyAuthService => {
  const dependencies: AuthDependencies = {
    generatePkce: () => generatePkcePair(),
    generateState: () => generateAuthorizationState(),
    now: () => Date.now(),
    ...overrides
  };
  let connecting: Promise<SpotifyResult<null>> | undefined;
  let refreshing: Promise<SpotifyResult<string>> | undefined;

  const toTokens = (grant: SpotifyTokenGrant, previousRefreshToken?: string): SpotifyResult<SpotifyTokens> => {
    const refreshToken = grant.refreshToken ?? previousRefreshToken;
    return refreshToken
      ? spotifySuccess({
          accessToken: grant.accessToken,
          refreshToken,
          expiresAt: dependencies.now() + grant.expiresInSeconds * 1000
        })
      : spotifyFailure("SPOTIFY_UNEXPECTED_RESPONSE");
  };

  const runConnect = async (): Promise<SpotifyResult<null>> => {
    const clientId = dependencies.getClientId();
    if (!clientId) return spotifyFailure("SPOTIFY_NOT_CONFIGURED");
    // Nothing is opened or exchanged when the result could not be stored securely.
    if (!dependencies.store.canStore()) return spotifyFailure("SPOTIFY_SECURE_STORAGE_UNAVAILABLE");

    const { verifier, challenge } = dependencies.generatePkce();
    const state = dependencies.generateState();
    const started = await dependencies.loopback.start(state);
    if (!started.ok) return spotifyFailure(started.reason === "PORT_BUSY" ? "SPOTIFY_CONNECT_PORT_BUSY" : "SPOTIFY_NETWORK_ERROR");
    if (!(await dependencies.launcher.open({ clientId, challenge, state }))) {
      dependencies.loopback.cancel();
      await started.outcome;
      return spotifyFailure("SPOTIFY_BROWSER_UNAVAILABLE");
    }

    const outcome = await started.outcome;
    if (outcome.status === "TIMEOUT") return spotifyFailure("SPOTIFY_CONNECT_TIMEOUT");
    if (outcome.status !== "CODE") return spotifyFailure("SPOTIFY_CONNECT_CANCELLED");

    const grant = await dependencies.client.exchangeCode({ clientId, code: outcome.code, verifier });
    if (!grant.ok) return grant;
    const tokens = toTokens(grant.data);
    if (!tokens.ok) return tokens;
    return dependencies.store.save(tokens.data);
  };

  const runRefresh = async (): Promise<SpotifyResult<string>> => {
      {
        const clientId = dependencies.getClientId();
        if (!clientId) return spotifyFailure("SPOTIFY_NOT_CONFIGURED");
        const loaded = await dependencies.store.load();
        if (!loaded.ok) return loaded;
        if (!loaded.data) return spotifyFailure("SPOTIFY_NOT_CONNECTED");
        const grant = await dependencies.client.refresh({ clientId, refreshToken: loaded.data.refreshToken });
        if (!grant.ok) {
          // A rejected refresh token means the connection is gone: forget it and ask to connect again.
          if (grant.error.code === "SPOTIFY_AUTH_EXPIRED") await dependencies.store.clear();
          return grant;
        }
        const tokens = toTokens(grant.data, loaded.data.refreshToken);
        if (!tokens.ok) return tokens;
        const saved = await dependencies.store.save(tokens.data);
        return saved.ok ? spotifySuccess(tokens.data.accessToken) : saved;
      }
  };

  const refresh = (): Promise<SpotifyResult<string>> => {
    refreshing ??= runRefresh().finally(() => { refreshing = undefined; });
    return refreshing;
  };

  return {
    connect: () => {
      connecting ??= runConnect().finally(() => { connecting = undefined; });
      return connecting;
    },
    disconnect: async () => {
      dependencies.loopback.cancel();
      await dependencies.store.clear();
      return spotifySuccess(null);
    },
    getStatus: async () => {
      const configured = dependencies.getClientId() !== undefined;
      const loaded = await dependencies.store.load();
      return { configured, connected: loaded.ok && loaded.data !== undefined };
    },
    getAccessToken: async () => {
      const loaded = await dependencies.store.load();
      if (!loaded.ok) return loaded;
      if (!loaded.data) return spotifyFailure("SPOTIFY_NOT_CONNECTED");
      if (loaded.data.expiresAt - dependencies.now() > SPOTIFY_REFRESH_MARGIN_MS) return spotifySuccess(loaded.data.accessToken);
      return refresh();
    },
    refreshAfterUnauthorized: () => refresh(),
    shutdown: () => dependencies.loopback.cancel()
  };
};
