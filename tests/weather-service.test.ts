import { describe, expect, it, vi } from "vitest";
import {
  WEATHER_LOCATION,
  WEATHER_CACHE_TTL_MS,
  composeWeatherSummary,
  createWeatherService,
  mapWeatherCode
} from "../src/main/weather/weather-service";
import { createWeatherActionExecutor } from "../src/main/actions/weather-action-executor";
import { getActionPolicy } from "../src/main/actions/action-policy";

const locationPayload = {
  results: [{ name: "Pasto", country_code: "CO", latitude: 1.2136, longitude: -77.2811 }]
};

const forecastPayload = {
  current: { temperature_2m: 16, apparent_temperature: 15.4, weather_code: 61 },
  daily: {
    temperature_2m_min: [10],
    temperature_2m_max: [18],
    precipitation_probability_max: [65]
  }
};

const response = (payload: unknown, ok = true) => ({ ok, json: async () => payload });

describe("weather service", () => {
  it("uses the fixed Main-owned Pasto, Colombia location and composes verified current and today data", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("geocoding-api") ? response(locationPayload) : response(forecastPayload)
    );
    const service = createWeatherService({ fetch });

    const result = await service.getTodayWeather();

    expect(result).toEqual({
      ok: true,
      data: {
        summary: "En Pasto ahora está con lluvia ligera, con 16 °C y sensación de 15,4 °C. Hoy se esperan entre 10 °C y 18 °C, con hasta 65 % de probabilidad de precipitación."
      }
    });
    const geocoding = new URL(fetch.mock.calls[0][0]);
    const forecast = new URL(fetch.mock.calls[1][0]);
    expect(geocoding.searchParams.get("name")).toBe(WEATHER_LOCATION.city);
    expect(geocoding.searchParams.get("countryCode")).toBe(WEATHER_LOCATION.countryCode);
    expect(forecast.searchParams.get("timezone")).toBe(WEATHER_LOCATION.timeZone);
    expect(forecast.searchParams.get("current")).toBe("temperature_2m,apparent_temperature,weather_code");
    expect(forecast.searchParams.get("daily")).toBe("temperature_2m_min,temperature_2m_max,precipitation_probability_max");
    expect(JSON.stringify(result)).not.toContain("latitude");
    expect(JSON.stringify(result)).not.toContain("longitude");
  });

  it("maps supported WMO weather codes deterministically", () => {
    const base = {
      currentTemperature: 16,
      apparentTemperature: 16,
      minimumTemperature: 10,
      maximumTemperature: 18,
      precipitationProbability: 20
    };
    expect(mapWeatherCode(0)).toBe("despejado");
    expect(mapWeatherCode(61)).toBe("con lluvia ligera");
    expect(mapWeatherCode(99)).toBe("con tormenta y granizo intenso");
    expect(mapWeatherCode(999)).toBeUndefined();
    expect(composeWeatherSummary({ ...base, condition: mapWeatherCode(0)! })).toContain("ahora está despejado");
  });

  it("caches only successful location and forecast data for a bounded interval", async () => {
    let now = 0;
    const fetch = vi.fn(async (url: string) =>
      url.includes("geocoding-api") ? response(locationPayload) : response(forecastPayload)
    );
    const service = createWeatherService({ fetch, now: () => now });
    await service.getTodayWeather();
    now = WEATHER_CACHE_TTL_MS - 1;
    await service.getTodayWeather();
    expect(fetch).toHaveBeenCalledTimes(2);
    now = WEATHER_CACHE_TTL_MS;
    await service.getTodayWeather();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["network", async () => { throw new Error("private network detail"); }, "WEATHER_UNAVAILABLE"],
    ["malformed", async () => (response({ results: "invalid" })), "WEATHER_RESPONSE_INVALID"],
    ["unresolved", async () => response({ results: [] }), "WEATHER_LOCATION_UNRESOLVED"]
  ])("returns a controlled %s failure without provider details", async (_name, fetch, code) => {
    const service = createWeatherService({ fetch: fetch as never });
    const result = await service.getTodayWeather();
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("open-meteo");
  });

  it("maps a bounded request timeout and missing forecast fields to controlled failures", async () => {
    const timeoutService = createWeatherService({
      timeoutMs: 1,
      fetch: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("private")))) as never
    });
    await expect(timeoutService.getTodayWeather()).resolves.toMatchObject({ ok: false, error: { code: "WEATHER_TIMEOUT" } });

    const malformedService = createWeatherService({
      fetch: vi.fn(async (url: string) =>
        url.includes("geocoding-api") ? response(locationPayload) : response({ current: {}, daily: {} })
      )
    });
    await expect(malformedService.getTodayWeather()).resolves.toMatchObject({ ok: false, error: { code: "WEATHER_RESPONSE_INVALID" } });
  });

  it("returns the grounded service summary through the typed weather action without exposing provider data", async () => {
    const executor = createWeatherActionExecutor({
      weatherService: {
        getTodayWeather: async () => ({ ok: true, data: { summary: "Resumen verificado del clima." } })
      },
      logError: vi.fn()
    });
    const outcome = await executor.execute(
      { actionId: "11111111-1111-4111-8111-111111111111", action: "GET_WEATHER", input: {} },
      getActionPolicy("GET_WEATHER")
    );
    expect(outcome).toMatchObject({ status: "SUCCEEDED", userSummary: "Resumen verificado del clima." });
    expect(outcome.data).toBeUndefined();
  });
});
