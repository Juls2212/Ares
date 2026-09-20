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

For the MVP, Main may access only the trusted Electron-resolved Windows Documents, Downloads, and Desktop folders. A request crosses the boundary as an approved root identifier plus a root-relative path, never as a renderer- or AI-supplied absolute path. Main canonicalizes the selected root and final target, verifies case-insensitive containment within that root, and rejects absolute, drive-qualified, UNC, traversal, null-byte, malformed, and escaping paths. Symbolic links, junctions, and other reparse-point-like candidates are not followed. Network shares, system locations, arbitrary folders, and external locations remain out of scope.

The current file capability performs metadata-only recursive name search in one approved root at a time. It never reads file contents and stops at depth 12 or 100 returned results, reporting safe truncation and aggregate skipped-entry information rather than raw filesystem errors or paths. Main-only mutation primitives support one folder creation, one file rename, one folder rename, or one file move from safe root-relative references. They recheck canonical containment, expected object types, reparse-point rejection, and collisions immediately before mutation; they never overwrite, delete, copy, truncate, or read content. Windows rename and move operations use a narrow Main-only native `MoveFileW` bridge without a replace-existing or copy-allowed flag, so a final destination collision fails atomically and preserves both items. Cross-volume moves fail safely rather than copying and deleting. `ORGANIZE_FILES` is a Level 2 action: Main analyzes one approved folder's direct regular files without mutation, stores the exact safe plan only with the opaque pending confirmation, and executes only that plan after confirmation. It skips directories, reparse points, unsafe entries, exclusions, and execution-time conflicts; category folders are created only during confirmed execution. The plan never recurses, reads contents, overwrites, or uses copy/delete fallback. There is no direct file IPC or renderer file API. Terminal history retains only allowlisted aggregate metadata, never file references, paths, query text, or filesystem details. Deletion, indexing, watching, custom organization rules, and bulk behavior beyond the confirmed plan remain deferred.

## Application safeguards

Only registered, safely discovered, or explicitly user-approved applications may open. Launch resolution is limited to: interpreted application name -> registered alias -> validated enabled application record -> canonical verified executable path -> direct launch without command-shell interpretation. Paths are validated by controlled platform-specific logic, and aliases resolve only to registered entries.

AI can identify a requested application name but cannot provide an executable command or arbitrary executable path. Unknown names return a controlled Spanish unavailable message and never fall back to shell execution. Before a registered application opens, Electron Main canonicalizes its stored path and verifies that the canonical target is an existing regular `.exe` file. It invokes only that target with an empty argument array and `shell: false`; Ares never passes AI-produced text to PowerShell, Command Prompt, PATH lookup, or another shell. `child_process` is never exposed to the renderer. A successful `OPEN_APPLICATION` result or history entry may contain only the trusted registered public display name; aliases, paths, arguments, process IDs, commands, and raw technical failures remain private. Arguments are unsupported unless a later approved action defines and validates an explicit allowlisted argument contract. Opening a terminal application does not authorize executing commands inside it, and Ares never controls an external application's internals.

## AI containment and validation

AI is limited to interpretation and structured proposals from [ACTIONS.md](ACTIONS.md). The model has no tools or authority to initiate arbitrary network requests and cannot access arbitrary URLs, the filesystem, database, processes, credentials, or operating-system commands. Main's OpenAI client may make the controlled network request required for the configured OpenAI API, with only approved minimal context. Main validates the action name, fields, authorization, dependencies, risk, proposal immutability, and confirmation state before service execution. Unsupported actions are rejected.

## Secrets, privacy, and logging

Development secrets come only from environment variables and are never committed or exposed through `window.ares`. OpenAI credentials remain in Main; database credentials remain outside the renderer. Logs are English, use stable codes, contain no secrets, and avoid unnecessary personal file content. User-facing errors are Spanish and must not expose raw technical messages.

## Voice privacy

Manual push-to-talk remains available. Wake-word mode is disabled by default and can operate only after the user explicitly enables it in Settings and explicitly grants microphone permission. While the Ares process is running, including while its window is minimized, the configured local detector may monitor for the activation phrase. Waiting-mode audio remains local, is not persisted, is not sent to OpenAI or another remote provider, and is not included in technical logs. Ares does not listen after its process is closed and this decision does not approve Windows auto-start.

After a local activation event, one bounded command-recording session may begin. The renderer requests and uses microphone access through constrained browser media APIs; it receives no Node.js, filesystem, process, shell, environment, or unrestricted Electron access. A narrow validated preload/IPC method transfers only bounded command audio to Main, which owns provider credentials. If detector state is uncertain, it fails closed and remote capture does not begin. The user has an immediate mute or disable control, and microphone loss or permission denial produces a controlled Spanish state. Temporary command audio is removed after processing unless a development configuration explicitly authorizes short-lived diagnostic retention after a failure.

Wake-word detection only begins capture. It never confirms an action, and voice input never bypasses validation, risk classification, or confirmation. Transcribed text follows the same pipeline as typed input. Level 2 confirmation remains visible UI, correlated by an opaque confirmation identifier; optional spoken output cannot bypass it.
