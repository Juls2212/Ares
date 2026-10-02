import type {
  ActionOutcome,
  ActionPolicy,
  TerminalActionStatus,
  WeatherActionProposal
} from "../../shared/action-contracts";
import {
  createWeatherService,
  type WeatherService
} from "../weather/weather-service";

export type WeatherActionExecutor = {
  execute: (proposal: WeatherActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

type WeatherActionExecutorDependencies = {
  weatherService?: WeatherService;
  logError: (message: string) => void;
};

const failureStatus = (errorCode: string): TerminalActionStatus =>
  errorCode === "WEATHER_LOCATION_UNRESOLVED" ? "VALIDATION_FAILED" : "EXECUTION_FAILED";

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
      try {
        const result = await getWeatherService().getTodayWeather();
        if (!result.ok) {
          return {
            actionId: proposal.actionId,
            action: proposal.action,
            riskLevel: policy.riskLevel,
            status: failureStatus(result.error.code),
            errorCode: result.error.code,
            userSummary: result.error.userMessage
          };
        }
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "SUCCEEDED",
          userSummary: result.data.summary
        };
      } catch {
        dependencies.logError("Weather action execution failed.");
        return {
          actionId: proposal.actionId,
          action: proposal.action,
          riskLevel: policy.riskLevel,
          status: "EXECUTION_FAILED",
          errorCode: "WEATHER_UNAVAILABLE",
          userSummary: "No puedo consultar el clima de Pasto en este momento."
        };
      }
    }
  };
};
