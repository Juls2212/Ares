import type { ActionSubmission } from "../../shared/action-contracts";
import type { RegisterableCatalogApplication } from "../../shared/application-contracts";
import type { VoiceShortcutEffectiveStatus } from "../../shared/settings-contracts";
import type { OrbState } from "../components/orb-visuals";

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
  GET_WEEKLY_SCHEDULE_DETAILS: "Consultar horario semanal",
  ANALYZE_WEEKLY_SCHEDULE: "Analizar horario semanal",
  GET_TODAY_AVAILABILITY: "Consultar disponibilidad de hoy",
  CREATE_WEEKLY_SCHEDULE: "Crear horario semanal",
  UPDATE_WEEKLY_SCHEDULE: "Actualizar horario semanal",
  CREATE_WEEKLY_ROUTINE: "Crear bloque semanal",
  UPDATE_WEEKLY_ROUTINE: "Actualizar bloque semanal",
  GET_CURRENT_DATE_TIME: "Consultar fecha y hora actuales",
  GET_WEATHER: "Consultar clima de Pasto",
  GET_HABIT_PROGRESS: "Consultar progreso de hábitos",
  CREATE_HABIT: "Crear hábito",
  UPDATE_HABIT: "Actualizar hábito",
  COMPLETE_HABIT: "Completar hábito",
  OPEN_APPLICATION: "Abrir aplicación registrada",
  SEARCH_SPOTIFY_APP: "Buscar en la aplicación de Spotify",
  CONNECT_SPOTIFY: "Conectar Spotify",
  DISCONNECT_SPOTIFY: "Desconectar Spotify",
  GET_SPOTIFY_STATUS: "Consultar conexión de Spotify",
  PLAY_SPOTIFY_MUSIC: "Reproducir música en Spotify",
  PAUSE_SPOTIFY: "Pausar Spotify",
  RESUME_SPOTIFY: "Reanudar Spotify",
  NEXT_SPOTIFY_TRACK: "Siguiente canción de Spotify",
  PREVIOUS_SPOTIFY_TRACK: "Canción anterior de Spotify",
  SET_SPOTIFY_VOLUME: "Ajustar volumen de Spotify",
  WHAT_IS_PLAYING: "Consultar qué está sonando",
  REGISTER_CATALOG_APPLICATION: "Registrar aplicación aprobada",
  REQUEST_CUSTOM_APPLICATION_REGISTRATION: "Registrar aplicación propia",
  OPEN_APPROVED_PAGE: "Abrir sitio aprobado",
  SEARCH_APPROVED_SITE: "Buscar en sitio aprobado",
  OPEN_WEB_PAGE: "Abrir página web autorizada",
  SEARCH_FILES: "Buscar archivos",
  REVEAL_FOUND_FILE: "Mostrar archivo encontrado",
  OPEN_FOUND_FILE: "Abrir archivo encontrado",
  RENAME_FOUND_ITEM: "Renombrar elemento encontrado",
  MOVE_FOUND_ITEMS: "Mover elementos encontrados",
  ORGANIZE_FOUND_ITEMS: "Organizar elementos encontrados",
  DELETE_FOUND_ITEM: "Enviar a la Papelera",
  CREATE_FOLDER: "Crear carpeta",
  RENAME_FILE: "Renombrar archivo",
  RENAME_FOLDER: "Renombrar carpeta",
  MOVE_FILE: "Mover archivo",
  ORGANIZE_FILES: "Organizar archivos",
  DELETE_EVENT: "Eliminar evento",
  DELETE_TASK: "Eliminar tarea",
  SAVE_CONTACT: "Guardar contacto",
  LIST_CONTACTS: "Listar contactos",
  DELETE_CONTACT: "Eliminar contacto",
  PREPARE_MESSAGE_DRAFT: "Preparar borrador de mensaje",
  EDIT_MESSAGE_DRAFT: "Editar borrador de mensaje",
  DISCARD_MESSAGE_DRAFT: "Descartar borrador de mensaje",
  OPEN_WHATSAPP_CHAT_WITH_DRAFT: "Abrir chat de WhatsApp con el borrador"
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

export const orbStateFor = (voiceState: VoiceState, isInterpreting: boolean): OrbState => {
  if (isInterpreting) return "interpreting";
  if (voiceState === "RECORDING") return "recording";
  if (voiceState === "PROCESSING") return "transcribing";
  return "idle";
};

export const voiceLabelFor = (voiceState: VoiceState, isInterpreting: boolean): string => {
  if (isInterpreting) return "Interpretando";
  if (voiceState === "RECORDING") return "Escuchando";
  if (voiceState === "PROCESSING") return "Procesando";
  return "En espera";
};
