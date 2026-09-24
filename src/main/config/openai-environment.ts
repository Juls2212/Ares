import dotenv from "dotenv";

import { MainConfigurationError } from "./database-environment";

export type OpenAiConfiguration = {
  apiKey: string;
  model: string;
};

const requiredValue = (
  environment: NodeJS.ProcessEnv,
  key: "OPENAI_API_KEY" | "OPENAI_MODEL"
): string => {
  const value = environment[key]?.trim();
  if (!value) {
    throw new MainConfigurationError(
      `${key}_MISSING`,
      `${key} is required before an interpretation request.`
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
