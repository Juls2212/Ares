import dotenv from "dotenv";

import { MainConfigurationError } from "./database-environment";

export type OpenAiConfiguration = {
  apiKey: string;
  model: string;
};

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
    transcriptionModel: requiredValue(environment, "OPENAI_TRANSCRIPTION_MODEL", "transcription")
  };
};
