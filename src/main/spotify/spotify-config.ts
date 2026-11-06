import dotenv from "dotenv";

/** Fixed values of the Spotify integration. Nothing here comes from voice, the model or the renderer. */
export const SPOTIFY_LOOPBACK_HOST = "127.0.0.1";
export const SPOTIFY_LOOPBACK_PORT = 8888;
export const SPOTIFY_CALLBACK_PATH = "/callback";
export const SPOTIFY_REDIRECT_URI = `http://${SPOTIFY_LOOPBACK_HOST}:${SPOTIFY_LOOPBACK_PORT}${SPOTIFY_CALLBACK_PATH}`;

/** Playback state and playback control only: no library, playlist, profile or email access. */
export const SPOTIFY_SCOPES = ["user-read-playback-state", "user-modify-playback-state"] as const;
export const SPOTIFY_SCOPE_PARAMETER = SPOTIFY_SCOPES.join(" ");

export const SPOTIFY_ACCOUNTS_ORIGIN = "https://accounts.spotify.com";
export const SPOTIFY_API_ORIGIN = "https://api.spotify.com";
export const SPOTIFY_AUTHORIZE_PATH = "/authorize";
export const SPOTIFY_TOKEN_PATH = "/api/token";
export const SPOTIFY_ALLOWED_HOSTS: ReadonlySet<string> = new Set(["accounts.spotify.com", "api.spotify.com"]);

export const SPOTIFY_CLIENT_ID_PATTERN = /^[A-Za-z0-9]{16,64}$/u;

/**
 * Reads the public Client ID from the environment only when Main needs it. The value is never logged,
 * stored or returned to another process; an unusable value is reported as «not configured».
 */
export const getSpotifyClientId = (environment: NodeJS.ProcessEnv = process.env): string | undefined => {
  if (environment === process.env) dotenv.config({ quiet: true });
  const value = environment.SPOTIFY_CLIENT_ID?.trim();
  return value && SPOTIFY_CLIENT_ID_PATTERN.test(value) ? value : undefined;
};
