import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient, PoolConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  createDatabaseClient,
  type AresDatabase
} from "../src/main/database/database-client";
import * as schema from "../src/main/database/schema";

const developmentDatabaseUrl =
  "postgresql://ares:local-development-password@127.0.0.1:5433/ares_development";

type MockPoolSetup = {
  connectError?: Error;
  queryError?: Error;
  endError?: Error;
};

const createMockPool = (setup: MockPoolSetup = {}) => {
  const release = vi.fn();
  const query = setup.queryError
    ? vi.fn().mockRejectedValue(setup.queryError)
    : vi.fn().mockResolvedValue({ rows: [] });
  const client = { query, release } as unknown as PoolClient;
  const connect = setup.connectError
    ? vi.fn().mockRejectedValue(setup.connectError)
    : vi.fn().mockResolvedValue(client);
  const end = setup.endError
    ? vi.fn().mockRejectedValue(setup.endError)
    : vi.fn().mockResolvedValue(undefined);
  const pool = { connect, end } as unknown as Pool;

  return { pool, connect, query, release, end };
};

const createClientDependencies = (pool: Pool) => {
  const database = drizzle.mock({ schema }) as AresDatabase;
  const createPool = vi.fn((_configuration: PoolConfig) => pool);
  const createDatabase = vi.fn((_pool: Pool) => database);
  const getDatabaseUrl = vi.fn(() => developmentDatabaseUrl);
  const logError = vi.fn();

  return {
    database,
    createPool,
    createDatabase,
    getDatabaseUrl,
    logError
  };
};

describe("Main database client", () => {
  it("creates one lazy pool and reuses its typed Drizzle database while active", () => {
    const mockPool = createMockPool();
    const dependencies = createClientDependencies(mockPool.pool);
    const client = createDatabaseClient(dependencies);

    expect(dependencies.createPool).not.toHaveBeenCalled();

    const firstDatabase = client.getDatabase();
    const secondDatabase = client.getDatabase();

    expect(firstDatabase).toBe(dependencies.database);
    expect(secondDatabase).toBe(dependencies.database);
    expect(dependencies.getDatabaseUrl).toHaveBeenCalledTimes(1);
    expect(dependencies.createPool).toHaveBeenCalledWith({
      connectionString: developmentDatabaseUrl
    });
    expect(dependencies.createDatabase).toHaveBeenCalledTimes(1);
    expect(dependencies.createDatabase).toHaveBeenCalledWith(mockPool.pool);
  });

  it("verifies connectivity with a minimal query and releases the acquired client", async () => {
    const mockPool = createMockPool();
    const dependencies = createClientDependencies(mockPool.pool);
    const client = createDatabaseClient(dependencies);

    await expect(client.verifyConnection()).resolves.toEqual({ ok: true });

    expect(mockPool.query).toHaveBeenCalledWith("SELECT 1");
    expect(mockPool.release).toHaveBeenCalledTimes(1);
  });

  it("maps connectivity failures without exposing credentials or raw error details", async () => {
    const password = "do-not-expose-this-password";
    const mockPool = createMockPool({
      queryError: new Error(`connection rejected for ${password}`)
    });
    const dependencies = createClientDependencies(mockPool.pool);
    const client = createDatabaseClient(dependencies);

    const result = await client.verifyConnection();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "DATABASE_CONNECTION_UNAVAILABLE",
        message: "Database connectivity verification failed."
      }
    });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(dependencies.logError).toHaveBeenCalledWith(
      "Database connectivity verification failed."
    );
    expect(JSON.stringify(dependencies.logError.mock.calls)).not.toContain(password);
    expect(mockPool.release).toHaveBeenCalledTimes(1);
  });

  it("closes the active pool once and allows a fresh lazy pool after shutdown", async () => {
    const firstPool = createMockPool();
    const secondPool = createMockPool();
    const firstDependencies = createClientDependencies(firstPool.pool);
    const createPool = vi
      .fn()
      .mockReturnValueOnce(firstPool.pool)
      .mockReturnValueOnce(secondPool.pool);
    const client = createDatabaseClient({ ...firstDependencies, createPool });

    client.getDatabase();
    await expect(client.close()).resolves.toEqual({ ok: true });
    await expect(client.close()).resolves.toEqual({ ok: true });
    client.getDatabase();

    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(secondPool.end).not.toHaveBeenCalled();
    expect(createPool).toHaveBeenCalledTimes(2);
    expect(firstDependencies.createDatabase).toHaveBeenCalledTimes(2);
  });

  it("maps pool shutdown failures without logging raw connection details", async () => {
    const password = "do-not-expose-this-password";
    const mockPool = createMockPool({
      endError: new Error(`pool shutdown failed for ${password}`)
    });
    const dependencies = createClientDependencies(mockPool.pool);
    const client = createDatabaseClient(dependencies);

    client.getDatabase();
    const result = await client.close();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "DATABASE_POOL_SHUTDOWN_FAILED",
        message: "Database pool shutdown failed."
      }
    });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(dependencies.logError).toHaveBeenCalledWith("Database pool shutdown failed.");
    expect(JSON.stringify(dependencies.logError.mock.calls)).not.toContain(password);
  });
});
