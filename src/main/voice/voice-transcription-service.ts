import {
  VOICE_ALLOWED_MIME_TYPES,
  VOICE_ERROR_CODES,
  VOICE_MAX_AUDIO_BYTES,
  VOICE_MAX_RECORDING_DURATION_MS,
  type VoiceMimeType,
  type VoiceOperationResult,
  type VoiceTranscriptionData,
  type VoiceTranscriptionInput
} from "../../shared/voice-contracts";
import {
  getOpenAiTranscriptionConfiguration,
  type OpenAiTranscriptionConfiguration
} from "../config/openai-environment";
import {
  createOpenAiTranscriptionProvider,
  type OpenAiTranscriptionProvider
} from "./openai-transcription-provider";

const maximumTranscriptLength = 4_000;

type VoiceTranscriptionServiceDependencies = {
  getConfiguration: () => OpenAiTranscriptionConfiguration;
  createProvider: (configuration: OpenAiTranscriptionConfiguration) => OpenAiTranscriptionProvider;
  timeoutMs: number;
  logError: (message: string) => void;
};

export type VoiceTranscriptionService = {
  transcribe: (input: unknown) => Promise<VoiceOperationResult<VoiceTranscriptionData>>;
};

const failure = <T>(code: string, userMessage: string): VoiceOperationResult<T> => ({
  ok: false,
  error: { code, userMessage }
});

const providerMessage = (code: string): string => {
  switch (code) {
    case VOICE_ERROR_CODES.configuration:
      return "La transcripción requiere configurar OpenAI localmente.";
    case VOICE_ERROR_CODES.authentication:
      return "Ares no pudo autenticarse para transcribir el audio.";
    case VOICE_ERROR_CODES.modelAccess:
      return "El modelo de transcripción no está disponible para esta cuenta.";
    case VOICE_ERROR_CODES.rateLimited:
      return "El servicio de transcripción alcanzó su límite temporal. Inténtalo más tarde.";
    case VOICE_ERROR_CODES.timeout:
      return "La transcripción tardó demasiado. Puedes escribir tu instrucción.";
    case VOICE_ERROR_CODES.busy:
      return "Ya hay una transcripción en curso. Espera a que termine.";
    default:
      return "La transcripción no está disponible en este momento.";
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeMimeType = (value: unknown): VoiceMimeType | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return VOICE_ALLOWED_MIME_TYPES.includes(normalized as VoiceMimeType)
    ? normalized as VoiceMimeType
    : undefined;
};

const validateInput = (input: unknown): VoiceTranscriptionInput | VoiceOperationResult<never> => {
  if (!isRecord(input) || Object.keys(input).length !== 3 || !Object.hasOwn(input, "audio") || !Object.hasOwn(input, "mimeType") || !Object.hasOwn(input, "durationMs")) {
    return failure(VOICE_ERROR_CODES.inputInvalid, "El audio recibido no es válido.");
  }
  if (!(input.audio instanceof ArrayBuffer)) return failure(VOICE_ERROR_CODES.inputInvalid, "El audio recibido no es válido.");
  if (typeof input.durationMs !== "number" || !Number.isInteger(input.durationMs) || input.durationMs <= 0 || input.durationMs > VOICE_MAX_RECORDING_DURATION_MS) return failure(VOICE_ERROR_CODES.inputInvalid, "La duración del audio no es válida.");
  if (input.audio.byteLength === 0) return failure(VOICE_ERROR_CODES.audioEmpty, "No se recibió audio para transcribir.");
  if (input.audio.byteLength > VOICE_MAX_AUDIO_BYTES) return failure(VOICE_ERROR_CODES.audioTooLarge, "La grabación es demasiado larga para transcribirla.");
  const mimeType = normalizeMimeType(input.mimeType);
  if (!mimeType) return failure(VOICE_ERROR_CODES.mimeUnsupported, "El formato de audio no es compatible.");
  return { audio: input.audio, mimeType, durationMs: input.durationMs };
};

const isFailure = (value: VoiceTranscriptionInput | VoiceOperationResult<never>): value is VoiceOperationResult<never> =>
  "ok" in value;

const errorCode = (error: unknown): string => {
  if (!isRecord(error)) return VOICE_ERROR_CODES.provider;
  if (error.status === 401) return VOICE_ERROR_CODES.authentication;
  if (error.status === 403 || error.status === 404) return VOICE_ERROR_CODES.modelAccess;
  if (error.status === 429) return VOICE_ERROR_CODES.rateLimited;
  return VOICE_ERROR_CODES.provider;
};

/** Main-only transcription gate; audio stays in memory for one explicit request. */
export const createVoiceTranscriptionService = (
  overrides: Partial<VoiceTranscriptionServiceDependencies> = {}
): VoiceTranscriptionService => {
  const dependencies: VoiceTranscriptionServiceDependencies = {
    getConfiguration: overrides.getConfiguration ?? getOpenAiTranscriptionConfiguration,
    createProvider: overrides.createProvider ?? createOpenAiTranscriptionProvider,
    timeoutMs: overrides.timeoutMs ?? 20_000,
    logError: overrides.logError ?? ((message) => console.error(message))
  };
  let inFlight = false;

  return {
    async transcribe(input): Promise<VoiceOperationResult<VoiceTranscriptionData>> {
      const validated = validateInput(input);
      if (isFailure(validated)) return validated;
      if (inFlight) return failure(VOICE_ERROR_CODES.busy, providerMessage(VOICE_ERROR_CODES.busy));
      let provider: OpenAiTranscriptionProvider;
      try {
        provider = dependencies.createProvider(dependencies.getConfiguration());
      } catch {
        dependencies.logError(`Voice transcription failed [${VOICE_ERROR_CODES.configuration}].`);
        return failure(VOICE_ERROR_CODES.configuration, providerMessage(VOICE_ERROR_CODES.configuration));
      }
      const controller = new AbortController();
      inFlight = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("TRANSCRIPTION_TIMEOUT")); }, dependencies.timeoutMs);
      });
      try {
        const text = (await Promise.race([provider.transcribe({ ...validated, signal: controller.signal }), timeout])).trim();
        if (!text || text.length > maximumTranscriptLength) {
          dependencies.logError(`Voice transcription failed [${VOICE_ERROR_CODES.provider}].`);
          return failure(VOICE_ERROR_CODES.provider, providerMessage(VOICE_ERROR_CODES.provider));
        }
        return { ok: true, data: { text } };
      } catch (error) {
        const code = controller.signal.aborted ? VOICE_ERROR_CODES.timeout : errorCode(error);
        dependencies.logError(`Voice transcription failed [${code}].`);
        return failure(code, providerMessage(code));
      } finally {
        clearTimeout(timer);
        inFlight = false;
      }
    }
  };
};
