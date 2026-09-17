# IPC and Preload Contracts

## Contract principles

`window.ares` is a narrow, typed capability surface. It is exposed by preload through `contextBridge`; each method maps to an allowlisted IPC handler that validates the request in Main. Names use lower camel case for API groups and methods, dot-separated lower-case IPC channels, English request fields, and stable upper-snake-case error codes.

Normal queries and configuration methods, including `settings.get`, `history.list`, `applications.list`, `system.getStatus`, and `system.getCapabilities`, resolve to `OperationResult<T>` from [ACTIONS.md](ACTIONS.md). Supervised execution methods use `ActionResult`, including action identifiers, terminal status, structured data when available, stable error code when applicable, and Spanish user summary. Lifecycle states (`PROPOSED`, `AWAITING_CONFIRMATION`, `APPROVED`, and `RUNNING`) are non-terminal and remain distinct from the terminal `ActionResult` states defined in [ACTIONS.md](ACTIONS.md). Neither category leaks raw exceptions or stack traces; diagnostics remain in Main logs. Event subscriptions return an unsubscribe function and must be cleaned up when no longer needed.

## Implemented planner API

Phase 3 implements the following narrow planner surface. Every method resolves to a serializable `OperationResult<T>` with stable English error codes and Spanish `userMessage` values. Preload forwards only these fixed channels; Electron Main delegates to the planner service, which remains responsible for validation, scheduling, persistence, and controlled error mapping. No method exposes database connections, SQL, filesystem access, environment values, or generic IPC.

| API method | IPC channel |
| --- | --- |
| `planner.categories.create` | `planner:categories:create` |
| `planner.categories.list` | `planner:categories:list` |
| `planner.categories.update` | `planner:categories:update` |
| `planner.tasks.create` | `planner:tasks:create` |
| `planner.tasks.list` | `planner:tasks:list` |
| `planner.tasks.update` | `planner:tasks:update` |
| `planner.tasks.complete` | `planner:tasks:complete` |
| `planner.events.create` | `planner:events:create` |
| `planner.events.list` | `planner:events:list` |
| `planner.events.update` | `planner:events:update` |
| `planner.reminders.create` | `planner:reminders:create` |
| `planner.reminders.list` | `planner:reminders:list` |
| `planner.schedule.getToday` | `planner:schedule:get-today` |
| `planner.schedule.getWeek` | `planner:schedule:get-week` |

The IPC handler is a thin boundary: it passes the serialized input to the singleton Main-process planner service and returns its result unchanged. An unexpected handler failure returns `PLANNER_IPC_UNAVAILABLE` with the Spanish message `No se pudo procesar la solicitud del planificador.` Raw exceptions, SQL, stack traces, credentials, and database details remain in Main and never cross into the renderer.

## Planned API groups

| Group | Planned responsibilities and methods |
| --- | --- |
| `window.ares.planner` | Implemented as documented above. Categories, tasks, events, reminders, and local-day/local-week schedules use explicit typed methods only. |
| `window.ares.files` | Search authorized locations, create folders, preview organization, rename, and move. Planned methods: `search`, `createFolder`, `renameFile`, `renameFolder`, `move`, `previewOrganization`, `organize`. |
| `window.ares.applications` | List registered applications, manage registrations in later Settings work, and open known applications. Planned methods: `list`, `open`, `register`, `updateRegistration`. |
| `window.ares.actions` | Submit an already validated proposal to the lifecycle, correlate confirmation, cancel pending proposals, and retrieve ordered lifecycle or terminal results. Planned methods: `submit`, `confirm`, `cancel`, `getResult`. Level 1 may proceed from proposal to execution; Level 2 returns `AWAITING_CONFIRMATION`. |
| `window.ares.assistant` | Interpret typed Spanish text only. `interpret(instruction, context?)` returns either a clarification request or a validated action proposal; it never executes an action. The definitive frontend may orchestrate `interpret` followed by `actions.submit`, but cannot bypass Main validation. |
| `window.ares.voice` | Receive one bounded command-audio payload for provider transcription only after manual capture or a local wake-word activation; request Main-owned Spanish synthesis; expose typed voice state; and support immediate mute or disable behavior. Planned responsibilities include wake-word preference, activation notification, bounded capture state, permission/device errors, `transcribe(audioPayload)`, `synthesize(spanishText)`, `getState`, `mute`, and `stopSpeaking` only if required by the later-approved playback mechanism. Renderer-local browser capture is not a privileged `window.ares` method, and no unrestricted continuous-audio channel is exposed. |
| `window.ares.notifications` | Read notification settings and receive approved notification-related events. Planned methods: `getPreferences`, `updatePreferences`, `onNotificationEvent`. Sending is owned by Main. |
| `window.ares.history` | Read filtered action-history records. Planned methods: `list`, `getById`. |
| `window.ares.settings` | Read and update non-secret user preferences, including voice-output preference, opt-in wake-word preference, and recognized applications. Planned methods: `get`, `update`. |
| `window.ares.system` | Expose minimal non-privileged state needed by the UI, such as application version or capability availability. Planned methods: `getStatus`, `getCapabilities`. |

## Validation, errors, and events

Preload performs no authorization decision. Main validates schemas, identifiers, path authorization, opaque confirmation identifiers, proposal immutability, duplicate requests, bounded audio payloads, and sender-to-operation correlation. A valid Level 2 confirmation must reference the exact pending proposal or batch; replayed confirmation or execution requests cannot run an action twice. Voice events distinguish disabled, local waiting, command recording, processing, speaking, and unavailable states; they carry no waiting-mode audio and subscriptions must return an unsubscribe function. Activation can start at most one bounded capture session and cannot act as confirmation. Events are named for their domain, carry typed minimal payloads, and never expose secrets, raw errors, file contents, or general system handles. The preload API must not expose general Node.js, Electron, filesystem, process, shell, environment, or operating-system APIs.

The Phase 0 contracts remain the governing design reference. The planner API above is the implemented Phase 3 subset; all other groups remain planned.
