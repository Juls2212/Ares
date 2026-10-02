import type { OperationResult } from "../../shared/contracts";
import { WEATHER_LOCATION } from "./weather-configuration";

export { WEATHER_LOCATION } from "./weather-configuration";

export const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;
export const WEATHER_REQUEST_TIMEOUT_MS = 8_000;

const WEATHER_ERROR_CODES = {
  unavailable: "WEATHER_UNAVAILABLE",
  timeout: "WEATHER_TIMEOUT",
  malformed: "WEATHER_RESPONSE_INVALID",
  locationUnresolved: "WEATHER_LOCATION_UNRESOLVED",
  unsupportedCondition: "WEATHER_CONDITION_UNSUPPORTED"
} as const;

type WeatherErrorCode = (typeof WEATHER_ERROR_CODES)[keyof typeof WEATHER_ERROR_CODES];

type WeatherHttpResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type WeatherFetch = (
  url: string,
  init: { signal: AbortSignal }
) => Promise<WeatherHttpResponse>;

type WeatherServiceDependencies = {
  fetch?: WeatherFetch;
  now?: () => number;
  timeoutMs?: number;
};

type WeatherData = {
  condition: string;
  currentTemperature: number;
  apparentTemperature: number;
  minimumTemperature: number;
  maximumTemperature: number;
  precipitationProbability: number;
};

export type WeatherOperationResult<T> = OperationResult<T>;

export type WeatherService = {
  getTodayWeather: () => Promise<WeatherOperationResult<{ summary: string }>>;
};

class WeatherFailure extends Error {
  readonly code: WeatherErrorCode;

  constructor(code: WeatherErrorCode) {
    super(code);
    this.code = code;
  }
}

const userMessages: Record<WeatherErrorCode, string> = {
  WEATHER_UNAVAILABLE: "No puedo consultar el clima de Pasto en este momento.",
  WEATHER_TIMEOUT: "La consulta del clima tardó demasiado. Inténtalo de nuevo más tarde.",
  WEATHER_RESPONSE_INVALID: "No pude verificar los datos del clima en este momento.",
  WEATHER_LOCATION_UNRESOLVED: "No pude verificar la ubicación configurada para el clima.",
  WEATHER_CONDITION_UNSUPPORTED: "No pude verificar las condiciones actuales del clima."
};

const weatherConditions: Record<number, string> = {
  0: "despejado",
  1: "mayormente despejado",
  2: "parcialmente nublado",
  3: "nublado",
  45: "con niebla",
  48: "con niebla helada",
  51: "con llovizna ligera",
  53: "con llovizna",
  55: "con llovizna intensa",
  56: "con llovizna helada ligera",
  57: "con llovizna helada intensa",
  61: "con lluvia ligera",
  63: "con lluvia",
  65: "con lluvia intensa",
  66: "con lluvia helada ligera",
  67: "con lluvia helada intensa",
  71: "con nieve ligera",
  73: "con nieve",
  75: "con nieve intensa",
  77: "con granos de nieve",
  80: "con chubascos ligeros",
  81: "con chubascos",
  82: "con chubascos intensos",
  85: "con chubascos de nieve ligeros",
  86: "con chubascos de nieve intensos",
  95: "con tormenta",
  96: "con tormenta y granizo ligero",
  99: "con tormenta y granizo intenso"
};

export const mapWeatherCode = (code: number): string | undefined => weatherConditions[code];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isTemperature = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= -100 && value <= 100;

const isPrecipitationProbability = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= 0 && value <= 100;

const asWeatherFailure = (error: unknown): WeatherFailure =>
  error instanceof WeatherFailure ? error : new WeatherFailure(WEATHER_ERROR_CODES.unavailable);

const buildGeocodingUrl = (): string => {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", WEATHER_LOCATION.city);
  url.searchParams.set("countryCode", WEATHER_LOCATION.countryCode);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "es");
  url.searchParams.set("format", "json");
  return url.toString();
};

const buildForecastUrl = (latitude: number, longitude: number): string => {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code");
  url.searchParams.set("daily", "temperature_2m_min,temperature_2m_max,precipitation_probability_max");
  url.searchParams.set("timezone", WEATHER_LOCATION.timeZone);
  url.searchParams.set("forecast_days", "1");
  return url.toString();
};

const parseLocation = (payload: unknown): { latitude: number; longitude: number } => {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  }
  const match = payload.results.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.name === WEATHER_LOCATION.city &&
      candidate.country_code === WEATHER_LOCATION.countryCode &&
      isFiniteNumber(candidate.latitude) &&
      isFiniteNumber(candidate.longitude)
  );
  if (!match) throw new WeatherFailure(WEATHER_ERROR_CODES.locationUnresolved);
  return { latitude: match.latitude as number, longitude: match.longitude as number };
};

const parseForecast = (payload: unknown): WeatherData => {
  if (!isRecord(payload) || !isRecord(payload.current) || !isRecord(payload.daily)) {
    throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  }
  const { current, daily } = payload;
  const minimum = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : undefined;
  const maximum = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : undefined;
  const precipitation = Array.isArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max[0]
    : undefined;
  if (
    !isTemperature(current.temperature_2m) ||
    !isTemperature(current.apparent_temperature) ||
    !isFiniteNumber(current.weather_code) ||
    !Number.isInteger(current.weather_code) ||
    !isTemperature(minimum) ||
    !isTemperature(maximum) ||
    !isPrecipitationProbability(precipitation)
  ) {
    throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  }
  const condition = mapWeatherCode(current.weather_code);
  if (!condition) throw new WeatherFailure(WEATHER_ERROR_CODES.unsupportedCondition);
  return {
    condition,
    currentTemperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    minimumTemperature: minimum,
    maximumTemperature: maximum,
    precipitationProbability: precipitation
  };
};

const formatTemperature = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

export const composeWeatherSummary = (weather: WeatherData): string =>
  `En Pasto ahora está ${weather.condition}, con ${formatTemperature(weather.currentTemperature)} °C y sensación de ${formatTemperature(weather.apparentTemperature)} °C. Hoy se esperan entre ${formatTemperature(weather.minimumTemperature)} °C y ${formatTemperature(weather.maximumTemperature)} °C, con hasta ${Math.round(weather.precipitationProbability)} % de probabilidad de precipitación.`;

export const createWeatherService = (
  overrides: WeatherServiceDependencies = {}
): WeatherService => {
  const fetcher: WeatherFetch = overrides.fetch ?? ((url, init) => fetch(url, init));
  const now = overrides.now ?? Date.now;
  const timeoutMs = overrides.timeoutMs ?? WEATHER_REQUEST_TIMEOUT_MS;
  let cached: { expiresAt: number; data: WeatherData } | undefined;

  const requestJson = async (url: string, signal: AbortSignal): Promise<unknown> => {
    try {
      const response = await fetcher(url, { signal });
      if (!response.ok) throw new WeatherFailure(WEATHER_ERROR_CODES.unavailable);
      try {
        return await response.json();
      } catch {
        throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
      }
    } catch (error) {
      throw asWeatherFailure(error);
    }
  };

  return {
    getTodayWeather: async () => {
      try {
        if (cached && cached.expiresAt > now()) {
          return { ok: true, data: { summary: composeWeatherSummary(cached.data) } };
        }
        const controller = new AbortController();
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
        let weather: WeatherData;
        try {
          const location = parseLocation(await requestJson(buildGeocodingUrl(), controller.signal));
          weather = parseForecast(await requestJson(buildForecastUrl(location.latitude, location.longitude), controller.signal));
        } catch (error) {
          if (timedOut) throw new WeatherFailure(WEATHER_ERROR_CODES.timeout);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
        cached = { data: weather, expiresAt: now() + WEATHER_CACHE_TTL_MS };
        return { ok: true, data: { summary: composeWeatherSummary(weather) } };
      } catch (error) {
        const failure = asWeatherFailure(error);
        return { ok: false, error: { code: failure.code, userMessage: userMessages[failure.code] } };
      }
    }
  };
};
