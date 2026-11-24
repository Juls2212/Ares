import { defineFailureTaxonomy } from "../../shared/failure-taxonomy";
import type { OperationResult } from "../../shared/contracts";
import { WEATHER_MAX_DAY_OFFSET, type GetWeatherInput } from "../../shared/action-contracts";
import { WEATHER_LOCATION } from "./weather-configuration";
import { validateWeatherInput } from "./weather-validation";

export { WEATHER_LOCATION } from "./weather-configuration";

export const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;
export const WEATHER_REQUEST_TIMEOUT_MS = 8_000;
/** A provider answer larger than this is rejected as malformed; real answers are a few kilobytes. */
export const WEATHER_MAX_RESPONSE_CHARACTERS = 65_536;

/**
 * Closed failure taxonomy of the read-only weather query. Every code has one fixed Spanish message that contains no user
 * data: not the typed place, not coordinates, not provider text.
 */
export const WEATHER_ERROR_CODES = {
  inputInvalid: "WEATHER_INPUT_INVALID",
  locationNotFound: "WEATHER_LOCATION_NOT_FOUND",
  unavailable: "WEATHER_UNAVAILABLE",
  timeout: "WEATHER_TIMEOUT",
  malformed: "WEATHER_RESPONSE_INVALID",
  unsupported: "WEATHER_CONDITION_UNSUPPORTED"
} as const;

export type WeatherErrorCode = (typeof WEATHER_ERROR_CODES)[keyof typeof WEATHER_ERROR_CODES];

type WeatherHttpResponse = {
  ok: boolean;
  text: () => Promise<string>;
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
  placeName: string;
  dayOffset: number;
  condition: string;
  currentTemperature?: number;
  apparentTemperature?: number;
  minimumTemperature: number;
  maximumTemperature: number;
  precipitationProbability: number;
};

export type WeatherOperationResult<T> = OperationResult<T>;

export type WeatherService = {
  /** Answers the (already bounded) query with one short Spanish sentence composed in Main from verified provider data. */
  getWeather: (input: unknown) => Promise<WeatherOperationResult<{ summary: string }>>;
};

class WeatherFailure extends Error {
  readonly code: WeatherErrorCode;

  constructor(code: WeatherErrorCode) {
    super(code);
    this.code = code;
  }
}

const taxonomy = defineFailureTaxonomy({
  WEATHER_INPUT_INVALID: "No pude entender el lugar o el día para consultar el clima.",
  WEATHER_LOCATION_NOT_FOUND: "No encontré ese lugar para consultar el clima.",
  WEATHER_UNAVAILABLE: "No puedo consultar el clima en este momento.",
  WEATHER_TIMEOUT: "La consulta del clima tardó demasiado. Inténtalo de nuevo más tarde.",
  WEATHER_RESPONSE_INVALID: "No pude verificar los datos del clima en este momento.",
  WEATHER_CONDITION_UNSUPPORTED: "No pude verificar las condiciones del clima."
});

export const weatherUserMessage = (code: WeatherErrorCode): string => taxonomy.messageFor(code);

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

const isCoordinate = (value: unknown, limit: number): value is number =>
  isFiniteNumber(value) && Math.abs(value) <= limit;

const asWeatherFailure = (error: unknown): WeatherFailure =>
  error instanceof WeatherFailure ? error : new WeatherFailure(WEATHER_ERROR_CODES.unavailable);

const buildGeocodingUrl = (name: string, countryCode: string | undefined): string => {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  if (countryCode !== undefined) url.searchParams.set("countryCode", countryCode);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "es");
  url.searchParams.set("format", "json");
  return url.toString();
};

const buildForecastUrl = (latitude: number, longitude: number, timeZone: string, days: number): string => {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code");
  url.searchParams.set("daily", "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max");
  url.searchParams.set("timezone", timeZone);
  url.searchParams.set("forecast_days", String(days));
  return url.toString();
};

/** Only letters, digits and a few name marks survive; the provider name is what the answer speaks, never the typed text. */
const sanitizePlaceName = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[^\p{L}\p{N} .,'’-]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : undefined;
};

const parseLocation = (
  payload: unknown,
  requireDefault: boolean
): { latitude: number; longitude: number; placeName: string; timeZone: string } => {
  if (!isRecord(payload)) throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  // The geocoder omits \`results\` when nothing matches.
  if (payload.results === undefined) throw new WeatherFailure(WEATHER_ERROR_CODES.locationNotFound);
  if (!Array.isArray(payload.results)) throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  const match = payload.results.find(
    (candidate) =>
      isRecord(candidate) &&
      isCoordinate(candidate.latitude, 90) &&
      isCoordinate(candidate.longitude, 180) &&
      (!requireDefault || (candidate.name === WEATHER_LOCATION.city && candidate.country_code === WEATHER_LOCATION.countryCode))
  ) as Record<string, unknown> | undefined;
  if (!match) throw new WeatherFailure(WEATHER_ERROR_CODES.locationNotFound);
  const placeName = sanitizePlaceName(match.name) ?? "ese lugar";
  const timeZone = requireDefault
    ? WEATHER_LOCATION.timeZone
    : typeof match.timezone === "string" && /^[A-Za-z]+(?:\/[A-Za-z_+-]+){1,2}$/u.test(match.timezone) ? match.timezone : "auto";
  return { latitude: match.latitude as number, longitude: match.longitude as number, placeName, timeZone };
};

const dailyAt = (daily: Record<string, unknown>, key: string, index: number): unknown =>
  Array.isArray(daily[key]) ? (daily[key] as unknown[])[index] : undefined;

const parseForecast = (payload: unknown, placeName: string, dayOffset: number): WeatherData => {
  if (!isRecord(payload) || !isRecord(payload.daily)) throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  const { daily } = payload;
  const minimum = dailyAt(daily, "temperature_2m_min", dayOffset);
  const maximum = dailyAt(daily, "temperature_2m_max", dayOffset);
  const precipitation = dailyAt(daily, "precipitation_probability_max", dayOffset);
  if (!isTemperature(minimum) || !isTemperature(maximum) || !isPrecipitationProbability(precipitation)) {
    throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  }
  let code: unknown;
  let currentTemperature: number | undefined;
  let apparentTemperature: number | undefined;
  if (dayOffset === 0) {
    if (!isRecord(payload.current)) throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
    const { current } = payload;
    if (!isTemperature(current.temperature_2m) || !isTemperature(current.apparent_temperature)) {
      throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
    }
    code = current.weather_code;
    currentTemperature = current.temperature_2m;
    apparentTemperature = current.apparent_temperature;
  } else {
    code = dailyAt(daily, "weather_code", dayOffset);
  }
  if (!isFiniteNumber(code) || !Number.isInteger(code)) throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
  const condition = mapWeatherCode(code);
  if (!condition) throw new WeatherFailure(WEATHER_ERROR_CODES.unsupported);
  return {
    placeName,
    dayOffset,
    condition,
    ...(currentTemperature === undefined ? {} : { currentTemperature }),
    ...(apparentTemperature === undefined ? {} : { apparentTemperature }),
    minimumTemperature: minimum,
    maximumTemperature: maximum,
    precipitationProbability: precipitation
  };
};

const formatTemperature = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");

const dayLabel = (dayOffset: number): string => (dayOffset === 1 ? "mañana" : `dentro de ${dayOffset} días`);

export const composeWeatherSummary = (weather: WeatherData): string => {
  const range = `entre ${formatTemperature(weather.minimumTemperature)} y ${formatTemperature(weather.maximumTemperature)} grados, con hasta ${Math.round(weather.precipitationProbability)} % de probabilidad de lluvia`;
  if (weather.dayOffset > 0 || weather.currentTemperature === undefined || weather.apparentTemperature === undefined) {
    return `Para ${dayLabel(weather.dayOffset)} en ${weather.placeName} se espera ${weather.condition}, ${range}.`;
  }
  return `Ahora en ${weather.placeName} hay ${formatTemperature(weather.currentTemperature)} grados y está ${weather.condition}. Hoy se esperan ${range}.`;
};

export const createWeatherService = (
  overrides: WeatherServiceDependencies = {}
): WeatherService => {
  const fetcher: WeatherFetch = overrides.fetch ?? ((url, init) => fetch(url, init));
  const now = overrides.now ?? Date.now;
  const timeoutMs = overrides.timeoutMs ?? WEATHER_REQUEST_TIMEOUT_MS;
  // Only answers about the configured default place are cached; a typed place is never retained.
  const cache = new Map<number, { expiresAt: number; data: WeatherData }>();

  const requestJson = async (url: string, signal: AbortSignal): Promise<unknown> => {
    try {
      const response = await fetcher(url, { signal });
      if (!response.ok) throw new WeatherFailure(WEATHER_ERROR_CODES.unavailable);
      try {
        const body = await response.text();
        if (body.length > WEATHER_MAX_RESPONSE_CHARACTERS) throw new WeatherFailure(WEATHER_ERROR_CODES.malformed);
        return JSON.parse(body) as unknown;
      } catch (error) {
        throw error instanceof WeatherFailure ? error : new WeatherFailure(WEATHER_ERROR_CODES.malformed);
      }
    } catch (error) {
      throw asWeatherFailure(error);
    }
  };

  return {
    getWeather: async (rawInput) => {
      const validated = validateWeatherInput(rawInput);
      if (!validated.ok) {
        return { ok: false, error: { code: WEATHER_ERROR_CODES.inputInvalid, userMessage: taxonomy.messageFor(WEATHER_ERROR_CODES.inputInvalid) } };
      }
      const query: GetWeatherInput = validated.data;
      const dayOffset = Math.min(query.dayOffset ?? 0, WEATHER_MAX_DAY_OFFSET);
      const useDefault = query.location === undefined;
      try {
        const cached = useDefault ? cache.get(dayOffset) : undefined;
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
          const place = parseLocation(
            await requestJson(
              buildGeocodingUrl(query.location ?? WEATHER_LOCATION.city, useDefault ? WEATHER_LOCATION.countryCode : undefined),
              controller.signal
            ),
            useDefault
          );
          weather = parseForecast(
            await requestJson(buildForecastUrl(place.latitude, place.longitude, place.timeZone, dayOffset + 1), controller.signal),
            place.placeName,
            dayOffset
          );
        } catch (error) {
          if (timedOut) throw new WeatherFailure(WEATHER_ERROR_CODES.timeout);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
        if (useDefault) cache.set(dayOffset, { data: weather, expiresAt: now() + WEATHER_CACHE_TTL_MS });
        return { ok: true, data: { summary: composeWeatherSummary(weather) } };
      } catch (error) {
        const failure = asWeatherFailure(error);
        return { ok: false, error: { code: failure.code, userMessage: taxonomy.messageFor(failure.code) } };
      }
    }
  };
};
