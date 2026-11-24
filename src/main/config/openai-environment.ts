import dotenv from "dotenv";

import { MainConfigurationError } from "./database-environment";

export type OpenAiConfiguration = {
  apiKey: string;
  model: string;
};

export const getOpenAiSpeechConfiguration = (): { apiKey: string } => {
  dotenv.config({ quiet: true });
  return { apiKey: requiredValue(process.env, "OPENAI_API_KEY", "speech") };
};

/** Used when OPENAI_TRANSCRIPTION_MODEL is unset or blank: the full-size model, which is the most accurate. */
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

export type OpenAiTranscriptionConfiguration = {
  apiKey: string;
  transcriptionModel: string;
};

const requiredValue = (
  environment: NodeJS.ProcessEnv,
  key: "OPENAI_API_KEY" | "OPENAI_MODEL" | "OPENAI_TRANSCRIPTION_MODEL",
  requestKind = "interpretation"
): string => {
  const value = environment[key]?.trim();
  if (!value) {
    throw new MainConfigurationError(
      `${key}_MISSING`,
      `${key} is required before ${requestKind === "interpretation" ? "an" : "a"} ${requestKind} request.`
    );
  }
  return value;
};

/** Reads OpenAI configuration only when Main requests an interpretation. */
export const getOpenAiConfiguration = (
  environment: NodeJS.ProcessEnv = process.env
): OpenAiConfiguration => {
  if (environment === process.env) {
    dotenv.config({ quiet: true });
  }

  return {
    apiKey: requiredValue(environment, "OPENAI_API_KEY"),
    model: requiredValue(environment, "OPENAI_MODEL")
  };
};

/** Reads the speech-to-text model only for an explicit Main-owned transcription. */
export const getOpenAiTranscriptionConfiguration = (
  environment: NodeJS.ProcessEnv = process.env
): OpenAiTranscriptionConfiguration => {
  if (environment === process.env) {
    dotenv.config({ quiet: true });
  }

  return {
    apiKey: requiredValue(environment, "OPENAI_API_KEY", "transcription"),
    transcriptionModel: environment.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL
  };
};

/** Reads the optional ElevenLabs speech settings. Both names must be set; otherwise speech stays on OpenAI. */
export const getElevenLabsSpeechConfiguration = (
  environment: NodeJS.ProcessEnv = process.env
): { apiKey: string; voiceId: string } | undefined => {
  if (environment === process.env) {
    dotenv.config({ quiet: true });
  }
  const apiKey = environment.ELEVENLABS_API_KEY?.trim();
  const voiceId = environment.ELEVENLABS_VOICE_ID?.trim();
  return apiKey && voiceId ? { apiKey, voiceId } : undefined;
};
