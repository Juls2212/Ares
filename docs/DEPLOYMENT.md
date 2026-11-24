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

The output lands in `out\ares-desktop-win32-x64\` (the executable is `ares-desktop.exe`). If packaging fails with `EBUSY ... rmdir`, a previous packaged copy is still running (Ares closes to the tray); quit it from the tray icon and run the command again.

## Check the build without launching it

```powershell
node scripts\scan-bundle.cjs
node scripts\smoke-main-load.cjs
```

Both scripts are read-only and print repository-relative paths only.

- `scan-bundle.cjs` lists every bare specifier in `.vite\build\main.js`, `.vite\build\preload.js` and the copies inside `app.asar`, lists the top level of `app.asar` and prints sizes. There is no allowlist: anything that is not a Node built-in or `electron` makes it exit with code 1.
- `smoke-main-load.cjs` loads `main.js` (the built file and the asar copy) without starting Electron. `electron` is an inert stub (`whenReady()` never resolves, so no window opens), network and process-spawning built-ins are blocked, and Node's resolver is restricted so any other `require` fails and is reported by name. This is the check that catches a bundle requiring a package the asar does not contain.

## Configuration in the packaged app

In development, Main reads a project `.env` through `dotenv`. In a packaged app it does **not**: `main.ts` calls `markPackagedRuntime(app.isPackaged)` first, and `loadDevelopmentEnvironment()` then does nothing. A missing `.env` therefore never crashes the packaged app, and a stray `.env` in the launch folder is never read.

The packaged app reads these names from the process environment (Windows environment variables inherited from the launcher):

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_TRANSCRIPTION_MODEL` (optional)
- `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` (optional; both required to use ElevenLabs)
- `SPOTIFY_CLIENT_ID` (optional)

## Run the packaged app

Start it from a PowerShell session that already has those variables set (set them in that session or in your user environment variables, never in a file shipped with the app):

```powershell
.\out\ares-desktop-win32-x64\ares-desktop.exe
```

## Known limits

- The database is still a PostgreSQL server reached through `DATABASE_URL`; the package does not include one.
- Only the zip-style package is produced (no installer).
- A missing variable is reported when the feature that needs it is first used, not at startup.
- The scan reads text and the smoke script runs only the module body of `main.js` with stubs; neither proves that a lazy code path works. Launching the app is still the final check.
