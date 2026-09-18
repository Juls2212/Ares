import {
  ACTION_ERROR_CODES,
  ACTION_NAMES,
  type ActionAvailability,
  type ActionConfirmationRequirement,
  type ActionName,
  type ActionOperationResult,
  type ActionPolicy,
  type ActionProposal,
  type ActionRiskLevel
} from "../../shared/action-contracts";

type PolicyDefinition = {
  riskLevel: ActionRiskLevel;
  availability: Exclude<ActionAvailability, "UNSUPPORTED">;
  confirmation: ActionConfirmationRequirement;
};

const policyDefinitions: Record<ActionName, PolicyDefinition> = {
  OPEN_APPLICATION: {
    riskLevel: 1,
    availability: "IMPLEMENTED",
    confirmation: {
      required: false,
      summary: "Se abrirá una aplicación registrada.",
      affectedItemCount: 1,
      scopeSummary: "Aplicación registrada"
    }
  },
  CREATE_FOLDER: {
    riskLevel: 1,
    availability: "DEFERRED",
    confirmation: {
      required: false,
      summary: "Se creará una carpeta autorizada.",
      affectedItemCount: 1,
      scopeSummary: "Carpeta autorizada"
    }
  },
  RENAME_FILE: {
    riskLevel: 2,
    availability: "DEFERRED",
    confirmation: {
      required: true,
      summary: "Se cambiará el nombre de 1 archivo.",
      affectedItemCount: 1,
      scopeSummary: "Archivo autorizado"
    }
  },
  RENAME_FOLDER: {
    riskLevel: 2,
    availability: "DEFERRED",
    confirmation: {
      required: true,
      summary: "Se cambiará el nombre de 1 carpeta.",
      affectedItemCount: 1,
      scopeSummary: "Carpeta autorizada"
    }
  },
  MOVE_FILE: {
    riskLevel: 2,
    availability: "DEFERRED",
    confirmation: {
      required: true,
      summary: "Se moverán archivos autorizados.",
      affectedItemCount: null,
      scopeSummary: "Archivos y destino autorizados"
    }
  },
  SEARCH_FILES: {
    riskLevel: 1,
    availability: "DEFERRED",
    confirmation: {
      required: false,
      summary: "Se buscarán archivos en ubicaciones autorizadas.",
      affectedItemCount: null,
      scopeSummary: "Ubicaciones autorizadas"
    }
  },
  ORGANIZE_FILES: {
    riskLevel: 2,
    availability: "DEFERRED",
    confirmation: {
      required: true,
      summary: "Se organizarán archivos autorizados tras revisar la vista previa.",
      affectedItemCount: null,
      scopeSummary: "Carpeta autorizada"
    }
  },
  CREATE_TASK: {
    riskLevel: 1,
    availability: "IMPLEMENTED",
    confirmation: {
      required: false,
      summary: "Se creará una tarea.",
      affectedItemCount: 1,
      scopeSummary: "Información nueva del planificador"
    }
  },
  UPDATE_TASK: {
    riskLevel: 2,
    availability: "IMPLEMENTED",
    confirmation: {
      required: true,
      summary: "Se actualizará una tarea existente.",
      affectedItemCount: 1,
      scopeSummary: "Tarea existente"
    }
  },
  COMPLETE_TASK: {
    riskLevel: 2,
    availability: "IMPLEMENTED",
    confirmation: {
      required: true,
      summary: "Se completará una tarea existente.",
      affectedItemCount: 1,
      scopeSummary: "Tarea existente"
    }
  },
  CREATE_EVENT: {
    riskLevel: 1,
    availability: "IMPLEMENTED",
    confirmation: {
      required: false,
      summary: "Se creará un evento.",
      affectedItemCount: 1,
      scopeSummary: "Información nueva del planificador"
    }
  },
  UPDATE_EVENT: {
    riskLevel: 2,
    availability: "IMPLEMENTED",
    confirmation: {
      required: true,
      summary: "Se actualizará un evento existente.",
      affectedItemCount: 1,
      scopeSummary: "Evento existente"
    }
  },
  CREATE_REMINDER: {
    riskLevel: 1,
    availability: "IMPLEMENTED",
    confirmation: {
      required: false,
      summary: "Se creará un recordatorio.",
      affectedItemCount: 1,
      scopeSummary: "Información nueva del planificador"
    }
  },
  GET_TODAY_SCHEDULE: {
    riskLevel: 1,
    availability: "IMPLEMENTED",
    confirmation: {
      required: false,
      summary: "Se consultará la agenda de hoy.",
      affectedItemCount: null,
      scopeSummary: "Agenda local de hoy"
    }
  },
  GET_WEEK_SCHEDULE: {
    riskLevel: 1,
    availability: "IMPLEMENTED",
    confirmation: {
      required: false,
      summary: "Se consultará la agenda de la semana.",
      affectedItemCount: null,
      scopeSummary: "Agenda local de la semana"
    }
  }
};

const failureMessages = {
  [ACTION_ERROR_CODES.unsupported]: "No puedo realizar esa acción.",
  [ACTION_ERROR_CODES.deferred]: "Esta acción todavía no está disponible.",
  [ACTION_ERROR_CODES.proposalInvalid]: "La propuesta de acción no es válida."
} as const;

const isActionName = (value: unknown): value is ActionName =>
  typeof value === "string" && ACTION_NAMES.includes(value as ActionName);

const createFailure = <T>(
  code: keyof typeof failureMessages
): ActionOperationResult<T> => ({
  ok: false,
  error: { code, userMessage: failureMessages[code] }
});

export const getActionPolicy = (action: ActionName): ActionPolicy => ({
  action,
  riskLevel: policyDefinitions[action].riskLevel,
  availability: policyDefinitions[action].availability,
  confirmation: policyDefinitions[action].confirmation
});

export const evaluateActionProposal = (
  proposal: unknown
): ActionOperationResult<ActionPolicy> => {
  if (typeof proposal !== "object" || proposal === null || !("action" in proposal)) {
    return createFailure(ACTION_ERROR_CODES.proposalInvalid);
  }

  const action = (proposal as { action?: unknown }).action;
  if (!isActionName(action)) {
    return createFailure(ACTION_ERROR_CODES.unsupported);
  }

  const policy = getActionPolicy(action);
  if (policy.availability === "DEFERRED") {
    return createFailure(ACTION_ERROR_CODES.deferred);
  }

  return { ok: true, data: policy };
};

export const requiresActionConfirmation = (proposal: ActionProposal): boolean =>
  getActionPolicy(proposal.action).confirmation.required;
