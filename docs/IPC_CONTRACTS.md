# Planned IPC and Preload Contracts

## Contract principles

`window.ares` is a narrow, typed capability surface. It is exposed by preload through `contextBridge`; each method maps to an allowlisted IPC handler that validates the request in Main. Names use lower camel case for API groups and methods, dot-separated lower-case IPC channels, English request fields, and stable upper-snake-case error codes.

Normal queries and configuration methods, including `settings.get`, `history.list`, `applications.list`, `system.getStatus`, and `system.getCapabilities`, resolve to `OperationResult<T>` from [ACTIONS.md](ACTIONS.md). Supervised execution methods use `ActionResult`, including action identifiers, terminal status, structured data when available, stable error code when applicable, and Spanish user summary. Lifecycle states (`PROPOSED`, `AWAITING_CONFIRMATION`, `APPROVED`, and `RUNNING`) are non-terminal and remain distinct from the terminal `ActionResult` states defined in [ACTIONS.md](ACTIONS.md). Neither category leaks raw exceptions or stack traces; diagnostics remain in Main logs. Event subscriptions return an unsubscribe function and must be cleaned up when no longer needed.

## Planned API groups

| Group | Planned responsibilities and methods |
| --- | --- |
| `window.ares.planner` | Create, update, complete, and query tasks, events, and reminders; retrieve local-day and local-week schedules. Planned methods: `createTask`, `updateTask`, `completeTask`, `createEvent`, `updateEvent`, `createReminder`, `getTodaySchedule`, `getWeekSchedule`. |
| `window.ares.files` | Search authorized locations, create folders, preview organization, rename, and move. Planned methods: `search`, `createFolder`, `renameFile`, `renameFolder`, `move`, `previewOrganization`, `organize`. |
| `window.ares.applications` | List registered applications, manage registrations in later Settings work, and open known applications. Planned methods: `list`, `open`, `register`, `updateRegistration`. |
| `window.ares.actions` | Submit an already validated proposal to the lifecycle, correlate confirmation, cancel pending proposals, and retrieve ordered lifecycle or terminal results. Planned methods: `submit`, `confirm`, `cancel`, `getResult`. Level 1 may proceed from proposal to execution; Level 2 returns `AWAITING_CONFIRMATION`. |
| `window.ares.assistant` | Interpret typed Spanish text only. `interpret(instruction, context?)` returns either a clarification request or a validated action proposal; it never executes an action. The definitive frontend may orchestrate `interpret` followed by `actions.submit`, but cannot bypass Main validation. |
| `window.ares.voice` | Receive captured audio through a narrow payload for provider transcription, request Main-owned synthesis of Spanish text, and expose non-privileged voice state. Planned methods: `transcribe(audioPayload)`, `synthesize(spanishText)`, `getState`, and `stopSpeaking` only if required by the later-approved playback mechanism. Renderer-local browser capture is not a privileged `window.ares` method. |
| `window.ares.notifications` | Read notification settings and receive approved notification-related events. Planned methods: `getPreferences`, `updatePreferences`, `onNotificationEvent`. Sending is owned by Main. |
| `window.ares.history` | Read filtered action-history records. Planned methods: `list`, `getById`. |
| `window.ares.settings` | Read and update non-secret user preferences, including voice-output preference and recognized applications. Planned methods: `get`, `update`. |
| `window.ares.system` | Expose minimal non-privileged state needed by the UI, such as application version or capability availability. Planned methods: `getStatus`, `getCapabilities`. |

## Validation, errors, and events

Preload performs no authorization decision. Main validates schemas, identifiers, path authorization, opaque confirmation identifiers, proposal immutability, duplicate requests, and sender-to-operation correlation. A valid Level 2 confirmation must reference the exact pending proposal or batch; replayed confirmation or execution requests cannot run an action twice. Events are named for their domain, carry typed minimal payloads, and never expose secrets, raw errors, file contents, or general system handles. The preload API must not expose general Node.js, Electron, filesystem, process, shell, environment, or operating-system APIs.

These are documentation contracts only; no preload API or IPC handler exists in Phase 0.
