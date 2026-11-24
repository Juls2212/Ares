# Architecture

```text
renderer (React)  ->  window.ares  ->  preload  ->  allowlisted IPC  ->  Electron Main services  ->  PostgreSQL (Drizzle)
```

The renderer is untrusted UI. It can call only the named methods of `window.ares`. The preload exposes exactly those methods with `contextBridge`, using one `ipcRenderer.invoke` (or one subscription) per method and a fixed channel name from `IPC_CHANNELS`. There is no generic `invoke`, `send` or `on`. Main owns every capability: database, filesystem, shell, network, credentials and the OpenAI client.

## Folders that matter

| Folder | Role |
| --- | --- |
| `src/renderer` | The HUD: the Canvas 2D orb (`orb/`), the two themes as data (`theme/themes.ts`), the single microphone button and status text, voice recording and playback, the confirmation card and the messaging contact form. |
| `src/preload/preload.ts` | The `window.ares` API (14 methods). |
| `src/shared` | Contracts shared by all layers (`contracts.ts` holds `IPC_CHANNELS` and `AresApi`), plus the kits: `text-fold`, `phrase-kit`, `failure-taxonomy`, `outcome-kit`. |
| `src/main/ipc` | One `register-*-ipc.ts` per area; each handler is registered exactly once. |
| `src/main/actions` | Capability registry, policy, orchestrator, executors per domain, action history. |
| `src/main/assistant` | Interpreter, OpenAI structured-output provider, deterministic phrase parsers, the offline local brain and its fuzzy matcher, context store, safety checks. |
| `src/main/planner`, `reminders`, `events` | Planner services and repositories, reminder and event notification delivery. |
| `src/main/applications`, `files`, `messaging`, `spotify`, `weather` | The services each domain executor uses. |
| `src/main/voice`, `settings`, `background`, `system`, `config` | Transcription and speech, voice preferences, tray and close-to-tray, system status, environment reading. |
| `src/main/database` | Drizzle client and schema (`schema/`). Migrations are in `drizzle/`. |

## The 14 IPC channels

Eight API groups (`system`, `actions`, `assistant`, `voice`, `speech`, `messaging`, `settings`, `theme`) with twelve invoke methods and two push subscriptions, all declared in `src/shared/contracts.ts`:

| Method | Channel |
| --- | --- |
| `system.getStatus` | `system:get-status` |
| `system.getCapabilities` | `system:get-capabilities` |
| `actions.propose` | `actions:propose` |
| `actions.confirm` | `actions:confirm` |
| `actions.cancel` | `actions:cancel` |
| `assistant.interpret` | `assistant:interpret` |
| `voice.transcribe` | `voice:transcribe` |
| `voice.onGlobalShortcut` (push from Main) | `voice:global-shortcut-activated` |
| `speech.speak` | `speech:speak` |
| `messaging.onContactFormRequested` (push from Main) | `messaging:contact-form-requested` |
| `messaging.submitContactForm` | `messaging:contact-form:submit` |
| `messaging.cancelContactForm` | `messaging:contact-form:cancel` |
| `settings.voice.get` | `settings:voice:get` |
| `theme.setPreference` | `theme:set-preference` |

Every channel is registered once in Main and used by exactly one preload method; a test enforces it.

## The action flow

1. `assistant.interpret` sends text to the interpreter in Main (typed text uses the same call as transcribed speech). The deterministic routers answer first; then the local brain answers obvious commands (see "Local mode"); otherwise the interpreter builds a prompt, asks OpenAI for a closed JSON object (strict schema), then parses and re-validates every draft in Main. The provider never executes anything.
2. The renderer calls `actions.propose` with a draft. The orchestrator validates the shape again, evaluates the policy, and either executes a direct action or stores a pending proposal and returns a confirmation request with an opaque `confirmationId`.
3. `actions.confirm` / `actions.cancel` resolve the pending proposal. Pending proposals expire after five minutes.
4. The executor for the action's domain runs it. The orchestrator records one terminal history row with a generic sentence (see [SECURITY.md](SECURITY.md)).

## Local mode

Ares stays useful without the OpenAI key and answers common commands faster, through an offline, deterministic **local brain** in Main (`src/main/assistant/local-intent-interpreter.ts`).

**What it is.** Rule-based intent matching over folded text (the shared text-fold kit) with a small fuzzy matcher (`local-fuzzy.ts`: bounded Levenshtein; a phrase of 8 to 15 characters tolerates one edit and a longer one two, and anything shorter must match exactly; an application alias of 5 to 8 characters tolerates one edit and a longer one two). It understands: open a registered application, search files, the time and the date, the agenda of a near day, computer information, help, and small talk (greetings, thanks, farewells, cancel). A match is turned into the very same provider-shaped JSON the cloud returns and goes through the same parser and validators, so policy, the orchestrator, confirmations and executors are unchanged. Only a high-confidence match acts; anything else is "not understood". An ambiguous application name asks a short question listing the candidates by name and never guesses.

**What it is not.** It is not a language model, it does not call the network, it never reads the computer (computer information is a normal `GET_SYSTEM_INFO` action run by its executor), it cannot produce any action outside five read-only or direct ones (`OPEN_APPLICATION` for an alias that is already registered, `SEARCH_FILES`, `GET_CURRENT_DATE_TIME`, `GET_TODAY_SCHEDULE`, `GET_SYSTEM_INFO`), and it never bypasses a confirmation, a validator or a closed schema.

**Routing.**
- Local-first (`LOCAL_FIRST_ENABLED`, default `true`, in `src/main/assistant/local-brain-config.ts`): the exact-grammar commands above are answered without calling the provider, but only where the cloud flow would give the same capability. Everything else goes to the cloud provider exactly as before. Setting the constant to `false` sends every request to the provider again; that one line undoes a misrouting.
- Fallback: if the key is missing, the provider fails or the provider times out, the local brain answers alone. If it does not understand, it says it is in local mode and names three commands it supports. This fallback is always on when the local brain is configured.
- File searches without an explicit file noun or folder (for example "busca recetas") are left to the cloud in local-first routing and accepted only in the fallback.

**Typed input and voice without the key.** Transcription needs the OpenAI key, so `system.getCapabilities` reports `voice: false` without it (nothing about the key itself is returned). The renderer then shows "Modo local: escribe con Ctrl+K" and explains it if the microphone is pressed. Ctrl+K opens a one-line input; Enter submits through the same renderer function that submits a transcript to `assistant.interpret`, Escape closes it, and focus returns to the microphone button. No IPC channel was added. If no provider can synthesize speech (no OpenAI key and no ElevenLabs, or both failing), the renderer speaks the already-capped text with the Windows system voice (an installed Spanish voice, preferring es-CO, then es-MX, es-ES, any other Spanish voice); with no Spanish voice installed, the text stays on screen and one notice is shown per session. The system voice involves no IPC, no network and nothing persisted or logged.

**Log.** One line per turn that reaches the local or cloud decision, with closed names only and never the text: `local-brain intent=<open-app|search-files|time|date|agenda|system-info|help|greeting|thanks|farewell|cancel|none> route=<local|cloud|local-fallback>`. Turns answered by the earlier deterministic routers (messaging, Spotify, found files) log no such line.

**Constants.** `LOCAL_FIRST_ENABLED` (routing), `MAX_LOCAL_INPUT_LENGTH` = 200 characters (longer text is never a local command), `ASSISTANT_INSTRUCTION_MAX_LENGTH` = 2000 (the limit of a typed or transcribed instruction), `CPU_SAMPLE_INTERVAL_MS` = 300 (computer information), and the advice thresholds `SYSTEM_INFO_THRESHOLDS`.

**Computer information.** The `SYSTEM_INFO` domain has one direct, risk 1 action, `GET_SYSTEM_INFO`, with the closed input `{ topic: "disk" | "memory" | "cpu" | "uptime" | "summary" }`. Main measures it with `os.totalmem`, `os.freemem`, two `os.cpus` samples at least 300 ms apart (an aggregate, no per-core detail), `os.uptime` and `fs.statfs` on the system drive (the path never leaves Main). Only rounded aggregates are returned: gigabytes with one decimal, whole percentages, hours or days. A deterministic advice layer adds a warning when the disk is under 10 % free, memory is over 90 % in use or the processor is over 90 % busy. History keeps the fixed sentence "Se consultó información del equipo."; the numbers exist only in the spoken and on-screen answer. There is no consent switch for it: it is gated like the other direct domains, by its approval class and the capability registry. Battery is not included: it can only be read in the renderer and passing it to Main would need a new IPC channel.

## Window and process security

The main window uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and `webSecurity: true`. A test pins these options. Credentials are read by Main from the environment only when needed.

## The HUD (renderer and window)

- **Window.** A portrait HUD, 480 x 740 by default and 420 x 620 at minimum, resizable. It has a solid background that matches the theme (`#02090b` dark, `#d4e4df` light); there is no Acrylic, transparency or vibrancy. The security options are unchanged. The native menu bar is removed in packaged builds (`Menu.setApplicationMenu(null)`) and kept in development so DevTools stay reachable.
- **Title bar.** `USE_CUSTOM_TITLE_BAR` in `src/main/window-theme.ts` (default `true`) hides the native title bar and draws the Windows buttons over the renderer header with `titleBarOverlay`; the overlay colors follow the theme and are updated with `setTitleBarOverlay` when the theme changes. The header is the drag region. If the Electron version has no such API, the native frame is used automatically. Setting the constant to `false` returns to the native frame.
- **Themes.** `src/renderer/theme/themes.ts` holds the two themes (`dark`, and the mint-gray `light`) as data. The same table writes the CSS custom properties and feeds the canvas, so a color is written once. The renderer follows `prefers-color-scheme` and its change events; no IPC channel and no preload method are involved.
- **Theme button.** The header has a button (chamfered frame, lightbulb: off in dark, on in light) on the right, left of the Windows buttons. One press calls `window.ares.theme.setPreference({ preference })` with the opposite explicit theme. Main validates the closed payload and the sender, then runs the same `themePreferenceService.set` the tray uses; the renderer learns the new theme only through `prefers-color-scheme`. «Automático» stays in the tray menu.
- **Header color.** `src/shared/theme-colors.ts` holds one header background per theme. The renderer header paints it and Main passes it as the title bar overlay color, so the Windows buttons area matches the header.
- **Errors and questions.** An error shows the word «Atención» in amber over a thin amber rule; a clarification shows «Pregunta» tinted with accent2 and the question as the main text.
- **Theme preference.** Main reads `"system" | "light" | "dark"` from the `settings` table (key `theme_preference`) before it creates the window and sets `nativeTheme.themeSource`. If the database is unavailable the preference is `system` and startup continues. The tray menu has a «Tema» submenu with three radio items (Automático, Claro, Oscuro); choosing one applies it, updates the window background and the title bar overlay, and saves it.
- **Orb.** `src/renderer/orb/orb-renderer.ts` draws the orb with Canvas 2D from explicit parameters in a 440-unit design box scaled to the canvas; the only randomness is the seeded particle field. `orb-runtime.ts` holds the mutable signal (state and level) that the voice code writes and the loop reads, the frame scheduler (full rate while active, about 30 frames per second while idle, nothing while the page is hidden) and the adaptive particle budget. The microphone level comes from the analyser the recorder already runs; the speaking level comes from a Web Audio analyser attached to the playback element (only when the audio context is running, so the voice is never silenced). Without a real level the orb uses a simulated envelope. With forced colors, or without a 2D context, a plain CSS orb with a state ring is shown.
- **One control.** The microphone button is the only control. Idle starts recording; while recording a second press stops and sends what was recorded (Escape cancels); while processing it is disabled; while speaking it stops the voice. The orb itself, the global shortcut and the tray activation follow the same rules.
- **Theme change animation (renderer only).** When the effective theme changes (toggle, tray menu or Windows), `src/renderer/theme/theme-transition.ts` plays a circular wave with the View Transitions API (950 ms in total: 160 ms hold, 700 ms expansion with `cubic-bezier(0.65, 0, 0.35, 1)`, 90 ms settle). The new snapshot is visible only inside a circle the size of the orb sphere (R0 = 58 units scaled by the canvas CSS size) while the sphere pulses, then the circle grows to the farthest window corner (Rmax) and a thin ring travels with the front. **Origin:** the center of the orb CANVAS as displayed (`.orb-canvas`), measured once INSIDE the update callback after `flushSync` has committed the views (that read forces the layout), in viewport pixels; the clip-path (one `--wave-clip` custom property, set on every run and cleared when it ends) and the ring use the same values. **When it applies instantly:** only with no View Transitions API (`unsupported`), reduced motion (`reduced-motion`), a hidden window (`hidden`), no orb on screen (`no-rect`), a real window resize in the last 150 ms (`resize`), or the manual mode constant (`mode`). The resize guard counts only window `resize` events; the canvas observers and the resize events that the theme change itself causes (it ignores them for the length of the change) never count, and a canvas within 2 px of its drawn size is settled. **One run object:** everything a run owns (ring, clip variable, orb cost mode, pacing, watchdog) lives in one object that is ended completely when the run finishes, is skipped, is rejected or throws; a callback that runs after its run ended only applies the latest theme, so a rapid second toggle cannot leave a ring (two elements with the same view transition name would make the browser abort the next transition), a clip variable or the low-cost mode behind. **Watchdog:** a run still running after 2 s is ended by force (skip, ring removed, variable cleared, orb cost restored). The latest requested theme always wins. **Reduced-cost mode:** during a run the orb loop runs at about 30 fps with the minimum particle count and no shadow blur, and the static hex grid is not repainted; the ring is three plain strokes animated by transform and opacity only. **Log line:** every theme change logs one line to the renderer console, `theme-transition decision=<wave|fade|instant> reason=<ok|reduced-motion|hidden|no-rect|resize|unsupported|error|mode> origin-delta=<px> frames=<n> long=<n> maxMs=<n>` (a closed list of names and whole numbers, never stored; `long` counts frames above 24 ms). Frame pacing is only logged: it never changes the mode. **Mode constant:** `THEME_TRANSITION_MODE` in `theme-transition.ts` is `"wave"`; `"fade"` is a 250 ms opacity cross-fade and `"instant"` applies the theme at once (change that one line to flip it). The first theme at startup is never animated. Known limitation: the Windows title bar buttons are drawn by the OS and change color instantly; only the web content animates.
