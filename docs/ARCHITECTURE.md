# Ares Architecture

## Architecture model

Ares is a modular monolith: one Electron desktop project, one primary window, and no independent backend server. Its fixed trust path is:

```text
React + TypeScript renderer
  -> window.ares
  -> preload + contextBridge
  -> typed Electron IPC
  -> Node.js + TypeScript services in Electron Main
  -> PostgreSQL through Drizzle ORM
```

Electron packages the application and provides controlled operating-system integration. No REST API, Express, NestJS, Spring Boot, microservice, or external backend is permitted.

## Responsibilities and boundaries

| Layer | Responsibilities | Must not do |
| --- | --- | --- |
| Renderer | Present approved UI, collect user input, show Spanish states, call the narrow preload API. | Access Node.js, filesystem, processes, shell, credentials, PostgreSQL, or raw exceptions. |
| Preload | Expose typed, minimal, allowlisted `window.ares` methods and event subscriptions through `contextBridge`. | Expose generic Electron or Node.js capabilities. |
| Electron Main | Own IPC handlers, validate requests, coordinate services, map technical failures to typed results, and enforce authorization. | Trust renderer input or execute arbitrary AI-produced commands. |
| Internal services | Execute domain rules for planner, files, applications, AI interpretation, notifications, history, settings, and voice. | Bypass risk, validation, or audit rules. |
| PostgreSQL | Persist Ares-owned metadata only through Drizzle in Main. | Store user documents or be reachable from the renderer. |

## Internal modules

Planned internal modules are Home, Assistant, Planner, Files, Applications, Settings, AI, Database, Notifications, History, Voice, and shared contracts. These names are conceptual; Phase 1 will choose a minimal directory structure without changing the architecture.

## Dependency direction

Dependencies flow inward: renderer -> preload contracts -> IPC handlers -> services -> infrastructure. Shared TypeScript contract definitions may be consumed by renderer, preload, and Main, but must contain no privileged implementation. Services may depend on domain contracts and narrow infrastructure adapters; they must not depend on renderer modules. Infrastructure must not decide user-facing policy.

## Trust boundaries

- The renderer is untrusted for authorization and validation purposes.
- Preload is a deliberate capability boundary, not a pass-through.
- Main is the sole boundary for filesystem, application launching, notifications, environment values, OpenAI access, and database connections.
- AI is an untrusted interpreter: its structured proposals are validated exactly as renderer input before any execution.

## Specialized boundaries

**Database:** only Main services use Drizzle and PostgreSQL. See [DATABASE.md](DATABASE.md).

**AI:** the AI receives only the minimum request and approved context needed to propose catalog actions. It receives no filesystem, process, shell, credential, or database capability. See [ACTIONS.md](ACTIONS.md) and [SECURITY.md](SECURITY.md).

**Voice:** the two approved voice entry paths are manual push-to-talk and opt-in local wake-word activation. The trust path is:

```text
Renderer-controlled microphone access
-> local wake-word detector
-> activation event
-> bounded command capture
-> narrow preload/IPC transfer
-> Main-owned remote Speech-to-Text provider
-> normal assistant pipeline
```

Wake-word mode is disabled by default and requires explicit Settings activation and microphone permission. While Ares is running, including with its primary window minimized, waiting-mode audio remains on the device, is neither persisted nor sent to a provider, and the detector fails closed if its state is uncertain. Remote Speech-to-Text begins only after local activation. The renderer continues to use constrained browser media APIs and receives no Node.js, filesystem, process, shell, environment, or unrestricted Electron capability. The final technical placement of the local detector is deferred to the voice implementation phase, but it must remain local and isolated from unrestricted renderer capabilities. The returned Spanish transcript enters the same assistant interpretation pipeline as typed text. Text-to-Speech is requested from a Main-owned provider service; controlled renderer media playback may use returned audio data or a later-approved narrow mechanism. Wake-word detection only begins command capture; it cannot confirm actions or bypass validation, risk classification, or visible Level 2 confirmation. See [OPERATIONS.md](OPERATIONS.md).

**Applications:** application launch follows only this chain: interpreted application name -> registered alias -> validated enabled application record -> canonical verified executable path -> direct launch without command-shell interpretation. AI cannot provide an executable command or arbitrary path. Unknown names never fall back to a shell, and opening a terminal application does not authorize command execution inside it.

**Files:** Electron Main owns the only filesystem boundary. It resolves only the trusted Documents, Downloads, and Desktop roots, then works with a root identifier plus a safe relative reference. It canonicalizes each target, confirms case-insensitive containment in the selected root, and skips symbolic links, junctions, and inaccessible entries. No renderer, preload, shared contract, or action module receives an absolute or canonical path, a filesystem handle, or file contents. Search is metadata-only and bounded to depth 12 and 100 results. Main-only primitives may create one folder, rename one file or folder, or directly move one file after final revalidation; they never overwrite, copy, delete, or read content. The final Windows rename/move step uses a narrowly scoped native no-replace bridge so a destination collision fails atomically; cross-volume moves fail safely without a copy-and-delete fallback. The bridge is available only to the Main file-mutation service. `ORGANIZE_FILES` is a Level 2 action in the same supervised lifecycle: Main analyzes one folder's direct regular files, returns an immutable safe preview, and executes only its in-memory stored plan after opaque confirmation. No direct file IPC or `window.ares.files` surface exists.

**Notifications:** Electron Main owns the local reminder scheduler and Electron `Notification` delivery. After app readiness it performs one catch-up check, then polls due `PENDING` reminders every 30 seconds in bounded deterministic batches. A conditional Main-only database transition claims a reminder as `TRIGGERED` before one local notification is shown, so restart, repeat ticks, and concurrent schedulers cannot redeliver it. A notification-display failure does not reset the claim or retry automatically, preserving at-most-once delivery. The scheduler stops before the Main database pool closes. There is no renderer notification API, web notification, remote push, or external notification service.

**Dashboard:** Electron Main composes a read-only, bounded home-summary query. It reuses the planner local-day boundary and injected clock semantics, returns at most five items per section, and aggregates today’s schedule, non-completed tasks, events and pending reminders due in the next seven days, and safe terminal action history. The renderer receives it only through one typed preload method; it never receives database access or raw persistence details.

## Electron security baseline

The final window configuration must preserve context isolation, disable renderer Node integration, and expose only the reviewed preload surface. All IPC channels are explicitly allowlisted and validated in Main. Direct renderer access to Node.js and operating-system APIs is prohibited.
