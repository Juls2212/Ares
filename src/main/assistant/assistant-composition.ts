import {
  ASSISTANT_ERROR_CODES,
  type AssistantInterpretation,
  type AssistantOperationResult
} from "../../shared/assistant-contracts";
import { createAssistantInterpreter } from "./assistant-interpreter";

export type AssistantInterpreter = ReturnType<typeof createAssistantInterpreter>;

export type AssistantInterpretationService = {
  interpret(input: unknown): Promise<AssistantOperationResult<AssistantInterpretation>>;
};

type AssistantInterpretationServiceDependencies = {
  getInterpreter: () => AssistantInterpreter;
};

const unavailable = (
  code: "ASSISTANT_BUSY" | "ASSISTANT_IPC_UNAVAILABLE"
): AssistantOperationResult<AssistantInterpretation> => ({
  ok: true,
  data: {
    state: "UNAVAILABLE",
    summary:
      code === ASSISTANT_ERROR_CODES.busy
        ? "Ares ya está interpretando una solicitud. Inténtalo de nuevo cuando termine."
        : "La interpretación no está disponible en este momento.",
    drafts: [],
    clarifications: [],
    errorCode: code
  }
});

const clarification = (): AssistantOperationResult<AssistantInterpretation> => ({
  ok: true,
  data: {
    state: "NEEDS_CLARIFICATION",
    summary: "Necesito una instrucción de texto para interpretarla.",
    drafts: [],
    clarifications: [{ question: "¿Qué quieres que haga Ares?" }]
  }
});

const normalizeRequest = (input: unknown): { instruction: string } | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const request = input as Record<string, unknown>;
  if (Object.keys(request).length !== 1 || !Object.prototype.hasOwnProperty.call(request, "text")) {
    return undefined;
  }
  return typeof request.text === "string" ? { instruction: request.text } : undefined;
};

/** A single Main-process gate prevents parallel paid interpretation requests. */
export const createAssistantInterpretationService = (
  dependencies: AssistantInterpretationServiceDependencies
): AssistantInterpretationService => {
  let inFlight = false;

  return {
    async interpret(input: unknown): Promise<AssistantOperationResult<AssistantInterpretation>> {
      const normalizedInput = normalizeRequest(input);
      if (!normalizedInput) return clarification();
      if (inFlight) return unavailable(ASSISTANT_ERROR_CODES.busy);

      inFlight = true;
      try {
        return await dependencies.getInterpreter().interpret(normalizedInput);
      } catch {
        return unavailable(ASSISTANT_ERROR_CODES.ipcUnavailable);
      } finally {
        inFlight = false;
      }
    }
  };
};

let assistantInterpretationService: AssistantInterpretationService | undefined;

export const getAssistantInterpretationService = (): AssistantInterpretationService => {
  assistantInterpretationService ??= createAssistantInterpretationService({
    getInterpreter: createAssistantInterpreter
  });
  return assistantInterpretationService;
};
