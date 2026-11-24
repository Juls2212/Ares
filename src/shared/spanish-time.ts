import { foldSpanishWord } from "./text-fold";

/**
 * Spanish clock times, both ways. parseSpanishTime reads what a person says ("5 de la tarde", "cinco y media de la noche",
 * "5:30 p. m.", "17:00", "a las 17") and returns a 24-hour "HH:MM". A bare hour from 1 to 12 with no day period is
 * never guessed: it is reported as ambiguous so the assistant can ask. spokenAt writes a time the way it is said aloud,
 * in 12-hour form with the day period ("a las 5 y media de la tarde").
 */
export type SpanishTimeResult =
  | { ok: true; time: string }
  | { ok: false; reason: "TIME_INVALID" }
  | { ok: false; reason: "TIME_AMBIGUOUS"; hour: number };

const pad = (value: number): string => value.toString().padStart(2, "0");

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50 };

/** A whole number from 0 to 99 written in digits or in Spanish words ("diez", "cuarenta y cinco"). */
const parseNumber = (text: string): number | undefined => {
  const value = text.trim();
  if (/^\d{1,2}$/u.test(value)) return Number(value);
  if (Object.hasOwn(UNITS, value)) return UNITS[value];
  const compound = /^(treinta|cuarenta|cincuenta) y (\S+)$/u.exec(value);
  if (compound && Object.hasOwn(UNITS, compound[2]!) && UNITS[compound[2]!]! >= 1 && UNITS[compound[2]!]! <= 9) return TENS[compound[1]!]! + UNITS[compound[2]!]!;
  return undefined;
};

type Period = "manana" | "tarde" | "noche" | "madrugada" | "mediodia" | "am" | "pm";

/** The hour of day (0 to 23) for a 12-hour hour and a period, or undefined when that pair makes no sense. */
const hourWithPeriod = (hour: number, period: Period): number | undefined => {
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return undefined;
  switch (period) {
    case "am":
    case "manana": return hour === 12 && period === "am" ? 0 : hour;
    case "pm":
    case "tarde": return hour === 12 ? 12 : hour + 12;
    case "mediodia": return hour === 12 ? 12 : undefined;
    case "noche": return hour === 12 ? 0 : hour >= 6 ? hour + 12 : undefined;
    case "madrugada": return hour === 12 ? 0 : hour <= 5 ? hour : undefined;
  }
};

const PERIOD_PATTERN = /\s+(?:de la|del|por la|en la)\s+(manana|tarde|noche|madrugada|mediodia)$/u;

export const parseSpanishTime = (raw: unknown): SpanishTimeResult => {
  const invalid = { ok: false, reason: "TIME_INVALID" } as const;
  if (typeof raw !== "string" || raw.length > 60) return invalid;
  // "5:30 p. m." and "5 P.M." become "5:30 pm"; then dots and extra spaces go away.
  let text = foldSpanishWord(raw)
    .replace(/\b([ap])\s*\.\s*m\b\.?/gu, "$1m")
    .replace(/\b([ap])m\b\.?/gu, "$1m")
    .replace(/[.,;]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  text = text.replace(/\s+en punto\b/gu, "").replace(/^(?:alrededor de |como a |a )?(?:las|la) /u, "").replace(/\s+(?:horas|hs|h)$/u, "").trim();
  if (text === "medianoche") return { ok: true, time: "00:00" };
  if (text === "mediodia") return { ok: true, time: "12:00" };

  let period: Period | undefined;
  const meridiem = /\s*(am|pm)$/u.exec(text);
  if (meridiem) {
    period = meridiem[1] as "am" | "pm";
    text = text.slice(0, meridiem.index).trim();
  } else {
    const named = PERIOD_PATTERN.exec(text);
    if (named) {
      period = named[1] as Period;
      text = text.slice(0, named.index).trim();
    }
  }

  // Core: "H", "H:MM", "H y media", "H y cuarto", "H y N", "H menos cuarto", "H menos N".
  let hour: number | undefined;
  let minuteOffset = 0;
  let zeroPaddedClock = false;
  const colon = /^(\d{1,2}):(\d{2})$/u.exec(text);
  if (colon) {
    hour = Number(colon[1]);
    minuteOffset = Number(colon[2]);
    zeroPaddedClock = colon[1]!.length === 2;
  } else {
    const words = /^(\S+)(?: (y|menos) (.+))?$/u.exec(text);
    if (!words) return invalid;
    hour = parseNumber(words[1]!);
    if (words[2] !== undefined) {
      const amount = words[3] === "media" ? 30 : words[3] === "cuarto" ? 15 : parseNumber(words[3]!);
      if (amount === undefined || amount < 0 || amount > 59) return invalid;
      minuteOffset = words[2] === "y" ? amount : -amount;
    }
  }
  if (hour === undefined || hour < 0 || hour > 24 || minuteOffset > 59 || (minuteOffset < 0 && minuteOffset < -59)) return invalid;

  let baseHour: number;
  if (period !== undefined) {
    // With a day period the hour must be a 12-hour hour: «13 de la tarde» and «25 de la tarde» are not times.
    const resolved = hourWithPeriod(hour, period);
    if (resolved === undefined) return invalid;
    baseHour = resolved;
  } else if (hour >= 13 && hour <= 23) {
    baseHour = hour;
  } else if (hour === 0) {
    baseHour = 0;
  } else if (hour >= 1 && hour <= 12) {
    // «09:00» is a 24-hour time (that is how a model or a clock writes it); «5», «5:30» and «cinco» need a day period.
    if (zeroPaddedClock) baseHour = hour;
    else return { ok: false, reason: "TIME_AMBIGUOUS", hour };
  } else {
    return invalid;
  }
  const total = (((baseHour * 60 + minuteOffset) % 1440) + 1440) % 1440;
  return { ok: true, time: `${pad(Math.floor(total / 60))}:${pad(total % 60)}` };
};

const PERIOD_WORDS = (hour: number, minute: number): string =>
  hour === 12 && minute === 0 ? "del mediodía" : hour >= 19 ? "de la noche" : hour >= 12 ? "de la tarde" : hour >= 5 ? "de la mañana" : "de la madrugada";

/** The time as it is said, without a preposition: «5 y media de la tarde», «medianoche», «12 del mediodía». */
export const formatSpokenTime = (time: string): string => {
  const match = /^(\d{1,2}):(\d{2})/u.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 0 && minute === 0) return "medianoche";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = minute === 0 ? "" : minute === 15 ? " y cuarto" : minute === 30 ? " y media" : ` y ${minute}`;
  return `${twelve}${minutes} ${PERIOD_WORDS(hour, minute)}`;
};

/** «a las 5 y media de la tarde», «a la 1 de la tarde», «a medianoche». */
export const spokenAt = (time: string): string => {
  const spoken = formatSpokenTime(time);
  if (spoken === "medianoche") return "a medianoche";
  return /^1(?: |$)/u.test(spoken) ? `a la ${spoken}` : `a las ${spoken}`;
};

/** «las 5 de la tarde», «la 1 de la tarde», «medianoche»: for sentences like «Son las …». */
export const spokenClock = (time: string): string => {
  const spoken = formatSpokenTime(time);
  if (spoken === "medianoche") return spoken;
  return /^1(?: |$)/u.test(spoken) ? `la ${spoken}` : `las ${spoken}`;
};
