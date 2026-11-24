import { describe, expect, it, vi } from "vitest";
import {
  WEATHER_CACHE_TTL_MS,
  WEATHER_LOCATION,
  WEATHER_MAX_RESPONSE_CHARACTERS,
  composeWeatherSummary,
  createWeatherService,
  mapWeatherCode
} from "../src/main/weather/weather-service";
import { createWeatherActionExecutor } from "../src/main/actions/weather-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";

const pastoPayload = { results: [{ name: "Pasto", country_code: "CO", latitude: 1.2136, longitude: -77.2811, timezone: "America/Bogota" }] };
const caliPayload = { results: [{ name: "Cali", country_code: "CO", latitude: 3.4372, longitude: -76.5225, timezone: "America/Bogota" }] };

const forecastPayload = {
  current: { temperature_2m: 16, apparent_temperature: 15.4, weather_code: 61 },
  daily: {
    weather_code: [61, 3, 0, 0, 0, 0, 0],
    temperature_2m_min: [10, 11, 12, 12, 12, 12, 12],
    temperature_2m_max: [18, 19, 20, 20, 20, 20, 20],
    precipitation_probability_max: [65, 40, 10, 10, 10, 10, 10]
  }
};

/** A mocked provider response: the real client reads the body as text so the size can be bounded. */
const response = (payload: unknown, ok = true) => ({ ok, text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)) });

const providerFor = (geocoding: unknown, forecast: unknown = forecastPayload) =>
  vi.fn(async (url: string) => (url.includes("geocoding-api") ? response(geocoding) : response(forecast)));

const ID = "11111111-1111-4111-8111-111111111111";

describe("weather service", () => {
  it("answers about the configured default place (Pasto, Colombia) with verified current and today data", async () => {
    const fetch = providerFor(pastoPayload);
    const result = await createWeatherService({ fetch }).getWeather({});
    expect(result).toEqual({
      ok: true,
      data: {
        summary: "Ahora en Pasto hay 16 grados y está con lluvia ligera. Hoy se esperan entre 10 y 18 grados, con hasta 65 % de probabilidad de lluvia."
      }
    });
    const geocoding = new URL(fetch.mock.calls[0]![0]);
    const forecast = new URL(fetch.mock.calls[1]![0]);
    expect(geocoding.host).toBe("geocoding-api.open-meteo.com");
    expect(forecast.host).toBe("api.open-meteo.com");
    expect(geocoding.searchParams.get("name")).toBe(WEATHER_LOCATION.city);
    expect(geocoding.searchParams.get("countryCode")).toBe(WEATHER_LOCATION.countryCode);
    expect(forecast.searchParams.get("timezone")).toBe(WEATHER_LOCATION.timeZone);
    expect(forecast.searchParams.get("forecast_days")).toBe("1");
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|1\.2136/u);
  });

  it("answers about a typed place for tomorrow from the provider's resolved name, not from the typed text", async () => {
    const fetch = providerFor(caliPayload);
    const result = await createWeatherService({ fetch }).getWeather({ location: "  cali ", dayOffset: 1 });
    expect(result).toEqual({
      ok: true,
      data: { summary: "Para mañana en Cali se espera nublado, entre 11 y 19 grados, con hasta 40 % de probabilidad de lluvia." }
    });
    const geocoding = new URL(fetch.mock.calls[0]![0]);
    const forecast = new URL(fetch.mock.calls[1]![0]);
    expect(geocoding.searchParams.get("name")).toBe("cali");
    expect(geocoding.searchParams.has("countryCode")).toBe(false);
    expect(forecast.searchParams.get("forecast_days")).toBe("2");
    expect(forecast.searchParams.get("timezone")).toBe("America/Bogota");
  });

  it("composes a multi-day forecast label and maps WMO weather codes deterministically", () => {
    const base = { placeName: "Cali", minimumTemperature: 10, maximumTemperature: 18, precipitationProbability: 20 };
    expect(composeWeatherSummary({ ...base, dayOffset: 3, condition: "despejado" })).toBe(
      "Para dentro de 3 días en Cali se espera despejado, entre 10 y 18 grados, con hasta 20 % de probabilidad de lluvia."
    );
    expect(mapWeatherCode(0)).toBe("despejado");
    expect(mapWeatherCode(61)).toBe("con lluvia ligera");
    expect(mapWeatherCode(99)).toBe("con tormenta y granizo intenso");
    expect(mapWeatherCode(999)).toBeUndefined();
  });

  it("caches only the default place for a bounded interval and never retains a typed place", async () => {
    let now = 0;
    const defaultFetch = providerFor(pastoPayload);
    const service = createWeatherService({ fetch: defaultFetch, now: () => now });
    await service.getWeather({});
    now = WEATHER_CACHE_TTL_MS - 1;
    await service.getWeather({});
    expect(defaultFetch).toHaveBeenCalledTimes(2);
    now = WEATHER_CACHE_TTL_MS;
    await service.getWeather({});
    expect(defaultFetch).toHaveBeenCalledTimes(4);

    const typedFetch = providerFor(caliPayload);
    const typed = createWeatherService({ fetch: typedFetch, now: () => 0 });
    await typed.getWeather({ location: "Cali" });
    await typed.getWeather({ location: "Cali" });
    expect(typedFetch).toHaveBeenCalledTimes(4);
  });

  it("reports a place the geocoder does not know as a closed not-found failure", async () => {
    const result = await createWeatherService({ fetch: providerFor({ generationtime_ms: 0.4 }) }).getWeather({ location: "Lugarinexistente" });
    expect(result).toEqual({
      ok: false,
      error: { code: "WEATHER_LOCATION_NOT_FOUND", userMessage: "No encontré ese lugar para consultar el clima." }
    });
    expect(JSON.stringify(result)).not.toContain("Lugarinexistente");
    await expect(createWeatherService({ fetch: providerFor({ results: [] }) }).getWeather({ location: "Nada" })).resolves.toMatchObject({
      ok: false,
      error: { code: "WEATHER_LOCATION_NOT_FOUND" }
    });
  });

  it.each([
    ["a provider error status", async () => response({}, false), "WEATHER_UNAVAILABLE"],
    ["a network failure", async () => { throw new Error("private network detail"); }, "WEATHER_UNAVAILABLE"],
    ["a malformed geocoding payload", async () => response({ results: "invalid" }), "WEATHER_RESPONSE_INVALID"],
    ["a body that is not JSON", async () => response("<html>private</html>"), "WEATHER_RESPONSE_INVALID"],
    ["an oversized body", async () => response("x".repeat(WEATHER_MAX_RESPONSE_CHARACTERS + 1)), "WEATHER_RESPONSE_INVALID"]
  ])("returns a controlled failure for %s without provider details", async (_name, fetch, code) => {
    const result = await createWeatherService({ fetch: fetch as never }).getWeather({ location: "Cali" });
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toMatch(/private|open-meteo|Cali|html/u);
  });

  it("maps a missing or unsupported forecast to controlled failures and a request timeout to its own code", async () => {
    await expect(createWeatherService({ fetch: providerFor(pastoPayload, { current: {}, daily: {} }) }).getWeather({})).resolves.toMatchObject({
      ok: false,
      error: { code: "WEATHER_RESPONSE_INVALID" }
    });
    const unsupported = { ...forecastPayload, current: { ...forecastPayload.current, weather_code: 7 } };
    await expect(createWeatherService({ fetch: providerFor(pastoPayload, unsupported) }).getWeather({})).resolves.toMatchObject({
      ok: false,
      error: { code: "WEATHER_CONDITION_UNSUPPORTED" }
    });
    const timeoutService = createWeatherService({
      timeoutMs: 1,
      fetch: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("private")))) as never
    });
    await expect(timeoutService.getWeather({})).resolves.toMatchObject({ ok: false, error: { code: "WEATHER_TIMEOUT" } });
  });

  it.each([
    [{ location: "https://evil.example/x" }],
    [{ location: "Cali/../etc" }],
    [{ location: "1.2,-77.3; DROP" }],
    [{ location: "" }],
    [{ location: "   " }],
    [{ location: "x".repeat(81) }],
    [{ location: 5 }],
    [{ dayOffset: 7 }],
    [{ dayOffset: -1 }],
    [{ dayOffset: 1.5 }],
    [{ dayOffset: "1" }],
    [{ location: "Cali", unit: "F" }],
    ["Cali"],
    [null],
    [[]]
  ])("rejects invalid input %j before any request is made", async (input) => {
    const fetch = vi.fn();
    const result = await createWeatherService({ fetch: fetch as never }).getWeather(input);
    expect(result).toMatchObject({ ok: false, error: { code: "WEATHER_INPUT_INVALID" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("weather action executor", () => {
  const proposal = (input: unknown) => ({ actionId: ID, action: "GET_WEATHER" as const, input: input as never });

  it("returns the grounded service summary with no data payload", async () => {
    const executor = createWeatherActionExecutor({
      weatherService: { getWeather: async () => ({ ok: true, data: { summary: "Resumen verificado del clima." } }) },
      logError: vi.fn()
    });
    const outcome = await executor.execute(proposal({}), getActionPolicy("GET_WEATHER"));
    expect(outcome).toEqual({ actionId: ID, action: "GET_WEATHER", riskLevel: 1, status: "SUCCEEDED", userSummary: "Resumen verificado del clima." });
  });

  it("maps the closed failure taxonomy to a status and keeps the fixed Spanish message", async () => {
    const cases: Array<[string, string, "VALIDATION_FAILED" | "EXECUTION_FAILED"]> = [
      ["WEATHER_INPUT_INVALID", "No pude entender el lugar o el día para consultar el clima.", "VALIDATION_FAILED"],
      ["WEATHER_LOCATION_NOT_FOUND", "No encontré ese lugar para consultar el clima.", "VALIDATION_FAILED"],
      ["WEATHER_UNAVAILABLE", "No puedo consultar el clima en este momento.", "EXECUTION_FAILED"],
      ["WEATHER_TIMEOUT", "La consulta del clima tardó demasiado. Inténtalo de nuevo más tarde.", "EXECUTION_FAILED"],
      ["WEATHER_RESPONSE_INVALID", "No pude verificar los datos del clima en este momento.", "EXECUTION_FAILED"],
      ["WEATHER_CONDITION_UNSUPPORTED", "No pude verificar las condiciones del clima.", "EXECUTION_FAILED"]
    ];
    for (const [code, message, status] of cases) {
      const executor = createWeatherActionExecutor({
        weatherService: { getWeather: async () => ({ ok: false, error: { code, userMessage: message } }) },
        logError: vi.fn()
      });
      await expect(executor.execute(proposal({}), getActionPolicy("GET_WEATHER"))).resolves.toMatchObject({ status, errorCode: code, userSummary: message });
    }
  });

  it("contains a throwing service with a constant log line and a fixed message", async () => {
    const logError = vi.fn();
    const executor = createWeatherActionExecutor({
      weatherService: { getWeather: async () => { throw new Error("boom: Cali 3.43"); } },
      logError
    });
    const outcome = await executor.execute(proposal({ location: "Cali" }), getActionPolicy("GET_WEATHER"));
    expect(outcome).toMatchObject({ status: "EXECUTION_FAILED", errorCode: "WEATHER_UNAVAILABLE", userSummary: "No puedo consultar el clima en este momento." });
    expect(logError.mock.calls).toEqual([["Weather action execution failed."]]);
  });
});
