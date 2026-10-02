import type { ActionOutcome } from "../../shared/action-contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasConfirmedPlannerRecord = (outcome: ActionOutcome): boolean =>
  isRecord(outcome.data) && "record" in outcome.data && isRecord(outcome.data.record);

const hasConfirmedDeletion = (outcome: ActionOutcome): boolean =>
  isRecord(outcome.data) && "deleted" in outcome.data && outcome.data.deleted === true;

const getResolvedApplicationName = (outcome: ActionOutcome): string | undefined => {
  if (!isRecord(outcome.data) || !("applicationName" in outcome.data) || typeof outcome.data.applicationName !== "string") return undefined;
  const name = outcome.data.applicationName.trim();
  return name.length > 0 && name.length <= 160 && !/[\\/\r\n\0]/.test(name) ? name : undefined;
};

/** Uses only completed Main-side outcome data; it never consumes provider prose or launch targets. */
export const composeFinalResponse = (outcome: ActionOutcome): string | undefined => {
  if (outcome.status !== "SUCCEEDED") return undefined;
  if (outcome.action === "OPEN_APPLICATION") {
    const name = getResolvedApplicationName(outcome);
    return name ? `Listo, abrí ${name}.` : undefined;
  }

  if (outcome.action === "CREATE_TASK") return hasConfirmedPlannerRecord(outcome) ? "Listo, agregué la tarea." : undefined;
  if (outcome.action === "UPDATE_TASK") return hasConfirmedPlannerRecord(outcome) ? "Listo, actualicé la tarea." : undefined;
  if (outcome.action === "COMPLETE_TASK") return hasConfirmedPlannerRecord(outcome) ? "Listo, marqué la tarea como completada." : undefined;
  if (outcome.action === "CREATE_EVENT") return hasConfirmedPlannerRecord(outcome) ? "Listo, agregué el evento." : undefined;
  if (outcome.action === "UPDATE_EVENT") return hasConfirmedPlannerRecord(outcome) ? "Listo, actualicé el evento." : undefined;
  if (outcome.action === "CREATE_REMINDER") return hasConfirmedPlannerRecord(outcome) ? "Listo, agregué el recordatorio." : undefined;
  if (outcome.action === "DELETE_TASK") return hasConfirmedDeletion(outcome) ? "Listo, eliminé la tarea." : undefined;
  if (outcome.action === "DELETE_EVENT") return hasConfirmedDeletion(outcome) ? "Listo, eliminé el evento." : undefined;

  const messages: Partial<Record<ActionOutcome["action"], string>> = {
    OPEN_WEB_PAGE: "Listo, abrí la página.",
    CREATE_FOLDER: "Listo, creé la carpeta.",
    RENAME_FILE: "Listo, cambié el nombre del archivo.",
    RENAME_FOLDER: "Listo, cambié el nombre de la carpeta.",
    MOVE_FILE: "Listo, moví el archivo."
  };
  return messages[outcome.action];
};
