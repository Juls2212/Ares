import type { ActionOutcome, ActionPolicy, SpotifyMusicActionProposal } from "../../shared/action-contracts";
import { getSpotifyAuthService, getSpotifyPlaybackService } from "../spotify/spotify-composition";
import type { SpotifyAuthService } from "../spotify/spotify-auth-service";
import {
  SPOTIFY_EXECUTION_FAILURE_CODES,
  SPOTIFY_FAILURES,
  type SpotifyFailureCode
} from "../spotify/spotify-failures";
import type { SpotifyPlaybackService } from "../spotify/spotify-playback-service";

export type SpotifyActionExecutor = {
  execute: (proposal: SpotifyMusicActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type Dependencies = {
  auth?: SpotifyAuthService;
  playback?: SpotifyPlaybackService;
  logError: (message: string) => void;
};

const named = (title: string, artist?: string): string => `«${title}»${artist ? ` de ${artist}` : ""}`;

/**
 * Runs the Spotify actions through the Main-only services. The text may name the track and artist, each
 * limited and sanitized to 60 characters by the playback service; it never contains a token, a URL, a Spotify
 * identifier or a response body.
 */
export const createSpotifyActionExecutor = (overrides: Partial<Dependencies> = {}): SpotifyActionExecutor => {
  const logError = overrides.logError ?? ((message: string) => console.error(message));
  const auth = (): SpotifyAuthService => overrides.auth ?? getSpotifyAuthService();
  const playback = (): SpotifyPlaybackService => overrides.playback ?? getSpotifyPlaybackService();

  const failure = (proposal: SpotifyMusicActionProposal, policy: ActionPolicy, code: SpotifyFailureCode): ActionOutcome => ({
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: code === "SPOTIFY_CONNECT_CANCELLED"
      ? "CANCELLED"
      : SPOTIFY_EXECUTION_FAILURE_CODES.includes(code) ? "EXECUTION_FAILED" : "VALIDATION_FAILED",
    errorCode: code,
    userSummary: SPOTIFY_FAILURES[code]
  });

  const success = (proposal: SpotifyMusicActionProposal, policy: ActionPolicy, userSummary: string): ActionOutcome => ({
    actionId: proposal.actionId,
    action: proposal.action,
    riskLevel: policy.riskLevel,
    status: "SUCCEEDED",
    userSummary
  });

  return {
    execute: async (proposal, policy) => {
      try {
        switch (proposal.action) {
          case "CONNECT_SPOTIFY": {
            const result = await auth().connect();
            return result.ok ? success(proposal, policy, "Spotify quedó conectado.") : failure(proposal, policy, result.error.code);
          }
          case "DISCONNECT_SPOTIFY": {
            await auth().disconnect();
            return success(proposal, policy, "Desconecté Spotify.");
          }
          case "GET_SPOTIFY_STATUS": {
            const status = await auth().getStatus();
            return success(
              proposal,
              policy,
              status.connected
                ? "Spotify está conectado."
                : status.configured ? "Spotify no está conectado." : SPOTIFY_FAILURES.SPOTIFY_NOT_CONFIGURED
            );
          }
          case "PLAY_SPOTIFY_MUSIC": {
            const result = await playback().playByQuery(proposal.input.query, proposal.input.kind);
            return result.ok
              ? success(proposal, policy, `Reproduciendo ${named(result.data.title, result.data.artist)}.`)
              : failure(proposal, policy, result.error.code);
          }
          case "PAUSE_SPOTIFY":
          case "RESUME_SPOTIFY":
          case "NEXT_SPOTIFY_TRACK":
          case "PREVIOUS_SPOTIFY_TRACK": {
            const service = playback();
            const result = await (proposal.action === "PAUSE_SPOTIFY" ? service.pause()
              : proposal.action === "RESUME_SPOTIFY" ? service.resume()
              : proposal.action === "NEXT_SPOTIFY_TRACK" ? service.next()
              : service.previous());
            if (!result.ok) return failure(proposal, policy, result.error.code);
            return success(
              proposal,
              policy,
              proposal.action === "PAUSE_SPOTIFY" ? "Pausé la música."
                : proposal.action === "RESUME_SPOTIFY" ? "Sigo con la música."
                : proposal.action === "NEXT_SPOTIFY_TRACK" ? "Pasé a la siguiente canción."
                : "Volví a la canción anterior."
            );
          }
          case "SET_SPOTIFY_VOLUME": {
            const result = await playback().setVolume(proposal.input);
            return result.ok ? success(proposal, policy, `Volumen en ${result.data.level}.`) : failure(proposal, policy, result.error.code);
          }
          case "WHAT_IS_PLAYING": {
            const result = await playback().whatIsPlaying();
            if (!result.ok) return failure(proposal, policy, result.error.code);
            const { state, title, artist } = result.data;
            return success(
              proposal,
              policy,
              state === "NONE" || !title
                ? "No hay nada sonando en Spotify."
                : state === "PLAYING" ? `Está sonando ${named(title, artist)}.` : `En pausa: ${named(title, artist)}.`
            );
          }
          default:
            return failure(proposal, policy, "SPOTIFY_INVALID_REQUEST");
        }
      } catch {
        logError("Spotify action execution failed.");
        return failure(proposal, policy, "SPOTIFY_UNEXPECTED_RESPONSE");
      }
    }
  };
};
