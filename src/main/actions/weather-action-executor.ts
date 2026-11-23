import { failedOutcome, type FailureOutcomeStatus, outcomeIdentity, succeededOutcome } from "../../shared/outcome-kit";
import type {
  ActionOutcome,
  ActionPolicy,
  WeatherActionProposal
} from "../../shared/action-contracts";
import {
  WEATHER_ERROR_CODES,
  createWeatherService,
  weatherUserMessage,
  type WeatherService
} from "../weather/weather-service";

export type WeatherActionExecutor = {
  execute: (proposal: WeatherActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type WeatherActionExecutorDependencies = {
  weatherService?: WeatherService;
  logError: (message: string) => void;
};

/** A bad place or input is the person's to fix; everything else is a provider or network problem. */
const failureStatus = (errorCode: string): FailureOutcomeStatus =>
  errorCode === WEATHER_ERROR_CODES.inputInvalid || errorCode === WEATHER_ERROR_CODES.locationNotFound
    ? "VALIDATION_FAILED"
    : "EXECUTION_FAILED";

/**
 * Read-only weather query. The outcome carries only the spoken Spanish summary: no data payload, so neither the place nor
 * the provider numbers travel anywhere except in the sentence that is spoken and shown to the person.
 */
export const createWeatherActionExecutor = (
  overrides: Partial<WeatherActionExecutorDependencies> = {}
): WeatherActionExecutor => {
  const dependencies: WeatherActionExecutorDependencies = {
    weatherService: overrides.weatherService,
    logError:
      overrides.logError ??
      ((message) => {
        console.error(message);
      })
  };
  let weatherService = dependencies.weatherService;
  const getWeatherService = (): WeatherService => {
    weatherService ??= createWeatherService();
    return weatherService;
  };

  return {
    execute: async (proposal, policy) => {
      const identity = outcomeIdentity(proposal, policy);
      try {
        const result = await getWeatherService().getWeather(proposal.input);
        if (!result.ok) {
          return failedOutcome(identity, failureStatus(result.error.code), result.error.code, result.error.userMessage);
        }
        return succeededOutcome(identity, result.data.summary);
      } catch {
        dependencies.logError("Weather action execution failed.");
        return failedOutcome(identity, "EXECUTION_FAILED", WEATHER_ERROR_CODES.unavailable, weatherUserMessage(WEATHER_ERROR_CODES.unavailable));
      }
    }
  };
};
