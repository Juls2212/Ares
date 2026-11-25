/**
 * App identity, shared by Main and by forge.config.ts so that the installer and the running app always agree.
 * Pure constants: no Electron import, safe to load from the Forge configuration.
 */

/** The user-facing product name. */
export const PRODUCT_NAME = "Ares";

/** The executable file name without ".exe". Kept as "ares-desktop" so existing paths, scripts and docs stay valid. */
export const EXECUTABLE_NAME = "ares-desktop";

/** The Squirrel package id: letters only. It names the install folder and the shortcuts. */
export const SQUIRREL_PACKAGE_NAME = "Ares";

/** The installer file name; the permanent GitHub Release download link depends on it never changing. */
export const SETUP_EXE_NAME = "Ares-Setup.exe";

/**
 * The Windows AppUserModelID. Squirrel gives the shortcuts it creates the id "com.squirrel.<package>.<executable>",
 * and Windows only groups the taskbar button and delivers notifications for the running app when
 * app.setAppUserModelId uses the very same string. Both sides derive it from the two constants above.
 */
export const APP_USER_MODEL_ID = `com.squirrel.${SQUIRREL_PACKAGE_NAME}.${EXECUTABLE_NAME}`;
