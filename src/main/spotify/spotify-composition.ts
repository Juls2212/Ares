import { safeStorage } from "electron";
import { createSpotifyApiClient } from "./spotify-api-client";
import { createSpotifyAuthService, type SpotifyAuthService } from "./spotify-auth-service";
import { createSpotifyAuthorizeLauncher } from "./spotify-authorize-launcher";
import { getSpotifyClientId } from "./spotify-config";
import { createSpotifyLoopbackServer } from "./spotify-loopback-server";
import { createSpotifyPlaybackService, type SpotifyPlaybackService } from "./spotify-playback-service";
import { createSpotifyConnectionRepository, createSpotifyTokenStore } from "./spotify-token-store";

let authService: SpotifyAuthService | undefined;
let playbackService: SpotifyPlaybackService | undefined;

const client = createSpotifyApiClient();

export const getSpotifyAuthService = (): SpotifyAuthService => {
  authService ??= createSpotifyAuthService({
    getClientId: () => getSpotifyClientId(),
    store: createSpotifyTokenStore({
      storage: safeStorage,
      repository: createSpotifyConnectionRepository(),
      logError: (message) => console.error(message)
    }),
    client,
    loopback: createSpotifyLoopbackServer(),
    launcher: createSpotifyAuthorizeLauncher()
  });
  return authService;
};

export const getSpotifyPlaybackService = (): SpotifyPlaybackService => {
  playbackService ??= createSpotifyPlaybackService({ auth: getSpotifyAuthService(), client });
  return playbackService;
};

/** Cancels a connection that is still waiting for the browser when the application quits. */
export const shutdownSpotify = (): void => {
  authService?.shutdown();
};
