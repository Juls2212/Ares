/**
 * Closed failure taxonomy for the Spotify Web API integration. Every message is a fixed Spanish sentence: it
 * never contains a token, an authorization code, a URL, a response body, a status text or a raw exception.
 */
export const SPOTIFY_FAILURES = {
  SPOTIFY_NOT_CONNECTED: "Spotify no está conectado. Di «conecta Spotify» para conectarlo.",
  SPOTIFY_NOT_CONFIGURED: "La conexión con Spotify no está configurada en este equipo.",
  SPOTIFY_AUTH_EXPIRED: "La conexión con Spotify caducó. Di «conecta Spotify» para conectarla de nuevo.",
  SPOTIFY_PREMIUM_REQUIRED: "Controlar la reproducción requiere Spotify Premium.",
  SPOTIFY_NOT_ALLOWLISTED:
    "Esta cuenta de Spotify no está autorizada para la app de Ares. Agrégala en el panel de desarrolladores de Spotify.",
  SPOTIFY_NO_ACTIVE_DEVICE: "Abre Spotify en tu computador y vuelve a intentarlo.",
  SPOTIFY_NO_RESULTS: "No encontré resultados en Spotify para esa búsqueda.",
  SPOTIFY_RATE_LIMITED: "Spotify está recibiendo muchas solicitudes. Intenta de nuevo en un momento.",
  SPOTIFY_NETWORK_ERROR: "No pude comunicarme con Spotify. Revisa tu conexión e inténtalo de nuevo.",
  SPOTIFY_UNEXPECTED_RESPONSE: "Spotify respondió algo inesperado. Inténtalo de nuevo.",
  SPOTIFY_CONNECT_CANCELLED: "Se canceló la conexión con Spotify.",
  SPOTIFY_CONNECT_TIMEOUT: "La conexión con Spotify tardó demasiado y se canceló. Inténtalo de nuevo.",
  SPOTIFY_CONNECT_PORT_BUSY: "No pude iniciar la conexión con Spotify porque el puerto local 8888 está ocupado.",
  SPOTIFY_BROWSER_UNAVAILABLE: "No pude abrir el navegador para conectar Spotify.",
  SPOTIFY_SECURE_STORAGE_UNAVAILABLE:
    "Este equipo no permite guardar la conexión de Spotify de forma segura, así que no la guardaré.",
  SPOTIFY_INVALID_REQUEST: "Indica qué quieres que reproduzca, o un volumen entre 0 y 100."
} as const;

export type SpotifyFailureCode = keyof typeof SPOTIFY_FAILURES;

/** Failures caused by the system or the network rather than by what the person asked for. */
export const SPOTIFY_EXECUTION_FAILURE_CODES: readonly string[] = [
  "SPOTIFY_RATE_LIMITED",
  "SPOTIFY_NETWORK_ERROR",
  "SPOTIFY_UNEXPECTED_RESPONSE",
  "SPOTIFY_CONNECT_TIMEOUT",
  "SPOTIFY_CONNECT_PORT_BUSY",
  "SPOTIFY_BROWSER_UNAVAILABLE"
];

export type SpotifyFailure = { ok: false; error: { code: SpotifyFailureCode; userMessage: string } };
export type SpotifyResult<T> = { ok: true; data: T } | SpotifyFailure;

export const spotifyFailure = (code: SpotifyFailureCode): SpotifyFailure => ({
  ok: false,
  error: { code, userMessage: SPOTIFY_FAILURES[code] }
});

export const spotifySuccess = <T>(data: T): SpotifyResult<T> => ({ ok: true, data });
