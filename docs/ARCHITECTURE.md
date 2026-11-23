# Architecture

```text
renderer (React)  ->  window.ares  ->  preload  ->  allowlisted IPC  ->  Electron Main services  ->  PostgreSQL (Drizzle)
```

The renderer is untrusted UI. It can call only the named methods of `window.ares`. The preload exposes exactly those methods with `contextBridge`, using one `ipcRenderer.invoke` (or one subscription) per method and a fixed channel name from `IPC_CHANNELS`. There is no generic `invoke`, `send` or `on`. Main owns every capability: database, filesystem, shell, network, credentials and the OpenAI client.

## Folders that matter

| Folder | Role |
| --- | --- |
| `src/renderer` | The orb shell and its views, components, voice recording, messaging contact form, settings of color scheme. |
| `src/preload/preload.ts` | The `window.ares` API (13 methods). |
| `src/shared` | Contracts shared by all layers (`contracts.ts` holds `IPC_CHANNELS` and `AresApi`), plus the kits: `text-fold`, `phrase-kit`, `failure-taxonomy`, `outcome-kit`. |
| `src/main/ipc` | One `register-*-ipc.ts` per area; each handler is registered exactly once. |
| `src/main/actions` | Capability registry, policy, orchestrator, executors per domain, action history. |
| `src/main/assistant` | Interpreter, OpenAI structured-output provider, deterministic phrase parsers, context store, safety checks. |
| `src/main/planner`, `reminders`, `events` | Planner services and repositories, reminder and event notification delivery. |
| `src/main/applications`, `files`, `messaging`, `spotify`, `weather` | The services each domain executor uses. |
| `src/main/voice`, `settings`, `background`, `system`, `config` | Transcription and speech, voice preferences, tray and close-to-tray, system status, environment reading. |
| `src/main/database` | Drizzle client and schema (`schema/`). Migrations are in `drizzle/`. |

## The 13 IPC channels

Seven API groups (`system`, `actions`, `assistant`, `voice`, `speech`, `messaging`, `settings`) with eleven invoke methods and two push subscriptions, all declared in `src/shared/contracts.ts`:

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

Every channel is registered once in Main and used by exactly one preload method; a test enforces it.

## The action flow

1. `assistant.interpret` sends text to the interpreter in Main. The interpreter builds a prompt, asks OpenAI for a closed JSON object (strict schema), then parses and re-validates every draft in Main. The provider never executes anything.
2. The renderer calls `actions.propose` with a draft. The orchestrator validates the shape again, evaluates the policy, and either executes a direct action or stores a pending proposal and returns a confirmation request with an opaque `confirmationId`.
3. `actions.confirm` / `actions.cancel` resolve the pending proposal. Pending proposals expire after five minutes.
4. The executor for the action's domain runs it. The orchestrator records one terminal history row with a generic sentence (see [SECURITY.md](SECURITY.md)).

## Window and process security

The main window uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and `webSecurity: true`. A test pins these options. Credentials are read by Main from the environment only when needed.
