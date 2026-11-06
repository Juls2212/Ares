import { normalizeApplicationAlias } from "../applications/known-application-catalog";

/**
 * Deterministic classification of the Spotify connection and playback-control phrases. It only classifies
 * text: it produces no identifier, URI or URL and never calls Spotify.
 */
export type SpotifyControlCommand =
  | { kind: "CONNECT" }
  | { kind: "DISCONNECT" }
  | { kind: "STATUS" }
  | { kind: "PAUSE" }
  | { kind: "RESUME" }
  | { kind: "NEXT" }
  | { kind: "PREVIOUS" }
  | { kind: "WHAT_IS_PLAYING" }
  | { kind: "VOLUME_CHANGE"; direction: "UP" | "DOWN" }
  | { kind: "VOLUME_LEVEL"; level: number }
  | { kind: "VOLUME_INVALID" };

const POLITE = "(?:por favor )?";

const PATTERNS: ReadonlyArray<readonly [RegExp, SpotifyControlCommand]> = [
  [new RegExp(`^${POLITE}(?:conecta|conectar|conectate|conectame|vincula|vincular|enlaza|enlazar)(?: te)?(?: a| con)?(?: mi| la)?(?: cuenta de)? spotify$`, "u"), { kind: "CONNECT" }],
  [new RegExp(`^${POLITE}(?:desconecta|desconectar|desconectate|desvincula|desvincular)(?: te)?(?: de| a)?(?: mi| la)?(?: cuenta de)? spotify$`, "u"), { kind: "DISCONNECT" }],
  [/^(?:esta )?spotify (?:esta )?conectad[oa]$|^estoy conectado a spotify$|^(?:esta )?conectado spotify$/u, { kind: "STATUS" }],
  [new RegExp(`^${POLITE}(?:pausa|pausar|pausala|pausalo|pausa la musica|pausa la cancion|pausa spotify|pon pausa|deten la musica|detener la musica|para la musica)$`, "u"), { kind: "PAUSE" }],
  [new RegExp(`^${POLITE}(?:continua|continuar|reanuda|reanudar|sigue|sigue con la musica|continua con la musica|continua la musica|reanuda la musica|reanuda spotify|dale play|play)$`, "u"), { kind: "RESUME" }],
  [new RegExp(`^${POLITE}(?:siguiente|siguiente cancion|la siguiente|proxima|proxima cancion|salta|salta la cancion|pasa a la siguiente|pasa la cancion|cambia de cancion|next)$`, "u"), { kind: "NEXT" }],
  [new RegExp(`^${POLITE}(?:anterior|cancion anterior|la anterior|vuelve a la anterior|regresa a la anterior|vuelve a la cancion anterior|previous)$`, "u"), { kind: "PREVIOUS" }],
  [/^(?:que (?:esta sonando|suena|cancion es esta|cancion esta sonando|musica es esta|estoy escuchando)|cual es esta cancion|quien canta esto|que es lo que suena)$/u, { kind: "WHAT_IS_PLAYING" }],
  [new RegExp(`^${POLITE}(?:(?:sube|subir|aumenta|aumentar) (?:el )?volumen|(?:sube|subir) la musica|mas volumen)(?: un poco| mas)?$`, "u"), { kind: "VOLUME_CHANGE", direction: "UP" }],
  [new RegExp(`^${POLITE}(?:(?:baja|bajar|disminuye|disminuir|reduce|reducir) (?:el )?volumen|(?:baja|bajar) la musica|menos volumen)(?: un poco| mas)?$`, "u"), { kind: "VOLUME_CHANGE", direction: "DOWN" }],
  [new RegExp(`^${POLITE}(?:pon|poner|ponme|ajusta|ajustar|sube|subir|baja|bajar|cambia|deja)(?: el)? volumen (?:al|a) (?:el )?maximo$`, "u"), { kind: "VOLUME_LEVEL", level: 100 }]
];

const LEVEL_PATTERN = new RegExp(
  `^${POLITE}(?:pon|poner|ponme|ajusta|ajustar|sube|subir|baja|bajar|cambia|deja)(?: el)? volumen (?:en|a|al|hasta)(?: el)? (\\d{1,4})(?: por ciento| porciento)?$`,
  "u"
);

export const parseSpotifyControlCommand = (instruction: string): SpotifyControlCommand | undefined => {
  const normalized = normalizeApplicationAlias(instruction);
  if (normalized.length === 0) return undefined;
  for (const [pattern, command] of PATTERNS) {
    if (pattern.test(normalized)) return command;
  }
  const level = normalized.match(LEVEL_PATTERN);
  if (level) {
    const value = Number(level[1]);
    return value >= 0 && value <= 100 ? { kind: "VOLUME_LEVEL", level: value } : { kind: "VOLUME_INVALID" };
  }
  return undefined;
};
