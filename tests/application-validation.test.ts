import { describe, expect, it } from "vitest";
import {
  validateApplicationAlias,
  validateApplicationListInput,
  validateRegisterApplicationInput,
  validateUpdateApplicationInput
} from "../src/main/applications/application-validation";

const applicationId = "550e8400-e29b-41d4-a716-446655440000";
const validInput = {
  name: "  Microsoft Word  ",
  executablePath: "C:\\Program Files\\Microsoft Office\\WINWORD.EXE",
  aliases: ["  Word  ", "Documentos"],
  platform: "WINDOWS" as const
};

const expectFailureCode = <T>(
  result: { ok: boolean; error?: { code: string } },
  code: string
): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error?.code).toBe(code);
};

describe("application validation", () => {
  it("accepts valid registration input while trimming display names and aliases", () => {
    const result = validateRegisterApplicationInput(validInput);

    expect(result).toEqual({
      ok: true,
      data: {
        name: "Microsoft Word",
        executablePath: "C:\\Program Files\\Microsoft Office\\WINWORD.EXE",
        aliases: ["Word", "Documentos"],
        platform: "WINDOWS"
      }
    });
  });

  it("rejects blank text, invalid identifiers, unsupported platforms, and unknown keys", () => {
    expectFailureCode(
      validateRegisterApplicationInput({ ...validInput, name: "   " }),
      "APPLICATION_TEXT_INVALID"
    );
    expectFailureCode(
      validateUpdateApplicationInput({ applicationId: "not-a-uuid", name: "Word" }),
      "APPLICATION_IDENTIFIER_INVALID"
    );
    expectFailureCode(
      validateRegisterApplicationInput({ ...validInput, platform: "UNKNOWN" }),
      "APPLICATION_PLATFORM_INVALID"
    );
    expectFailureCode(
      validateRegisterApplicationInput({ ...validInput, command: "start word" }),
      "APPLICATION_UNKNOWN_FIELD"
    );
  });

  it.each(["WINDOWS", "MACOS", "LINUX"] as const)(
    "accepts the bounded catalog target platform %s without a path",
    (platform) => {
      expect(
        validateRegisterApplicationInput({
          name: "Spotify",
          aliases: ["spotify"],
          platform,
          launchMode: "CATALOG_APPLICATION",
          catalogKey: "SPOTIFY"
        })
      ).toEqual({
        ok: true,
        data: {
          name: "Spotify",
          aliases: ["spotify"],
          platform,
          launchMode: "CATALOG_APPLICATION",
          catalogKey: "SPOTIFY"
        }
      });
    }
  );

  it("enforces exclusive legacy executable and catalog target combinations", () => {
    expect(
      validateRegisterApplicationInput({
        ...validInput,
        launchMode: "WINDOWS_EXECUTABLE"
      })
    ).toMatchObject({ ok: true });

    for (const input of [
      { ...validInput, platform: "MACOS" },
      { ...validInput, catalogKey: "SPOTIFY" },
      {
        name: "Spotify",
        aliases: ["spotify"],
        launchMode: "CATALOG_APPLICATION",
        catalogKey: "SPOTIFY"
      },
      {
        name: "Spotify",
        aliases: ["spotify"],
        platform: "LINUX",
        launchMode: "CATALOG_APPLICATION"
      },
      {
        name: "Spotify",
        aliases: ["spotify"],
        platform: "LINUX",
        launchMode: "CATALOG_APPLICATION",
        catalogKey: "SPOTIFY",
        executablePath: "C:\\Program Files\\Spotify\\Spotify.exe"
      },
      {
        name: "Spotify",
        aliases: ["spotify"],
        platform: "LINUX",
        launchMode: "SHELL_COMMAND",
        catalogKey: "SPOTIFY"
      },
      {
        name: "Unknown",
        aliases: ["unknown"],
        platform: "LINUX",
        launchMode: "CATALOG_APPLICATION",
        catalogKey: "CUSTOM_APPLICATION"
      }
    ]) {
      expect(validateRegisterApplicationInput(input)).toMatchObject({ ok: false });
    }
  });

  it("rejects commands, protocols, arguments, and paths for catalog-managed targets", () => {
    const target = {
      name: "Spotify",
      aliases: ["spotify"],
      platform: "WINDOWS",
      launchMode: "CATALOG_APPLICATION",
      catalogKey: "SPOTIFY"
    };

    for (const input of [
      { ...target, command: "spotify" },
      { ...target, arguments: ["--safe"] },
      { ...target, protocol: "spotify:" }
    ]) {
      expectFailureCode(validateRegisterApplicationInput(input), "APPLICATION_UNKNOWN_FIELD");
    }
    expectFailureCode(
      validateRegisterApplicationInput({
        ...target,
        executablePath: "C:\\Program Files\\Spotify\\Spotify.exe"
      }),
      "APPLICATION_EXECUTABLE_PATH_INVALID"
    );
  });

  it("rejects duplicate aliases after normalized comparison", () => {
    expectFailureCode(
      validateRegisterApplicationInput({ ...validInput, aliases: ["Word", " word "] }),
      "APPLICATION_DUPLICATE_ALIAS"
    );
  });

  it.each([
    "word.exe",
    ".\\word.exe",
    "C:/Program Files/Word.exe",
    "C:\\Program Files\\Word.exe --safe",
    "\"C:\\Program Files\\Word.exe\"",
    "https://example.test/Word.exe",
    "%PROGRAMFILES%\\Word.exe",
    "C:\\Program Files\\Word.cmd",
    "C:\\Program Files\\Word.exe; calc.exe",
    "C:\\Program Files\\Word.exe\ncalc.exe",
    " C:\\Program Files\\Word.exe"
  ])("rejects unsafe executable path input: %s", (executablePath) => {
    expectFailureCode(
      validateRegisterApplicationInput({ ...validInput, executablePath }),
      "APPLICATION_EXECUTABLE_PATH_INVALID"
    );
  });

  it("validates update and list input boundaries without coercing unknown values", () => {
    expect(validateUpdateApplicationInput({ applicationId, isEnabled: false })).toEqual({
      ok: true,
      data: { applicationId, isEnabled: false }
    });
    expectFailureCode(validateUpdateApplicationInput({ applicationId }), "APPLICATION_UPDATE_EMPTY");
    expect(validateApplicationListInput({ enabled: true, favorite: false, limit: 25 })).toEqual({
      ok: true,
      data: { enabled: true, favorite: false, limit: 25 }
    });
    expectFailureCode(validateApplicationListInput({ limit: 101 }), "APPLICATION_FIELD_TYPE_INVALID");
    expectFailureCode(validateApplicationAlias("  "), "APPLICATION_TEXT_INVALID");
  });
});
