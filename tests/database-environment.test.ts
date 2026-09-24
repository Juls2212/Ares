import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { describe, expect, it, vi } from "vitest";
import {
  MainConfigurationError,
  getDatabaseUrl
} from "../src/main/config/database-environment";

vi.mock("dotenv", () => ({
  default: { config: vi.fn() }
}));

const readSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return readSourceFiles(entryPath);
    }

    return /\.(ts|tsx)$/.test(entry.name) ? [readFileSync(entryPath, "utf8")] : [];
  });

describe("Main database environment", () => {
  it("rejects a missing database URL with a controlled internal error", () => {
    expect(() => getDatabaseUrl({})).toThrow(MainConfigurationError);

    try {
      getDatabaseUrl({});
    } catch (error) {
      expect(error).toMatchObject({
        code: "DATABASE_URL_MISSING",
        message: "DATABASE_URL is required before database access."
      });
    }
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() => getDatabaseUrl({ DATABASE_URL: "mysql://example/app" })).toThrow(
      "DATABASE_URL must be a PostgreSQL URL with a host and database name."
    );
  });

  it("accepts a valid PostgreSQL database URL", () => {
    const databaseUrl = "postgresql://ares:local-password@127.0.0.1:5433/ares_development";

    expect(getDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(databaseUrl);
  });

  it("loads the trusted local environment only for the default Main-process environment", () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const databaseUrl = "postgresql://ares:local-password@127.0.0.1:5433/ares_development";
    vi.mocked(dotenv.config).mockClear();
    process.env.DATABASE_URL = databaseUrl;

    try {
      expect(getDatabaseUrl()).toBe(databaseUrl);
      expect(dotenv.config).toHaveBeenCalledWith({ quiet: true });
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    }
  });

  it("does not expose a supplied password through configuration errors", () => {
    const password = "do-not-expose-this-password";
    let errorOutput = "";

    try {
      getDatabaseUrl({ DATABASE_URL: `mysql://ares:${password}@127.0.0.1/ares_development` });
    } catch (error) {
      errorOutput = String(error);
    }

    expect(errorOutput).not.toContain(password);
    expect(errorOutput).not.toContain("127.0.0.1");
  });

  it("keeps Main environment configuration out of renderer and preload source", () => {
    const untrustedSource = [
      ...readSourceFiles(path.resolve(process.cwd(), "src/renderer")),
      ...readSourceFiles(path.resolve(process.cwd(), "src/preload"))
    ].join("\n");

    expect(untrustedSource).not.toContain("main/config");
    expect(untrustedSource).not.toContain("database-environment");
    expect(untrustedSource).not.toContain("VITE_DATABASE_URL");
  });

  it("does not define a Vite database URL in runtime or tooling configuration", () => {
    const runtimeAndToolingSource = [
      ...readSourceFiles(path.resolve(process.cwd(), "src")),
      readFileSync(path.resolve(process.cwd(), "drizzle.config.ts"), "utf8")
    ].join("\n");

    expect(runtimeAndToolingSource).not.toContain("VITE_DATABASE_URL");
  });
});
