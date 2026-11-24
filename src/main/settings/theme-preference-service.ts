import { eq } from "drizzle-orm";

import { getDatabase } from "../database/database-client";
import { settings } from "../database/schema";
import { DEFAULT_THEME_PREFERENCE, isThemePreference, type ThemePreference } from "../window-theme";

export const THEME_PREFERENCE_SETTING_KEY = "theme_preference";

export type ThemePreferenceStore = {
  get: () => Promise<unknown>;
  save: (preference: ThemePreference) => Promise<void>;
};

/** Main-only store for the one non-secret theme preference, in the existing settings table. */
export const createThemePreferenceStore = (): ThemePreferenceStore => ({
  get: async () => {
    const [record] = await getDatabase().select({ value: settings.value }).from(settings).where(eq(settings.settingKey, THEME_PREFERENCE_SETTING_KEY)).limit(1);
    return record?.value;
  },
  save: async (preference) => {
    await getDatabase().insert(settings).values({ settingKey: THEME_PREFERENCE_SETTING_KEY, value: preference, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.settingKey, set: { value: preference, updatedAt: new Date() } });
  }
});

export type ThemePreferenceService = {
  /** Reads the saved preference and applies it. It never throws: any problem means "system". */
  initialize: () => Promise<ThemePreference>;
  /** Applies the preference at once, then tries to persist it. NOT_SAVED means it applies for this session only. */
  set: (preference: unknown) => Promise<"SAVED" | "NOT_SAVED" | "INVALID">;
  get: () => ThemePreference;
};

export const createThemePreferenceService = (dependencies: {
  store: () => ThemePreferenceStore;
  nativeTheme: { themeSource: ThemePreference };
  /** Called after the theme source changed, to update the window background and the title bar. */
  onApplied: () => void;
  logError: (message: string) => void;
}): ThemePreferenceService => {
  let current: ThemePreference = DEFAULT_THEME_PREFERENCE;
  const apply = (preference: ThemePreference): void => {
    current = preference;
    dependencies.nativeTheme.themeSource = preference;
    try { dependencies.onApplied(); } catch { dependencies.logError("Applying the theme failed."); }
  };
  return {
    initialize: async () => {
      let saved: unknown;
      try { saved = await dependencies.store().get(); } catch { dependencies.logError("Theme preference could not be read."); }
      apply(isThemePreference(saved) ? saved : DEFAULT_THEME_PREFERENCE);
      return current;
    },
    set: async (preference) => {
      if (!isThemePreference(preference)) return "INVALID";
      apply(preference);
      try { await dependencies.store().save(preference); return "SAVED"; } catch { dependencies.logError("Theme preference could not be saved."); return "NOT_SAVED"; }
    },
    get: () => current
  };
};
