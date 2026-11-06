import type { ActionSubmission } from "../../../shared/action-contracts";
import type { AssistantInterpretation } from "../../../shared/assistant-contracts";

export type ResponseArea = "APPLICATIONS" | "FILES" | "MUSIC" | "MESSAGING" | "WEB";

/** The only text a context chip can show: a fixed Spanish label per area, never data from the request. */
export const RESPONSE_AREA_LABELS: Readonly<Record<ResponseArea, string>> = {
  APPLICATIONS: "Aplicaciones",
  FILES: "Archivos",
  MUSIC: "Música",
  MESSAGING: "Mensajes",
  WEB: "Web"
};

type ActionName = ActionSubmission["action"];

/** Closed mapping from action names to the area that handles them; actions outside it have no chip. */
const ACTION_AREAS: Partial<Record<ActionName, ResponseArea>> = {
  OPEN_APPLICATION: "APPLICATIONS",
  REGISTER_CATALOG_APPLICATION: "APPLICATIONS",
  REQUEST_CUSTOM_APPLICATION_REGISTRATION: "APPLICATIONS",
  SEARCH_FILES: "FILES",
  REVEAL_FOUND_FILE: "FILES",
  OPEN_FOUND_FILE: "FILES",
  RENAME_FOUND_ITEM: "FILES",
  MOVE_FOUND_ITEMS: "FILES",
  ORGANIZE_FOUND_ITEMS: "FILES",
  DELETE_FOUND_ITEM: "FILES",
  CREATE_FOLDER: "FILES",
  RENAME_FILE: "FILES",
  RENAME_FOLDER: "FILES",
  MOVE_FILE: "FILES",
  ORGANIZE_FILES: "FILES",
  SEARCH_SPOTIFY_APP: "MUSIC",
  CONNECT_SPOTIFY: "MUSIC",
  DISCONNECT_SPOTIFY: "MUSIC",
  GET_SPOTIFY_STATUS: "MUSIC",
  PLAY_SPOTIFY_MUSIC: "MUSIC",
  PAUSE_SPOTIFY: "MUSIC",
  RESUME_SPOTIFY: "MUSIC",
  NEXT_SPOTIFY_TRACK: "MUSIC",
  PREVIOUS_SPOTIFY_TRACK: "MUSIC",
  SET_SPOTIFY_VOLUME: "MUSIC",
  WHAT_IS_PLAYING: "MUSIC",
  SAVE_CONTACT: "MESSAGING",
  LIST_CONTACTS: "MESSAGING",
  DELETE_CONTACT: "MESSAGING",
  PREPARE_MESSAGE_DRAFT: "MESSAGING",
  EDIT_MESSAGE_DRAFT: "MESSAGING",
  DISCARD_MESSAGE_DRAFT: "MESSAGING",
  OPEN_WHATSAPP_CHAT_WITH_DRAFT: "MESSAGING",
  OPEN_APPROVED_PAGE: "WEB",
  SEARCH_APPROVED_SITE: "WEB",
  OPEN_WEB_PAGE: "WEB"
};

/**
 * The area that handled the interpretation, read only from the already-typed action names. It is undefined
 * when there are no drafts, when an action has no area, or when the drafts span more than one area.
 */
export const responseAreaFor = (interpretation: AssistantInterpretation | undefined): ResponseArea | undefined => {
  const areas = new Set(interpretation?.drafts.map((draft) => ACTION_AREAS[draft.action]));
  if (areas.size !== 1) return undefined;
  const [area] = [...areas];
  return area;
};

export const responseAreaLabel = (interpretation: AssistantInterpretation | undefined): string | undefined => {
  const area = responseAreaFor(interpretation);
  return area ? RESPONSE_AREA_LABELS[area] : undefined;
};
