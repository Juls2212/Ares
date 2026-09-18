import { describe, expect, it } from "vitest";
import { toApplicationRecord } from "../src/main/applications/application-repositories";

describe("application repository mapping", () => {
  it("maps persistence rows to public records without an executable path", () => {
    const executablePath = "C:\\Program Files\\Ares Tests\\private.exe";
    const record = toApplicationRecord(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        name: "Private path test",
        executablePath,
        platform: "WINDOWS",
        isFavorite: false,
        isEnabled: true,
        lastLaunchedAt: null,
        createdAt: new Date("2026-09-17T14:30:00.000Z"),
        updatedAt: new Date("2026-09-17T14:30:00.000Z")
      },
      [
        {
          id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
          applicationId: "550e8400-e29b-41d4-a716-446655440000",
          alias: "Private test",
          createdAt: new Date("2026-09-17T14:30:00.000Z")
        }
      ]
    );

    expect(record).toMatchObject({
      id: "550e8400-e29b-41d4-a716-446655440000",
      aliases: [{ alias: "Private test" }]
    });
    expect("executablePath" in record).toBe(false);
    expect(JSON.stringify(record)).not.toContain(executablePath);
  });
});
