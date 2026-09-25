import type { ActionSubmission } from "../../shared/action-contracts";
import type { RegisterableCatalogApplication } from "../../shared/application-contracts";
import type { VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import type { ParticleOrbState } from "../components/particle-orb";

export type Destination = "ARES" | "CALENDAR";
export type VoiceState = "IDLE" | "RECORDING" | "PROCESSING";

export const actionLabels: Record<ActionSubmission["action"], string> = {
  CREATE_TASK: "Crear tarea",
  UPDATE_TASK: "Actualizar tarea",
  COMPLETE_TASK: "Completar tarea",
  CREATE_EVENT: "Crear evento",
  UPDATE_EVENT: "Actualizar evento",
  CREATE_REMINDER: "Crear recordatorio",
  GET_TODAY_SCHEDULE: "Consultar agenda de hoy",
  GET_WEEK_SCHEDULE: "Consultar agenda semanal",
  OPEN_APPLICATION: "Abrir aplicación registrada",
  OPEN_WEB_PAGE: "Abrir página web autorizada",
  SEARCH_FILES: "Buscar archivos",
  CREATE_FOLDER: "Crear carpeta",
  RENAME_FILE: "Renombrar archivo",
  RENAME_FOLDER: "Renombrar carpeta",
  MOVE_FILE: "Mover archivo",
  ORGANIZE_FILES: "Organizar archivos"
};

export const catalogApplicationLabels: Record<RegisterableCatalogApplication, string> = {
  GOOGLE_CHROME: "Google Chrome",
  VISUAL_STUDIO_CODE: "Visual Studio Code",
  VISUAL_STUDIO: "Visual Studio",
  SPOTIFY: "Spotify"
};

export const voiceShortcutStatusLabels: Record<VoiceShortcutEffectiveStatus, string> = {
  ACTIVE: "Atajo activo",
  DISABLED: "Atajo desactivado",
  UNAVAILABLE: "Atajo no disponible"
};

export const orbStateFor = (voiceState: VoiceState, isInterpreting: boolean): ParticleOrbState => {
  if (isInterpreting) return "interpreting";
  if (voiceState === "RECORDING") return "recording";
  if (voiceState === "PROCESSING") return "transcribing";
  return "idle";
};

export const voiceLabelFor = (voiceState: VoiceState, isInterpreting: boolean): string => {
  if (isInterpreting) return "Interpretando";
  if (voiceState === "RECORDING") return "Grabando";
  if (voiceState === "PROCESSING") return "Transcribiendo";
  return "En espera";
};
