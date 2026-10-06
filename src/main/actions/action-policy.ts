import {
  ACTION_ERROR_CODES,
  ACTION_KINDS,
  type ActionAvailability,
  type ActionApprovalClass,
  type ActionConfirmationRequirement,
  type ActionKind,
  type ActionOperationResult,
  type ActionPolicy,
  type ActionProposal,
  type ActionRiskLevel
} from "../../shared/action-contracts";

type PolicyDefinition = {
  approval: ActionApprovalClass;
  availability: Exclude<ActionAvailability, "UNSUPPORTED">;
  confirmation: Omit<ActionConfirmationRequirement, "required">;
};

const policyDefinitions: Record<ActionKind, PolicyDefinition> = {
  OPEN_APPLICATION: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se abrirá una aplicación registrada.",
      affectedItemCount: 1,
      scopeSummary: "Aplicación registrada"
    }
  },
  OPEN_WEB_PAGE: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se abrirá YouTube en el navegador Chrome registrado.",
      affectedItemCount: 1,
      scopeSummary: "Página web autorizada"
    }
  },
  CREATE_FOLDER: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se creará una carpeta autorizada.",
      affectedItemCount: 1,
      scopeSummary: "Carpeta autorizada"
    }
  },
  RENAME_FILE: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se cambiará el nombre de 1 archivo.",
      affectedItemCount: 1,
      scopeSummary: "Archivo autorizado"
    }
  },
  RENAME_FOLDER: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se cambiará el nombre de 1 carpeta.",
      affectedItemCount: 1,
      scopeSummary: "Carpeta autorizada"
    }
  },
  MOVE_FILE: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se moverá 1 archivo autorizado.",
      affectedItemCount: 1,
      scopeSummary: "Archivo y destino autorizados"
    }
  },
  SEARCH_FILES: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se buscarán archivos en ubicaciones autorizadas.",
      affectedItemCount: null,
      scopeSummary: "Ubicaciones autorizadas"
    }
  },
  ORGANIZE_FILES: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se organizarán archivos autorizados tras revisar la vista previa.",
      affectedItemCount: null,
      scopeSummary: "Carpeta autorizada"
    }
  },
  CREATE_TASK: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se creará una tarea.",
      affectedItemCount: 1,
      scopeSummary: "Información nueva del planificador"
    }
  },
  UPDATE_TASK: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se actualizará una tarea existente.",
      affectedItemCount: 1,
      scopeSummary: "Tarea existente"
    }
  },
  COMPLETE_TASK: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se completará una tarea existente.",
      affectedItemCount: 1,
      scopeSummary: "Tarea existente"
    }
  },
  CREATE_EVENT: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se creará un evento.",
      affectedItemCount: 1,
      scopeSummary: "Información nueva del planificador"
    }
  },
  UPDATE_EVENT: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se actualizará un evento existente.",
      affectedItemCount: 1,
      scopeSummary: "Evento existente"
    }
  },
  CREATE_REMINDER: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se creará un recordatorio.",
      affectedItemCount: 1,
      scopeSummary: "Información nueva del planificador"
    }
  },
  GET_TODAY_SCHEDULE: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se consultará la agenda de hoy.",
      affectedItemCount: null,
      scopeSummary: "Agenda local de hoy"
    }
  },
  GET_WEEK_SCHEDULE: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se consultará la agenda de la semana.",
      affectedItemCount: null,
      scopeSummary: "Agenda local de la semana"
    }
  },
  GET_WEEKLY_SCHEDULE_DETAILS: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se consultará un horario semanal existente.", affectedItemCount: null, scopeSummary: "Horario semanal existente" }
  },
  ANALYZE_WEEKLY_SCHEDULE: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se analizará un horario semanal existente.", affectedItemCount: null, scopeSummary: "Horario semanal existente" }
  },
  GET_TODAY_AVAILABILITY: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se consultará la disponibilidad estimada de hoy.", affectedItemCount: null, scopeSummary: "Agenda local de hoy" }
  },
  CREATE_WEEKLY_SCHEDULE: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se creará un horario semanal.", affectedItemCount: 1, scopeSummary: "Horario semanal nuevo" }
  },
  UPDATE_WEEKLY_SCHEDULE: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se actualizará un horario semanal.", affectedItemCount: 1, scopeSummary: "Horario semanal existente" }
  },
  CREATE_WEEKLY_ROUTINE: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se agregará un bloque semanal.", affectedItemCount: 1, scopeSummary: "Bloque semanal nuevo" }
  },
  UPDATE_WEEKLY_ROUTINE: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se actualizará un bloque semanal.", affectedItemCount: 1, scopeSummary: "Bloque semanal existente" }
  },
  GET_CURRENT_DATE_TIME: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se consultará la fecha y hora locales actuales.",
      affectedItemCount: null,
      scopeSummary: "Fecha y hora locales actuales"
    }
  },
  GET_WEATHER: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se consultará el clima actual de Pasto.",
      affectedItemCount: null,
      scopeSummary: "Clima actual de Pasto"
    }
  },
  GET_HABIT_PROGRESS: {
    approval: "DIRECT",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se consultará el progreso de hábitos.",
      affectedItemCount: null,
      scopeSummary: "Progreso de hábitos"
    }
  },
  CREATE_HABIT: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se creará un hábito.",
      affectedItemCount: 1,
      scopeSummary: "Hábito nuevo"
    }
  },
  UPDATE_HABIT: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se actualizará un hábito existente.",
      affectedItemCount: 1,
      scopeSummary: "Hábito existente"
    }
  },
  COMPLETE_HABIT: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: {
      summary: "Se marcará un hábito como completado hoy.",
      affectedItemCount: 1,
      scopeSummary: "Hábito existente"
    }
  },
  OPEN_REGISTERED_APPLICATION: {
    approval: "DIRECT",
    availability: "DEFERRED",
    confirmation: { summary: "Se abrirá una aplicación registrada.", affectedItemCount: 1, scopeSummary: "Aplicación registrada" }
  },
  OPEN_REGISTERED_PAGE: {
    approval: "DIRECT",
    availability: "DEFERRED",
    confirmation: { summary: "Se abrirá una página registrada.", affectedItemCount: 1, scopeSummary: "Página registrada" }
  },
  MOVE_FOLDER: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "DEFERRED",
    confirmation: { summary: "Se moverá una carpeta autorizada.", affectedItemCount: 1, scopeSummary: "Carpeta autorizada" }
  },
  UPDATE_REGISTERED_APPLICATION: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "DEFERRED",
    confirmation: { summary: "Se modificará una aplicación registrada.", affectedItemCount: 1, scopeSummary: "Aplicación registrada" }
  },
  UPDATE_REGISTERED_PAGE: {
    approval: "CONFIRMATION_REQUIRED",
    availability: "DEFERRED",
    confirmation: { summary: "Se modificará una página registrada.", affectedItemCount: 1, scopeSummary: "Página registrada" }
  },
  DELETE_EVENT: {
    approval: "REINFORCED_CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se eliminará permanentemente un evento.", affectedItemCount: 1, scopeSummary: "Evento existente" }
  },
  DELETE_FILE: {
    approval: "REINFORCED_CONFIRMATION_REQUIRED",
    availability: "DEFERRED",
    confirmation: { summary: "Se eliminará permanentemente un archivo.", affectedItemCount: 1, scopeSummary: "Archivo autorizado" }
  },
  DELETE_TASK: {
    approval: "REINFORCED_CONFIRMATION_REQUIRED",
    availability: "IMPLEMENTED",
    confirmation: { summary: "Se eliminará permanentemente una tarea.", affectedItemCount: 1, scopeSummary: "Tarea existente" }
  },
  DELETE_FOLDER: {
    approval: "REINFORCED_CONFIRMATION_REQUIRED",
    availability: "DEFERRED",
    confirmation: { summary: "Se eliminará permanentemente una carpeta.", affectedItemCount: 1, scopeSummary: "Carpeta autorizada" }
  }
};

const riskLevelByApproval: Record<ActionApprovalClass, ActionRiskLevel> = {
  DIRECT: 1,
  CONFIRMATION_REQUIRED: 2,
  REINFORCED_CONFIRMATION_REQUIRED: 3
};

const failureMessages = {
  [ACTION_ERROR_CODES.unsupported]: "No puedo realizar esa acción.",
  [ACTION_ERROR_CODES.deferred]: "Esta acción todavía no está disponible.",
  [ACTION_ERROR_CODES.proposalInvalid]: "La propuesta de acción no es válida."
} as const;

const isActionKind = (value: unknown): value is ActionKind =>
  typeof value === "string" && ACTION_KINDS.includes(value as ActionKind);

const createFailure = <T>(
  code: keyof typeof failureMessages
): ActionOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: failureMessages[code] }
});

export const getActionPolicy = (action: ActionKind): ActionPolicy => {
  const definition = policyDefinitions[action];
  return {
    action,
    approval: definition.approval,
    riskLevel: riskLevelByApproval[definition.approval],
    availability: definition.availability,
    confirmation: {
      ...definition.confirmation,
      required: definition.approval !== "DIRECT"
    }
  };
};

export const lookupActionPolicy = (action: unknown): ActionOperationResult<ActionPolicy> =>
  isActionKind(action)
    ? { ok: true, data: getActionPolicy(action) }
    : createFailure(ACTION_ERROR_CODES.unsupported);

export const evaluateActionProposal = (
  proposal: unknown
): ActionOperationResult<ActionPolicy> => {
  if (typeof proposal !== "object" || proposal === null || !("action" in proposal)) {
    return createFailure(ACTION_ERROR_CODES.proposalInvalid);
  }

  const action = (proposal as { action?: unknown }).action;
  const lookup = lookupActionPolicy(action);
  if (!lookup.ok) return lookup;
  const policy = lookup.data;
  if (policy.availability === "DEFERRED") {
    return createFailure(ACTION_ERROR_CODES.deferred);
  }

  return { ok: true, data: policy };
};

export const requiresActionConfirmation = (proposal: ActionProposal): boolean =>
  getActionPolicy(proposal.action).confirmation.required;
