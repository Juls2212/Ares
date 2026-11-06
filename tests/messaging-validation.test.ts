import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNTRY_CODE,
  isReservedApplicationName,
  maskPhoneDigits,
  normalizeContactReference,
  normalizePhoneNumber,
  sanitizeMessageBody,
  toLookupKey,
  validateContactAliases,
  validateContactName
} from "../src/main/messaging/messaging-validation";
import { MESSAGING_FAILURES } from "../src/main/messaging/messaging-failures";

describe("phone number normalization", () => {
  it("uses a single Colombian default country code", () => {
    expect(DEFAULT_COUNTRY_CODE).toBe("57");
  });

  it.each([
    ["3001234567", "573001234567"],
    ["300 123 4567", "573001234567"],
    ["(300) 123-4567", "573001234567"],
    ["  300-123-4567  ", "573001234567"],
    ["+57 300 123 4567", "573001234567"],
    ["573001234567", "573001234567"],
    ["+1 (415) 555-0123", "14155550123"],
    ["14155550123", "14155550123"],
    ["+44 20 7946 0958", "442079460958"],
    ["+12345678", "12345678"],
    ["+123456789012345", "123456789012345"]
  ])("accepts %s as %s", (input, digits) => {
    expect(normalizePhoneNumber(input)).toEqual({ ok: true, data: digits });
  });

  it.each([
    "",
    "   ",
    "abc",
    "300-123-45a7",
    "300.123.4567",
    "1234567",
    "+1234567",
    "+1234567890123456",
    "2025550123",
    "12345678",
    "123456789",
    "0573001234567",
    "+0573001234567",
    "3001234567890123",
    "++573001234567",
    "57 3001234567 ext 5",
    "3".repeat(41)
  ])("rejects %j", (input) => {
    expect(normalizePhoneNumber(input)).toMatchObject({ ok: false, error: { code: "MESSAGING_INVALID_PHONE" } });
  });

  it.each([undefined, null, 3001234567, {}, ["3001234567"]])("rejects the non-string value %j", (input) => {
    expect(normalizePhoneNumber(input)).toMatchObject({ ok: false, error: { code: "MESSAGING_INVALID_PHONE" } });
  });

  it("explains the rule without echoing the input", () => {
    const result = normalizePhoneNumber("12345");
    expect(result).toEqual({
      ok: false,
      error: { code: "MESSAGING_INVALID_PHONE", userMessage: MESSAGING_FAILURES.MESSAGING_INVALID_PHONE }
    });
    expect(JSON.stringify(result)).not.toContain("12345");
  });

  it("masks everything but the last four digits", () => {
    expect(maskPhoneDigits("573001234567")).toBe("•••• 4567");
    expect(maskPhoneDigits("573001234567")).not.toContain("300123");
  });
});

describe("contact name rules", () => {
  it.each([
    ["Mamá", "Mamá"],
    ["  Juan   Pérez  ", "Juan Pérez"],
    ["María José O'Neil", "María José O'Neil"],
    ["Dr. López-Gómez", "Dr. López-Gómez"],
    ["Oficina 2", "Oficina 2"],
    ["A", "A"],
    ["x".repeat(40), "x".repeat(40)]
  ])("accepts %j", (input, displayName) => {
    expect(validateContactName(input)).toMatchObject({ ok: true, data: { displayName } });
  });

  it.each([
    "",
    "   ",
    "x".repeat(41),
    "Ma\u0000má",
    "Ma\nmá",
    "Ma\tmá",
    "Mamá​",
    "-Juan",
    "Mamá <b>",
    "Juan;DROP",
    "3001234567",
    "300 123 4567",
    "Mamá 3001234567",
    "...",
    "WhatsApp",
    "spotify",
    "Discord"
  ])("rejects %j", (input) => {
    expect(validateContactName(input)).toMatchObject({ ok: false, error: { code: "MESSAGING_INVALID_NAME" } });
  });

  it.each([undefined, null, 5, {}])("rejects the non-string value %j", (input) => {
    expect(validateContactName(input)).toMatchObject({ ok: false });
  });

  it("compares names without accents, case or punctuation", () => {
    expect(toLookupKey("Mamá")).toBe(toLookupKey("MAMA"));
    expect(toLookupKey("María-José")).toBe(toLookupKey("maria jose"));
    expect(validateContactName("MAMÁ")).toMatchObject({ ok: true, data: { lookupKey: toLookupKey("mama") } });
  });

  it("keeps a bare application alias for the application", () => {
    expect(isReservedApplicationName("Whats App")).toBe(true);
    expect(isReservedApplicationName("Mamá")).toBe(false);
  });

  it("limits spoken references to comparable bounded text", () => {
    expect(normalizeContactReference("  Mamá  ")).toBe("mama");
    expect(normalizeContactReference("")).toBeUndefined();
    expect(normalizeContactReference("Ma\u0000má")).toBeUndefined();
    expect(normalizeContactReference("x".repeat(100))).toBeUndefined();
    expect(normalizeContactReference(7)).toBeUndefined();
  });
});

describe("contact alias rules", () => {
  it("treats a missing list as no aliases", () => {
    expect(validateContactAliases(undefined)).toEqual({ ok: true, data: [] });
  });

  it("applies the name rules, drops repeated aliases and caps the list at three", () => {
    expect(validateContactAliases(["Madre", "madre", "Mami"])).toMatchObject({
      ok: true,
      data: [{ displayName: "Madre" }, { displayName: "Mami" }]
    });
    expect(validateContactAliases(["a", "b", "c", "d"])).toMatchObject({ ok: false, error: { code: "MESSAGING_INVALID_NAME" } });
    expect(validateContactAliases(["Madre", "3001234567"])).toMatchObject({ ok: false });
    expect(validateContactAliases("Madre")).toMatchObject({ ok: false });
  });
});

describe("message body rules", () => {
  it("keeps a plain message exactly as written", () => {
    expect(sanitizeMessageBody("llego en diez minutos")).toEqual({ ok: true, data: "llego en diez minutos" });
  });

  it("strips control and hidden characters and turns line breaks into spaces", () => {
    expect(sanitizeMessageBody("  hola\u0000 ​mamá\r\nya\tllego bien  ")).toEqual({
      ok: true,
      data: "hola mamá ya llego bien"
    });
  });

  it("accepts links because nothing here opens or sends the text", () => {
    expect(sanitizeMessageBody("mira https://example.com/a?b=1")).toMatchObject({ ok: true });
  });

  it("enforces one to one thousand characters after cleaning", () => {
    expect(sanitizeMessageBody("a")).toMatchObject({ ok: true });
    expect(sanitizeMessageBody("a".repeat(1000))).toMatchObject({ ok: true });
    for (const body of ["", "   ", "​\u0000", "a".repeat(1001), undefined, null, 4]) {
      expect(sanitizeMessageBody(body)).toMatchObject({ ok: false, error: { code: "MESSAGING_INVALID_BODY" } });
    }
  });
});
