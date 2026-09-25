import { eq } from "drizzle-orm";

import { getDatabase, type AresDatabase } from "../database/database-client";
import { settings } from "../database/schema";
import type { VoicePreferences } from "../../shared/settings-contracts";

export const VOICE_PREFERENCES_SETTING_KEY = "voice_preferences";

export class VoicePreferencesRepositoryError extends Error {
  public constructor() {
    super("Voice preferences persistence failed.");
    this.name = "VoicePreferencesRepositoryError";
  }
}

export type VoicePreferencesRepository = {
  get: () => Promise<unknown | undefined>;
  save: (preferences: VoicePreferences) => Promise<void>;
};

const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new VoicePreferencesRepositoryError();
  }
};

/** Main-only repository for the one validated non-secret voice preference value. */
export const createVoicePreferencesRepository = (
  database: AresDatabase = getDatabase()
): VoicePreferencesRepository => ({
  get: () =>
    execute(async () => {
      const [record] = await database
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.settingKey, VOICE_PREFERENCES_SETTING_KEY))
        .limit(1);
      return record?.value;
    }),
  save: (preferences) =>
    execute(async () => {
      await database
        .insert(settings)
        .values({
          settingKey: VOICE_PREFERENCES_SETTING_KEY,
          value: preferences,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: settings.settingKey,
          set: {
            value: preferences,
            updatedAt: new Date()
          }
        });
    })
});
