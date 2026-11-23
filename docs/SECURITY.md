# Security baseline and privacy rules

## Baseline

- **Process isolation.** `contextIsolation`, `sandbox` and `webSecurity` are on, `nodeIntegration` is off. The renderer reaches Main only through the 13 named `window.ares` methods ([ARCHITECTURE.md](ARCHITECTURE.md)).
- **Main owns every capability.** The renderer and the preload never touch the filesystem, shell, network, database, environment or credentials. `tests/call-site-allowlist.test.ts` fails if any other file uses `shell.openExternal`, `shell.openPath`, `shell.showItemInFolder`, `shell.trashItem`, `child_process`, `fetch(`, an HTTP server, `safeStorage`, file deletion, `process.env` or `new BrowserWindow`.
- **The model is untrusted.** The interpreter sends a closed strict JSON schema (`additionalProperties: false` everywhere), then Main parses and validates every draft again. A provider-authored place, file name or alias is only used when it appears in the person's own words or in a trusted Main list.
- **Closed inputs.** Actions take enums, bounded text and ordinals. No action accepts a URL, a path, a command, a coordinate or a provider identifier from the caller.
- **Confirmation.** See [CAPABILITIES.md](CAPABILITIES.md).

## Network call sites

Only these places make network requests, each confined to its own hosts:

| Module | Purpose | Hosts |
| --- | --- | --- |
| `src/main/spotify/spotify-api-client.ts` | The only Spotify Web API client. | `accounts.spotify.com`, `api.spotify.com` |
| `src/main/weather/weather-service.ts` | The only weather client; the only `fetch(` besides Spotify. | `geocoding-api.open-meteo.com`, `api.open-meteo.com` |
| `src/main/voice/elevenlabs-speech-provider.ts` | The only ElevenLabs client (one text-to-speech request per spoken answer, when configured). | `api.elevenlabs.io` |
| OpenAI client modules in `src/main/assistant` and `src/main/voice` | Interpretation, transcription and speech through the OpenAI SDK, in Main only. | The SDK's endpoint |

Opening a browser or an app is not a request by Ares: `shell.openExternal` is allowed only in `approved-web-action-executor.ts`, `catalog-application-adapter.ts`, `whatsapp-chat-launcher.ts` and `spotify-authorize-launcher.ts`, each with a fixed target.

The Spotify connection uses PKCE with a loopback receiver on `127.0.0.1:8888` and the scopes `user-read-playback-state` and `user-modify-playback-state`. Its tokens are encrypted with Electron `safeStorage` and stored as one opaque value in the `settings` table.

## What history, logs and speech never contain

History (`action_history`) keeps, per action: the action name, risk level, terminal status, a **generic fixed sentence**, an error code and a small allowlisted metadata object (counts and category names). For the planner, files, messaging, music and weather domains the sentence is chosen by domain and status (for example "Se creó una tarea." or "La consulta del clima no se completó."), never from the outcome text. For applications and web the stored text is a Main-composed sentence that names only the public application display name or the approved site (Google, YouTube, Spotify). The person still hears and sees the real answer; only what is persisted is generic.

Never persisted or logged, in any domain:

- task, event, reminder or contact titles and names, message text, phone numbers;
- file and folder names, queries, paths, URLs;
- the typed weather place, coordinates, provider payloads or temperatures;
- the aliases a person typed for an application, executable paths, tokens, authorization codes, response bodies;
- raw exceptions: executors log one constant line (for example `Weather action execution failed.`).

Failure messages come from closed taxonomies of fixed Spanish sentences that contain no user data ([KITS.md](KITS.md)); a test walks every taxonomy and rejects digit runs, paths, URLs and interpolation placeholders.

Speech receives only text Main composed for the response, already capped to about two sentences. That text goes to OpenAI, or to ElevenLabs when `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are set (and to OpenAI if ElevenLabs fails for that sentence). Nothing else is sent to ElevenLabs: no history and no identifiers, only what the spoken sentence itself says. Its key and voice id are read in Main only, never logged, and failures log only a closed code. Weather answers are spoken because the person just asked for them; they are not stored.

## Credentials

Credentials live in the environment of the Main process: the OpenAI key and models, the optional ElevenLabs key and voice id, the database URL and the Spotify client id (names in [SETUP.md](SETUP.md)). They are read in Main when first needed, never exposed to Vite, preload or renderer, and never logged. Spotify tokens are the only credential Ares stores, encrypted.

## Files and deletion

Search is limited to six known folders (Desktop, Documents, Downloads, Pictures, Music, Videos). Results are addressed by ordinal (1 to 10) from the last search, which expires after ten minutes; prepared actions expire after five. Opening blocks executable-like extensions. Rename, move and create never overwrite (`FILES_ALREADY_EXISTS`). The only deletion is sending one found item to the Recycle Bin after a reinforced confirmation; there is no permanent deletion.
