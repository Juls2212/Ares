import { collapseAndTrim } from "../../shared/text-fold";
import {
  WEATHER_MAX_DAY_OFFSET,
  WEATHER_MAX_LOCATION_LENGTH,
  type GetWeatherInput
} from "../../shared/action-contracts";

/** Letters, digits, spaces and a few name punctuation marks; no URL, path, coordinate or markup characters. */
const LOCATION_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .,'’-]*$/u;

export const normalizeWeatherLocation = (value: string): string => collapseAndTrim(value);

/** Closed validator for the read-only weather query: only `location` and `dayOffset`, both bounded. */
export const validateWeatherInput = (input: unknown): { ok: true; data: GetWeatherInput } | { ok: false } => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false };
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "location" && key !== "dayOffset")) return { ok: false };
  const data: GetWeatherInput = {};
  if (record.location !== undefined) {
    if (typeof record.location !== "string") return { ok: false };
    const location = normalizeWeatherLocation(record.location);
    if (location.length === 0 || location.length > WEATHER_MAX_LOCATION_LENGTH || !LOCATION_PATTERN.test(location)) return { ok: false };
    data.location = location;
  }
  if (record.dayOffset !== undefined) {
    if (typeof record.dayOffset !== "number" || !Number.isInteger(record.dayOffset) || record.dayOffset < 0 || record.dayOffset > WEATHER_MAX_DAY_OFFSET) {
      return { ok: false };
    }
    data.dayOffset = record.dayOffset;
  }
  return { ok: true, data };
};
