# Deployment

How to build the packaged Windows app and what it needs at runtime.

## Why dependencies are bundled

The packaged app is an `app.asar` that contains only `.vite/build/main.js`, `.vite/build/preload.js`, the renderer build and `package.json`. It has **no `node_modules`**. Any package that Main or preload left as a bare `require()` would fail at startup with `Cannot find module '<name>'`.

So every npm dependency (`pg`, `drizzle-orm`, `openai`, `dotenv`, ...) is bundled into `main.js` by Vite. The only externals are defined once, in `vite.externals.ts`, and both `vite.main.config.ts` and `vite.preload.config.ts` use that list:

| External | Why |
| --- | --- |
| Node built-ins (with and without `node:`) | Provided by the runtime. |
| `electron` | Provided by the runtime. |

Nothing else may be external. An external module is hoisted by the CommonJS interop to a `require()` at the top of `main.js`, so it is required at startup even if the dependency only meant to load it lazily.

### Stubs for optional `pg` modules

`pg` references two optional packages that must not exist in the packaged app. They are replaced inside the bundle by virtual stubs (`vite.stubs.ts`, a small Vite plugin applied to Main):

| Module | How `pg` uses it | Stub |
| --- | --- | --- |
| `pg-cloudflare` | Required only when running in a Cloudflare Worker, never in Electron. | Empty export, never read. |
| `pg-native` | Required only by the lazy `pg.native` getter (inside a try/catch for `MODULE_NOT_FOUND`) or when `NODE_PG_FORCE_NATIVE` is set. Ares uses neither. | A constructor that throws `MODULE_NOT_FOUND` when used. Evaluating it at startup does nothing. |

The default JavaScript client is therefore unchanged.

## Build

```powershell
npm run package
```

The output lands in `out\ares-desktop-win32-x64\` (the executable is `ares-desktop.exe`). If packaging fails with `EBUSY ... rmdir`, a previous packaged copy is still running (a minimized Ares keeps running in the background); quit it from the tray icon, or close its window, and run the command again.

## Build the installer

Close Ares (press the X of its window, or quit it from the tray icon), delete the `out` folder, then run:

```powershell
npm run make
```

| Output | What it is |
| --- | --- |
| `out\make\squirrel.windows\x64\Ares-Setup.exe` | The installer. Its name is fixed (`SETUP_EXE_NAME` in `src/main/app-identity.ts`), so the download link never changes. |
| `out\make\squirrel.windows\x64\Ares-<version>-full.nupkg` and `RELEASES` | Squirrel update metadata. Needed only if updates are ever served from the release; not needed to install. |
| `out\make\zip\win32\x64\ares-desktop-win32-x64-<version>.zip` | Portable copy: unzip and run `ares-desktop.exe`. |

`npm run make` runs the whole packaging first, so run `node scripts\scan-bundle.cjs`, `node scripts\smoke-main-load.cjs` and `node scripts\smoke-pglite.cjs` afterwards as described below.

### Identity

- The installed app is named **Ares** (Windows file metadata and the Squirrel title). The executable and the packaged folder keep the name `ares-desktop`, so existing scripts and paths stay valid.
- The Squirrel package id is `Ares` (letters only). It installs per user, with no administrator prompt, under `%LOCALAPPDATA%\Ares`, and creates a Desktop shortcut and a Start Menu shortcut named Ares.
- The Windows AppUserModelID is `com.squirrel.Ares.ares-desktop`. Both `forge.config.ts` and `app.setAppUserModelId` in Main derive it from the same constants in `src/main/app-identity.ts`, and it equals the id Squirrel gives its shortcuts, so the taskbar button and notifications belong to the app.
- There is no icon asset in the repository, so the installer, executable and shortcuts use the default Electron icon. Adding a `.ico` and pointing `packagerConfig.icon` and the Squirrel `setupIcon` at it is the only change needed.

### Installer events and single instance

- Squirrel starts the executable with `--squirrel-install`, `--squirrel-updated`, `--squirrel-uninstall`, `--squirrel-obsolete` or `--squirrel-firstrun`. `src/main/squirrel-startup.ts` handles them at the very top of Main, before any window, service or IPC handler exists: install and update create the shortcuts, uninstall removes them, both through `Update.exe` (the file next to the app folder), then the app quits. Obsolete just quits. First run is a normal start. No dependency was added.
- This is not a process-launch capability of the app. The trigger is the process's own command-line flag matched against that closed list; the only program started is `Update.exe`, with arguments from a fixed table plus the running executable's own file name (validated against a strict pattern), no shell. Nothing in the renderer, the preload, the IPC channels, the voice commands or the model output can reach it, and a test checks that only `main.ts` calls it.
- Closing the window (the X button, Alt+F4, the taskbar) quits Ares completely, with no process, tray icon or global shortcut left behind. Minimizing keeps it running in the background. See "Window lifecycle" in ARCHITECTURE.md.
- Ares allows one running copy. A second launch asks the first to restore and focus its window (the same path as the tray's Open command) and exits.

### Where the installed app writes

Only to `%APPDATA%\ares-desktop` (the database folder and an optional `ares.env`). The install folder is never written to, which also keeps updates and uninstall clean.

## Publish a release

1. Build as above and keep `Ares-Setup.exe` and the zip.
2. On GitHub, open the repository, go to Releases, choose "Draft a new release", create a tag such as `v0.1.0`, and attach `Ares-Setup.exe` and the zip as assets. Publish the release.
3. The permanent download link always points to the newest release's installer:

```text
https://github.com/<user>/<repo>/releases/latest/download/Ares-Setup.exe
```

Replace `<user>` and `<repo>`. The file name must stay exactly `Ares-Setup.exe` for the link to keep working.

## Install, configure, uninstall

**Install.** Run `Ares-Setup.exe`. The installer is not code-signed, so Windows SmartScreen may show "Windows protected your PC": choose **More info**, then **Run anyway**. Ares installs for the current user, starts, and adds Desktop and Start Menu shortcuts.

**Configure keys (optional).** Ares works without any key, in local mode. To enable the cloud features, create a plain-text file named `ares.env` in `%APPDATA%\ares-desktop` with `NAME=value` lines (`#` starts a comment) and restart Ares. The names it accepts are:

- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSCRIPTION_MODEL`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- `SPOTIFY_CLIENT_ID`
- `DATABASE_URL` (only to use a PostgreSQL server instead of the built-in database)

Windows environment variables with the same names take priority over the file.

**Uninstall.** Windows Settings, Apps, Installed apps, Ares, Uninstall (or Control Panel, Programs and Features). This removes the app and its shortcuts. Your data stays in `%APPDATA%\ares-desktop`; delete that folder too for a complete removal.

## Check the build without launching it

```powershell
node scripts\scan-bundle.cjs
node scripts\smoke-main-load.cjs
```

Both scripts are read-only and print repository-relative paths only.

- `scan-bundle.cjs` lists every bare specifier in `.vite\build\main.js`, `.vite\build\preload.js` and the copies inside `app.asar`, lists the top level of `app.asar` and prints sizes. There is no allowlist: anything that is not a Node built-in or `electron` makes it exit with code 1.
- `smoke-main-load.cjs` loads `main.js` (the built file and the asar copy) without starting Electron. `electron` is an inert stub (`whenReady()` never resolves, so no window opens), network and process-spawning built-ins are blocked, and Node's resolver is restricted so any other `require` fails and is reported by name. This is the check that catches a bundle requiring a package the asar does not contain.

## Database driver and where the data lives

The driver is chosen in one place, `selectDatabaseDriver()` (`src/main/database/database-driver.ts`):

| `DATABASE_URL` | Driver | Log line |
| --- | --- | --- |
| set (process environment, development `.env`, or `ares.env`) | PostgreSQL through `pg`, exactly as before | `Database driver [POSTGRES]` |
| unset or blank | embedded PGlite (PostgreSQL compiled to WebAssembly) | `Database driver [PGLITE]` |

Both produce a Drizzle database assignable to the single `AresDatabase` type (`PgDatabase`), so repositories are unchanged and no adapter exists. The packaged app therefore needs no PostgreSQL and no `.env`.

PGlite keeps its data in the `database\pglite` folder inside the Electron `userData` directory (`%APPDATA%\ares-desktop`, named after the app's `package.json` name). The location is validated to stay inside `userData`, and it is never logged. Nothing is written into the install folder.

On start, Main awaits `prepareDatabase()` before any service runs: it waits for PGlite and applies every migration from the `drizzle` folder shipped with the app (Drizzle's `pglite` migrator, recorded in its own migrations table, so it is idempotent). With PostgreSQL this step does nothing; migrations there are still applied with `npm run db:migrate`. All ten existing migrations use only enums, `gen_random_uuid()`, partial and btree indexes and CHECK constraints, which PGlite supports; none had to change.

### How PGlite's files ship

PGlite finds `pglite.wasm`, `initdb.wasm` and `pglite.data` relative to its own module, which breaks once bundled. The package is bundled into `main.js` (its CommonJS build, chosen by `vite.stubs.ts`), and the three files are passed to the constructor explicitly (`pgliteWasmModule`, `initdbWasmModule`, `fsBundle`) by one helper, `src/main/database/pglite-assets.mjs`, which Main and `scripts/smoke-pglite.cjs` share. Forge copies them, plus the `drizzle` folder, to `resources` through `extraResource`:

- packaged: read from `process.resourcesPath` (flat: the three files and `drizzle\`)
- development: read from `node_modules\@electric-sql\pglite\dist` and `.\drizzle`

Asar stays enabled; the externals stay Node built-ins and `electron`.

### Check the embedded database without Electron

```powershell
node scripts\smoke-pglite.cjs
node scripts\smoke-pglite.cjs --resources out\ares-desktop-win32-x64\resources
```

The first uses the development layout; the second uses the files that were packaged. Each creates a temporary directory outside the repository, opens PGlite, runs all migrations, inserts and reads one row, deletes the directory and prints `pglite smoke: ok` or the failing step. No network is used.

## Configuration in the packaged app

In development, Main reads a project `.env` through `dotenv`. In a packaged app it does **not**: `main.ts` calls `markPackagedRuntime(app.isPackaged, userDataPath)` first. A missing `.env` never crashes the packaged app, and a stray `.env` in the launch folder is never read.

The packaged app reads these names, in this order of priority:

1. the process environment (Windows environment variables inherited from the launcher);
2. an optional plain-text file named `ares.env` in the `userData` directory: `KEY=VALUE` lines, `#` comments, optional single or double quotes. It is read again on each use, so an edit applies without a restart. A missing file is not an error. Neither values nor the path are logged.

Names accepted from `ares.env` (any other name in the file is ignored):

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_TRANSCRIPTION_MODEL` (optional)
- `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` (optional; both required to use ElevenLabs)
- `SPOTIFY_CLIENT_ID` (optional)
- `DATABASE_URL` (optional; setting it switches the app to PostgreSQL)

Without `OPENAI_API_KEY` the app still works in local mode (offline local brain, typed input, system voice).

## Run the packaged app

Start it with or without those variables (none are required to open the app):

```powershell
.\out\ares-desktop-win32-x64\ares-desktop.exe
```

## Known limits

- The embedded database is single-process: one running copy of Ares owns the data folder. Data in PGlite is not shared with a PostgreSQL database and there is no automatic export or import between the two.
- Opening PGlite compiles about 10 MB of WebAssembly, which adds a short delay to the first start.
- The installer and the executable are not code-signed, so SmartScreen warns on first run.
- The installer, the shortcuts and the executable use the default Electron icon until an icon asset is added.
- Automatic updates are not wired: the update metadata is produced, but the app does not check for or download updates.
- The installer targets 64-bit Windows only. Building it was checked by listing the output; it has not been installed or launched here.
- A missing variable is reported when the feature that needs it is first used, not at startup.
- The scan reads text and the smoke script runs only the module body of `main.js` with stubs; neither proves that a lazy code path works. Launching the app is still the final check.
