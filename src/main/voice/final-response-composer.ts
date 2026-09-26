import type { ActionOutcome } from "../../shared/action-contracts";

/** Fixed factual wording: no titles, paths, provider prose, or inferred dates. */
export const composeFinalResponse = (outcome: ActionOutcome): string | undefined => {
  if (outcome.status !== "SUCCEEDED") return undefined;
  const messages: Partial<Record<ActionOutcome["action"], string>> = {
    CREATE_TASK: "Listo, agregué la tarea.", UPDATE_TASK: "Listo, actualicé la tarea.",
    COMPLETE_TASK: "Listo, marqué la tarea como completada.", CREATE_EVENT: "Listo, agregué el evento.",
    UPDATE_EVENT: "Listo, actualicé el evento.", CREATE_REMINDER: "Listo, agregué el recordatorio.",
    DELETE_TASK: "Listo, eliminé la tarea.", DELETE_EVENT: "Listo, eliminé el evento.",
    OPEN_APPLICATION: "Listo, abrí la aplicación.", OPEN_WEB_PAGE: "Listo, abrí la página.",
    CREATE_FOLDER: "Listo, creé la carpeta.", RENAME_FILE: "Listo, cambié el nombre del archivo.",
    RENAME_FOLDER: "Listo, cambié el nombre de la carpeta.", MOVE_FILE: "Listo, moví el archivo."
  };
  return messages[outcome.action];
};
