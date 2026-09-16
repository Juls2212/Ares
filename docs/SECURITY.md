# Ares Security Policy

## Security objective

Ares is supervised by design: the renderer, AI, and external inputs cannot directly perform privileged operating-system or database work. Main validates each request and invokes only allowlisted internal capabilities.

## Electron and IPC rules

- Renderer Node integration is disabled; context isolation is enabled.
- Only reviewed, typed methods are exposed through `contextBridge` as `window.ares`.
- IPC channels and payloads are allowlisted and validated in Main; sender-provided input is never trusted.
- The renderer receives neither `fs`, `child_process`, `shell`, raw Electron APIs, environment variables, PostgreSQL connections, nor OpenAI credentials.
- Raw exceptions stay internal. Stable typed codes cross the boundary and are translated to Spanish user-facing messages.

## Action risk matrix

| Level | Policy | MVP actions |
| --- | --- | --- |
| Level 1 Safe | Execute after the user submits an explicit, fully resolved request. Clarify missing essential details. | Opening known applications, search, schedule queries, and explicit creation of planner information or folders. |
| Level 2 Modification | Show a clear Spanish summary and require visible UI confirmation before execution. | Rename, move, organization, task update, event update, and every task completion. |
| Level 3 Destructive | Reserved for future expansion. | None. Destructive file behavior is explicitly excluded from the MVP. |

## Filesystem safeguards

Main normalizes and validates every path and permits work only in explicitly selected or authorized locations. It checks object type, accessibility, and collisions before mutation; it never overwrites silently. Organization is preview-only until confirmed, uses approved extension rules, executes per item, and reports per-item outcomes. Protected or inaccessible locations return controlled failures. Automatic rollback is not required, and failures cannot be reported as success.

## Application safeguards

Only registered, safely discovered, or explicitly user-registered applications may open. Paths are validated by controlled platform-specific logic. Aliases resolve only to registered entries. AI can identify a requested name but cannot create a path or invoke a generic command. Ares never controls an external application's internals.

## AI containment and validation

AI is limited to interpretation and structured proposals from [ACTIONS.md](ACTIONS.md). The model has no tools or authority to initiate arbitrary network requests and cannot access arbitrary URLs, the filesystem, database, processes, credentials, or operating-system commands. Main's OpenAI client may make the controlled network request required for the configured OpenAI API, with only approved minimal context. Main validates the action name, fields, authorization, dependencies, risk, proposal immutability, and confirmation state before service execution. Unsupported actions are rejected.

## Secrets, privacy, and logging

Development secrets come only from environment variables and are never committed or exposed through `window.ares`. OpenAI credentials remain in Main; database credentials remain outside the renderer. Logs are English, use stable codes, contain no secrets, and avoid unnecessary personal file content. User-facing errors are Spanish and must not expose raw technical messages.

## Voice privacy

The microphone activates only after explicit user interaction. The renderer requests microphone permission and captures audio with constrained browser media APIs; it receives no Node.js, filesystem, process, shell, environment, or unrestricted Electron access. A narrow validated preload/IPC method transfers audio to Main, which owns provider credentials. Transcribed text follows the same validation and confirmation path as typed input. Temporary audio is removed after processing unless a development configuration explicitly authorizes short-lived diagnostic retention after a failure. Level 2 confirmation is visible UI, correlated by an opaque confirmation identifier, and optional spoken output cannot bypass it.
