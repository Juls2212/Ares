import {
  VOICE_ALLOWED_MIME_TYPES,
  VOICE_ERROR_CODES,
  VOICE_MAX_AUDIO_BYTES,
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
  if (!isRecord(input) || Object.keys(input).length !== 2 || !Object.hasOwn(input, "audio") || !Object.hasOwn(input, "mimeType")) {
    return failure(VOICE_ERROR_CODES.inputInvalid, "El audio recibido no es válido.");
  }
  if (!(input.audio instanceof ArrayBuffer)) return failure(VOICE_ERROR_CODES.inputInvalid, "El audio recibido no es válido.");
  if (input.audio.byteLength === 0) return failure(VOICE_ERROR_CODES.audioEmpty, "No se recibió audio para transcribir.");
  if (input.audio.byteLength > VOICE_MAX_AUDIO_BYTES) return failure(VOICE_ERROR_CODES.audioTooLarge, "La grabación es demasiado larga para transcribirla.");
  const mimeType = normalizeMimeType(input.mimeType);
  if (!mimeType) return failure(VOICE_ERROR_CODES.mimeUnsupported, "El formato de audio no es compatible.");
  return { audio: input.audio, mimeType };
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

  return {
    async transcribe(input): Promise<VoiceOperationResult<VoiceTranscriptionData>> {
      const validated = validateInput(input);
      if (isFailure(validated)) return validated;
      let provider: OpenAiTranscriptionProvider;
      try {
        provider = dependencies.createProvider(dependencies.getConfiguration());
      } catch {
        dependencies.logError(`Voice transcription failed [${VOICE_ERROR_CODES.configuration}].`);
        return failure(VOICE_ERROR_CODES.configuration, providerMessage(VOICE_ERROR_CODES.configuration));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs);
      try {
        const text = (await provider.transcribe({ ...validated, signal: controller.signal })).trim();
        if (!text || text.length > maximumTranscriptLength) {
          dependencies.logError(`Voice transcription failed [${VOICE_ERROR_CODES.provider}].`);
          return failure(VOICE_ERROR_CODES.provider, providerMessage(VOICE_ERROR_CODES.provider));
        }
        return { ok: true, data: { text } };
      } catch (error) {
        const code = errorCode(error);
        dependencies.logError(`Voice transcription failed [${code}].`);
        return failure(code, providerMessage(code));
      } finally {
        clearTimeout(timer);
      }
    }
  };
};
