import { eq } from "drizzle-orm";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { settings } from "../database/schema";
import { spotifyFailure, spotifySuccess, type SpotifyResult } from "./spotify-failures";

export const SPOTIFY_CONNECTION_SETTING_KEY = "spotify_connection";

export type SpotifyTokens = { accessToken: string; refreshToken: string; expiresAt: number };

/** The slice of Electron's safeStorage the store needs; tests supply a fake. */
export type SpotifySecretStorage = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
};

/** Persists one opaque, already encrypted value in the existing settings table. */
export type SpotifyConnectionRepository = {
  get: () => Promise<unknown | undefined>;
  save: (value: { version: 1; ciphertext: string }) => Promise<void>;
  remove: () => Promise<void>;
};

export const createSpotifyConnectionRepository = (
  database: AresDatabase = getDatabase()
): SpotifyConnectionRepository => ({
  get: async () => {
    const [record] = await database
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.settingKey, SPOTIFY_CONNECTION_SETTING_KEY))
      .limit(1);
    return record?.value;
  },
  save: async (value) => {
    await database
      .insert(settings)
      .values({ settingKey: SPOTIFY_CONNECTION_SETTING_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.settingKey, set: { value, updatedAt: new Date() } });
  },
  remove: async () => {
    await database.delete(settings).where(eq(settings.settingKey, SPOTIFY_CONNECTION_SETTING_KEY));
  }
});

export type SpotifyTokenStore = {
  /** Whether secrets can be encrypted on this machine; without it nothing is ever stored. */
  canStore: () => boolean;
  load: () => Promise<SpotifyResult<SpotifyTokens | undefined>>;
  save: (tokens: SpotifyTokens) => Promise<SpotifyResult<null>>;
  clear: () => Promise<void>;
};

type StoreDependencies = {
  storage: SpotifySecretStorage;
  repository: SpotifyConnectionRepository;
  logError: (message: string) => void;
};

const isTokens = (value: unknown): value is SpotifyTokens =>
  typeof value === "object" && value !== null &&
  typeof (value as SpotifyTokens).accessToken === "string" && (value as SpotifyTokens).accessToken.length > 0 &&
  typeof (value as SpotifyTokens).refreshToken === "string" && (value as SpotifyTokens).refreshToken.length > 0 &&
  Number.isFinite((value as SpotifyTokens).expiresAt);

/**
 * Access token, refresh token and expiry are encrypted with Electron safeStorage before they reach the
 * database. When encryption is unavailable the store refuses to write: there is no plaintext fallback.
 */
export const createSpotifyTokenStore = (dependencies: StoreDependencies): SpotifyTokenStore => {
  let cache: SpotifyTokens | undefined;
  let cacheLoaded = false;

  return {
    canStore: () => {
      try {
        return dependencies.storage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    load: async () => {
      if (cacheLoaded) return spotifySuccess(cache);
      try {
        const stored = await dependencies.repository.get();
        if (stored === undefined) {
          cache = undefined;
          cacheLoaded = true;
          return spotifySuccess(undefined);
        }
        const ciphertext = typeof stored === "object" && stored !== null ? (stored as { ciphertext?: unknown }).ciphertext : undefined;
        if (typeof ciphertext !== "string" || !dependencies.storage.isEncryptionAvailable()) {
          return spotifyFailure("SPOTIFY_SECURE_STORAGE_UNAVAILABLE");
        }
        const parsed: unknown = JSON.parse(dependencies.storage.decryptString(Buffer.from(ciphertext, "base64")));
        cache = isTokens(parsed) ? parsed : undefined;
        cacheLoaded = true;
        return spotifySuccess(cache);
      } catch {
        dependencies.logError("Spotify connection could not be read.");
        return spotifyFailure("SPOTIFY_SECURE_STORAGE_UNAVAILABLE");
      }
    },
    save: async (tokens) => {
      if (!isTokens(tokens)) return spotifyFailure("SPOTIFY_UNEXPECTED_RESPONSE");
      try {
        if (!dependencies.storage.isEncryptionAvailable()) return spotifyFailure("SPOTIFY_SECURE_STORAGE_UNAVAILABLE");
        const encrypted = dependencies.storage.encryptString(JSON.stringify(tokens));
        await dependencies.repository.save({ version: 1, ciphertext: encrypted.toString("base64") });
        cache = tokens;
        cacheLoaded = true;
        return spotifySuccess(null);
      } catch {
        dependencies.logError("Spotify connection could not be stored.");
        return spotifyFailure("SPOTIFY_SECURE_STORAGE_UNAVAILABLE");
      }
    },
    clear: async () => {
      cache = undefined;
      cacheLoaded = true;
      try {
        await dependencies.repository.remove();
      } catch {
        dependencies.logError("Spotify connection could not be cleared.");
      }
    }
  };
};
