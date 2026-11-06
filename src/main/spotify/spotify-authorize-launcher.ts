import { shell } from "electron";
import {
  SPOTIFY_ACCOUNTS_ORIGIN,
  SPOTIFY_AUTHORIZE_PATH,
  SPOTIFY_CLIENT_ID_PATTERN,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPE_PARAMETER
} from "./spotify-config";

/**
 * The only module of the Spotify integration that may hand a link to the operating system. It composes the
 * fixed authorization URL from the Client ID, the PKCE challenge and the state, validates it against an exact
 * allowlist of host, path and parameter names, and opens it in the default browser.
 */
const PARAMETER_ORDER = [
  "client_id",
  "response_type",
  "redirect_uri",
  "code_challenge_method",
  "code_challenge",
  "state",
  "scope"
] as const;

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;

export type AuthorizeParameters = { clientId: string; challenge: string; state: string };

export const buildAuthorizeUrl = ({ clientId, challenge, state }: AuthorizeParameters): string => {
  const url = new URL(SPOTIFY_AUTHORIZE_PATH, SPOTIFY_ACCOUNTS_ORIGIN);
  const values: Record<(typeof PARAMETER_ORDER)[number], string> = {
    client_id: clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPE_PARAMETER
  };
  for (const name of PARAMETER_ORDER) url.searchParams.set(name, values[name]);
  return url.toString();
};

/** Exact allowlist: fixed host and path, exactly the seven fixed parameter names once each, fixed values. */
export const isAllowedAuthorizeUrl = (candidate: string): boolean => {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.host !== "accounts.spotify.com" || url.pathname !== SPOTIFY_AUTHORIZE_PATH) return false;
  if (url.hash !== "" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  const names = [...url.searchParams.keys()];
  if (names.length !== PARAMETER_ORDER.length || !PARAMETER_ORDER.every((name) => names.filter((entry) => entry === name).length === 1)) {
    return false;
  }
  const get = (name: string): string => url.searchParams.get(name) ?? "";
  return (
    SPOTIFY_CLIENT_ID_PATTERN.test(get("client_id")) &&
    get("response_type") === "code" &&
    get("redirect_uri") === SPOTIFY_REDIRECT_URI &&
    get("code_challenge_method") === "S256" &&
    CHALLENGE_PATTERN.test(get("code_challenge")) &&
    STATE_PATTERN.test(get("state")) &&
    get("scope") === SPOTIFY_SCOPE_PARAMETER
  );
};

export type SpotifyAuthorizeLauncher = {
  /** Resolves to false when the link is not allowed or the browser could not be opened. */
  open: (parameters: AuthorizeParameters) => Promise<boolean>;
};

type LauncherDependencies = {
  openExternal: (url: string) => Promise<void>;
  logError: (message: string) => void;
};

export const createSpotifyAuthorizeLauncher = (overrides: Partial<LauncherDependencies> = {}): SpotifyAuthorizeLauncher => {
  const dependencies: LauncherDependencies = {
    openExternal: (url) => shell.openExternal(url),
    logError: (message) => console.error(message),
    ...overrides
  };
  return {
    open: async (parameters) => {
      const url = buildAuthorizeUrl(parameters);
      if (!isAllowedAuthorizeUrl(url)) return false;
      try {
        await dependencies.openExternal(url);
        return true;
      } catch {
        dependencies.logError("Spotify authorization page could not be opened.");
        return false;
      }
    }
  };
};
