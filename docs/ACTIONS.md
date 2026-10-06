# Ares MVP Action Contracts

## Terminology

An **action** is a typed, validated proposal. AI may propose actions, but only Main services may execute them. Action names, fields, error codes, and examples of internal structures are English. Visible summaries and messages are Spanish.

Ares acts only after an explicit user instruction or UI interaction. Voice and AI cannot bypass the Main-owned action policy, and arbitrary commands are prohibited. The existing action orchestrator is the single supervised dispatch path; newly cataloged actions without a typed executor remain deferred.

## Approval policy

| Classification | Actions |
| --- | --- |
| `DIRECT` | `CREATE_TASK`, `UPDATE_TASK`, `COMPLETE_TASK`, `CREATE_EVENT`, `UPDATE_EVENT`, `CREATE_REMINDER`, `GET_TODAY_SCHEDULE`, `GET_WEEK_SCHEDULE`, `GET_WEEKLY_SCHEDULE_DETAILS`, `ANALYZE_WEEKLY_SCHEDULE`, `GET_TODAY_AVAILABILITY`, `GET_CURRENT_DATE_TIME`, `GET_WEATHER`, `GET_HABIT_PROGRESS`, `OPEN_REGISTERED_APPLICATION`, `OPEN_REGISTERED_PAGE`, `CREATE_FOLDER`, `SEARCH_FILES` |
| `CONFIRMATION_REQUIRED` | `CREATE_WEEKLY_SCHEDULE`, `UPDATE_WEEKLY_SCHEDULE`, `CREATE_WEEKLY_ROUTINE`, `UPDATE_WEEKLY_ROUTINE`, `CREATE_HABIT`, `UPDATE_HABIT`, `COMPLETE_HABIT`, `RENAME_FILE`, `RENAME_FOLDER`, `MOVE_FILE`, `MOVE_FOLDER`, `ORGANIZE_FILES`, `UPDATE_REGISTERED_APPLICATION`, `UPDATE_REGISTERED_PAGE` |
| `REINFORCED_CONFIRMATION_REQUIRED` | `DELETE_EVENT`, `DELETE_TASK`, `DELETE_FILE`, `DELETE_FOLDER` |

The implemented legacy names `OPEN_APPLICATION` and `OPEN_WEB_PAGE` retain their existing safe typed behavior and are classified as `DIRECT`. Registered-application/page names in the new policy are reserved and deferred until explicitly implemented. `MOVE_FOLDER`, configuration updates, `DELETE_FILE`, and `DELETE_FOLDER` remain deferred; classification never makes an action executable. `DELETE_EVENT` is implemented through the same Main action orchestrator as other supervised actions. Calendar uses only explicit request, confirm, and cancel deletion channels; the old direct event-delete IPC channel is removed. Main binds the single-use, five-minute confirmation to the exact event ID and requires the reinforced policy before the planner deletion service can run.

## Result categories

Calendar task deletion uses the same Main-issued, exact-ID-bound, single-use five-minute confirmation lifecycle as event deletion. Only task request/confirm/cancel deletion methods cross preload; no direct task-delete channel exists. Task editing, completion, and reopening retain the existing direct update/completion policy. Cancellation, expiry, and failed or replayed confirmations cannot dispatch task deletion.

`OperationResult<T>` is for normal queries and configuration operations. It is not an action-execution result.

```ts
type OperationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; userMessage: string } };
```

`userMessage` is Spanish. Raw exceptions and technical stack traces never cross into the renderer; Main retains diagnostic detail only in English technical logs.

`ActionResult` is specific to the supervised execution of an action proposal.

Illustrative documentation shape only:

```ts
type ActionEnvelope = {
  actionId: string;
  action: ActionName;
  input: Record<string, unknown>;
  dependsOn?: string[];
};

type ActionResult = {
  actionId: string;
  status: "SUCCEEDED" | "CANCELLED" | "VALIDATION_FAILED" |
    "EXECUTION_FAILED" | "DEPENDENCY_SKIPPED";
  errorCode?: string;
  data?: Record<string, unknown>;
  userSummary: string;
};
```

`userSummary` is Spanish. Technical error text remains internal; stable codes are mapped to Spanish messages by the presentation boundary.

## Action lifecycle

Proposal or execution lifecycle states are distinct from terminal result states:

| Lifecycle state | Meaning |
| --- | --- |
| `PROPOSED` | A validated action proposal exists but is not yet approved for execution. |
| `AWAITING_CONFIRMATION` | A confirmation-required or reinforced-confirmation-required proposal awaits a valid visible confirmation. |
| `APPROVED` | Main has accepted a valid confirmation for the exact immutable proposal. |
| `RUNNING` | Main has begun execution. |

`DIRECT` actions may move from a validated `PROPOSED` state directly to `RUNNING` without an additional confirmation. Both confirmation classifications must enter `AWAITING_CONFIRMATION` and cannot execute without Main correlating confirmation to the exact validated action or batch through an opaque confirmation identifier or equivalent secure mechanism. A renderer Boolean alone is not confirmation. Destructive actions are never direct.

The proposal associated with a confirmation identifier is immutable: it cannot be silently modified before execution. Duplicate confirmation or execution requests must be idempotently rejected or return the original lifecycle/result state; they must not perform the action twice.

### Confirmation expiration

A confirmation-required proposal exists only in Electron Main memory. It expires exactly five minutes after creation unless it is confirmed or cancelled first. An expired proposal must never execute; the user must request the action again. Its terminal cancellation is recorded through the same safe action-history path without proposal inputs or sensitive details. Pending proposals are removed after success, failure, cancellation, expiration, or application shutdown. Expiration is a safety measure against stale confirmation and never triggers automatic execution.

| Result status | Meaning |
| --- | --- |
| `SUCCEEDED` | The service completed the action. |
| `CANCELLED` | The user declined a required confirmation. |
| `VALIDATION_FAILED` | Required data or authorization was missing or invalid. |
| `EXECUTION_FAILED` | Validation passed but execution did not complete. |
| `DEPENDENCY_SKIPPED` | A required prior action did not succeed. |

## Multi-action behavior

The interpreter parses all actions before execution. Each action is independently validated, assigned dependencies, clearly presented, and confirmed under its own policy. Approved independent actions continue if another independent action fails. An action with a failed dependency is skipped. There is no global transaction spanning filesystem and database work. The ordered request result contains one terminal `ActionResult` for every proposed action and a top-level outcome of complete success, partial success, cancellation, validation failure, or execution failure.

Dependencies use `dependsOn` action IDs and mean the dependent action cannot execute unless every listed dependency succeeds. A request may be clarified before proposal when a material ambiguity cannot be resolved safely.

## Reminder and task interpretation

- An alert-first request maps to `CREATE_REMINDER`; for example, **“Recuérdame llamar a Juan mañana a las 3.”**
- Work to be completed maps to `CREATE_TASK`; for example, **“Tengo que terminar el diseño el viernes.”**
- A task receives an associated reminder only when both are explicitly requested or clearly required by the request structure.
- When the distinction materially changes the outcome and is ambiguous, Ares asks a Spanish clarification rather than guessing, for example: **“¿Quieres crear una tarea o solo un recordatorio?”**

## Catalog

Required fields are validated after natural-language resolution. All paths must be authorized, normalized, and validated in Main. All existing-item references must resolve uniquely or require clarification.

| Action | Purpose | Risk and confirmation | Required fields | Optional fields | Validation and execution result | Spanish summary and failure behavior | History |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `OPEN_APPLICATION` | Open a registered known application. | Level 1; no extra confirmation. | Registered `alias` | None | Resolve only a validated enabled registration by alias. AI may identify a requested name but never provides a command or path. Electron Main revalidates and canonicalizes the stored path, verifies that it is an existing regular `.exe` file, then launches exactly that target with an empty argument array and `shell: false`. Unknown names, shell metacharacters, arbitrary paths, URLs, and arguments are validation failures and never fall back to PowerShell, Command Prompt, PATH lookup, or another shell. | “Se abrió {registeredPublicName}.” Failure: controlled unavailable/not-registered message. | Record only the trusted registered public display name when applicable; never persist aliases, paths, process IDs, commands, or filesystem errors. |
| `OPEN_WEB_PAGE` | Open the fixed approved YouTube destination in a registered Chrome browser. | Level 1; no extra confirmation. | `destination: YOUTUBE`, `browser: CHROME` | None | Main resolves `YOUTUBE` to its fixed HTTPS destination and `CHROME` to the registered enabled `chrome` alias immediately before launch. It revalidates the canonical executable and launches only that executable with exactly the fixed trusted URL argument and `shell: false`. User- or model-provided URLs, protocols, fragments, aliases, browser flags, arguments, default-browser fallback, and command execution are unsupported. | “Se abrió YouTube en {registeredPublicName}.” Failure: controlled Spanish browser or destination message. | Record only the trusted registered public display name and terminal aggregate result; never URLs, aliases, paths, arguments, process IDs, commands, or launch errors. |
| `CREATE_FOLDER` | Create a folder in an authorized parent. | Level 1; direct after a valid proposal. | Approved parent root-relative reference, `name` | `proposedAlternativeName` | The Main-only primitive validates one Windows-safe name, canonical containment, directory type, reparse-point rejection, and collision before non-recursive creation. It never overwrites or reuses an existing folder. It executes only through the supervised `window.ares.actions.propose` lifecycle after a valid proposal. | “Se creó la carpeta autorizada.” Failure: controlled Spanish collision or access message. | Record only terminal aggregate metadata; never persist paths or filesystem details. |
| `RENAME_FILE` | Rename an existing file. | Level 2; visible confirmation. | Approved file root-relative reference, `newName` | `proposedAlternativeName` | The Main-only primitive validates a single Windows-safe replacement name, rechecks containment/type, rejects no-op/case-only renames and collisions, and does not overwrite or read content. Its final Windows move uses an atomic no-replace call, so a concurrent destination collision preserves the source. It executes only through the supervised `window.ares.actions.propose` lifecycle after confirmation. | Before: “Se cambiará el nombre de 1 archivo.” After: “Se cambió el nombre del archivo autorizado.” | Record only terminal aggregate metadata; never persist paths or filesystem details. |
| `RENAME_FOLDER` | Rename an existing folder. | Level 2; visible confirmation. | Approved folder root-relative reference, `newName` | `proposedAlternativeName` | The Main-only primitive validates a single Windows-safe replacement name, rechecks containment/type, rejects no-op/case-only renames and collisions, and does not overwrite or read content. Its final Windows move uses an atomic no-replace call, so a concurrent destination collision preserves the source. It executes only through the supervised `window.ares.actions.propose` lifecycle after confirmation. | Before: “Se cambiará el nombre de 1 carpeta.” After: “Se cambió el nombre de la carpeta autorizada.” | Record only terminal aggregate metadata; never persist paths or filesystem details. |
| `MOVE_FILE` | Move one file to an authorized destination. | Level 2; visible confirmation. | Approved file and destination-directory root-relative references | None | The Main-only primitive preserves the filename, rechecks both canonical targets and collisions, and uses a direct Windows atomic no-replace move only. A cross-volume move fails safely; Ares never copies and deletes as a fallback. It executes only through the supervised `window.ares.actions.propose` lifecycle after confirmation. | Before: “Se moverá 1 archivo al destino autorizado.” After: “Se movió el archivo autorizado.” | Record only terminal aggregate metadata; never persist paths or filesystem details. |
| `SEARCH_FILES` | Search authorized locations for files. | Level 1; no extra confirmation. | `query`, approved root identifier | `extensions`, root-relative search scope | The read-only service limits search to Electron Main-resolved Documents, Downloads, or Desktop. References use an approved root plus relative path; Main canonicalizes final targets, confirms containment, skips reparse points, and returns metadata-only matches. Search is bounded to depth 12 and 100 results. It executes only through the supervised `window.ares.actions.propose` lifecycle. | “Se completó la búsqueda de archivos autorizados.” Failure: controlled Spanish search/access message. | Record only terminal aggregate metadata, never query text, references, paths, or filesystem details. |
| `ORGANIZE_FILES` | Analyze and apply extension-based organization in one authorized folder. | Level 2; Main generates an immutable preview and visible confirmation is always required. | Approved root-relative folder reference | Explicit root-relative exclusions | Analysis considers direct regular files only, classifies conservative extensions into `Documentos`, `Imágenes`, `Audio`, `Videos`, `Comprimidos`, or `Otros`, and never reads content. Main stores the exact plan only in memory. Confirmation executes only that plan, rechecks containment/type/reparse status, creates category folders only then, and uses atomic no-replace moves. Directories, reparse points, unsafe entries, exclusions, and conflicts are skipped safely; no recursive organization, overwrite, copy/delete fallback, custom rule, or undo exists. | Before: a serializable safe preview contains root-relative references, counts, categories, and controlled skip reasons. After: a controlled aggregate result reports planned, moved, skipped, and conflict counts. | Record terminal aggregate counts and category totals only; never file names, references, paths, exclusions, or filesystem errors. |
| `CREATE_TASK` | Create work that must be completed. | Level 1 when explicit and resolved; otherwise clarify. | `title` | `dueDate`, `dueTime`, `priority`, `categoryId`, `reminder` | Validate title, local date semantics, optional category, and explicit reminder linkage. | “Se creó la tarea {title}.” Failure: Spanish validation message. | Record result. |
| `UPDATE_TASK` | Change an existing task. | Level 1; direct after a valid proposal. | `taskId`, `changes` | none | Resolve task and validate each permitted field. | “Se actualizó la tarea {title}.” | Record result. |
| `COMPLETE_TASK` | Mark an existing task complete. | Level 1; direct after a valid proposal. | `taskId` | `completionNote` | Resolve exactly one task before proposal. An ambiguous reference requires clarification; an already-completed task returns a controlled result. | “Se completó la tarea {title}.” | Record result. |
| `CREATE_EVENT` | Create a scheduled event. | Level 1 when explicit and resolved; otherwise clarify. | `title`, `startAt` | `endAt`, `categoryId`, `notes`, `reminder` | Require local resolved start; exact instants use UTC storage. End must not precede start. Recurrence is unsupported. | “Se creó el evento {title}.” Failure: Spanish validation message. | Record result. |
| `UPDATE_EVENT` | Change an existing event. | Level 1; direct after a valid proposal. | `eventId`, `changes` | none | Resolve event and validate temporal ordering and allowed fields. | “Se actualizó el evento {title}.” | Record result. |
| `CREATE_REMINDER` | Create an alert tied to one task, one event, or an independent explicit subject. | Level 1 when explicit and resolved; otherwise clarify. | `remindAt` and either `taskId`, `eventId`, or `title` | `title`, `taskId`, `eventId` | `remindAt` is always required. At most one of `taskId` and `eventId` may exist. Without either reference, `title` is required. Referenced entities must exist and be valid; the result supplies a display title from the independent title or referenced entity. | “Se creó el recordatorio {reminderTitle}.” Failure: Spanish validation message. | Record result. |
| `GET_TODAY_SCHEDULE` | Retrieve the local-day schedule. | Level 1; no extra confirmation. | none | `includeCompletedTasks` | Use current local date; return tasks, events, and reminders in a stable order. | “Esto es lo que tienes programado hoy.” | Record query result. |
| `GET_WEEK_SCHEDULE` | Retrieve the local-week schedule. | Level 1; no extra confirmation. | none | `weekStart`, `includeCompletedTasks` | Use local calendar boundaries; validate requested week start if supplied. | “Esto es lo que tienes programado esta semana.” | Record query result. |
| `GET_WEEKLY_SCHEDULE_DETAILS` | Retrieve details for one explicitly named weekly schedule, or all schedules when explicitly requested. | Level 1; no extra confirmation. | Main-resolved schedule title, or explicit `allSchedules` | none | Main resolves normalized titles against current schedules and composes all routine facts. | Controlled Spanish weekly-schedule response. | Record aggregate query result only. |
| `ANALYZE_WEEKLY_SCHEDULE` | Analyze availability, busiest day, or overlaps for one explicitly named weekly schedule, or all schedules when explicitly requested. | Level 1; no extra confirmation. | Main-resolved schedule title or explicit `allSchedules`; fixed analysis kind | none | Main merges overlapping routine blocks and calculates facts in the fixed 06:00–22:00 window. | Controlled Spanish weekly-analysis response. | Record aggregate query result only. |
| `GET_TODAY_AVAILABILITY` | Retrieve estimated availability for the local day. | Level 1; no extra confirmation. | none | Main-validated explicit `afterTime` | Main uses only dated event intervals; task due times remain deadlines rather than occupied intervals. | Controlled Spanish availability response. | Record aggregate query result only. |
| `CREATE_WEEKLY_SCHEDULE` | Create one named weekly schedule. | Level 2; visible confirmation. | `title` | Explicit `description`, `color` | Main validates explicit values and rejects an existing normalized title. | Grounded Spanish creation response after confirmation. | Record terminal aggregate result only. |
| `UPDATE_WEEKLY_SCHEDULE` | Update one uniquely resolved named weekly schedule. | Level 2; visible confirmation. | Human-readable `scheduleTitle` and at least one explicit change | `title`, `description`, `color` | Main resolves the title immediately before execution and validates only explicit changes. | Grounded Spanish update response after confirmation. | Record terminal aggregate result only. |
| `CREATE_WEEKLY_ROUTINE` | Create one weekday-only block in one named schedule. | Level 2; visible confirmation. | Human-readable `scheduleTitle`, `title`, `weekday`, `startTime`, `endTime` | Explicit `location`, `categoryName` | Main resolves the schedule and optional category, validates strict HH:mm ordering, and creates one block per explicit draft. | Grounded Spanish creation response after confirmation. | Record terminal aggregate result only. |
| `UPDATE_WEEKLY_ROUTINE` | Update one uniquely resolved weekday-only block in one named schedule. | Level 2; visible confirmation. | Human-readable schedule and routine references plus at least one explicit change | Target weekday/time references and explicit field changes | Main resolves the schedule and target block immediately before execution; ambiguity and misses require clarification. | Grounded Spanish update response after confirmation. | Record terminal aggregate result only. |
| `GET_CURRENT_DATE_TIME` | Retrieve the current local date and time. | Level 1; no extra confirmation. | none | none | Main derives the result from its local system clock and time zone. | Controlled Spanish date/time response. | Record aggregate query result. |
| `GET_WEATHER` | Retrieve current and today weather for the fixed initial location. | Level 1; no extra confirmation. | none | none | Main resolves the fixed Pasto, Colombia configuration and validates the weather response before composing it. The model never authors factual weather text. | Controlled Spanish current-weather and today-forecast response. | Record aggregate query result only; never provider payloads, coordinates, or network details. |
| `GET_HABIT_PROGRESS` | Retrieve grounded daily or weekly habit progress. | Level 1; no extra confirmation. | `scope`; optional uniquely resolved human-readable habit title | none | Main resolves an active title and composes counts, target status, and streaks from the habit service. | Controlled Spanish progress response. | Record aggregate result only. |
| `CREATE_HABIT` | Create one habit. | Level 2; visible confirmation. | `title`, `frequency`, valid target | Explicit `description`, `categoryName`, allowlisted `icon` | Main validates frequency, target, icon, and optional category before dispatch. | Grounded Spanish creation response only after confirmation. | Record terminal aggregate result only. |
| `UPDATE_HABIT` | Update one uniquely resolved active habit. | Level 2; visible confirmation. | Human-readable `habitTitle` and explicit changes | Explicit supported habit fields | Main resolves the title immediately before execution and validates every change and category. | Grounded Spanish update response only after confirmation. | Record terminal aggregate result only. |
| `COMPLETE_HABIT` | Complete one uniquely resolved active habit for Main's current local date. | Level 2; visible confirmation. | Human-readable `habitTitle` | none | Main resolves the title and applies the existing idempotent completion service for its current local date. | Grounded Spanish completion or already-completed response only after confirmation. | Record terminal aggregate result only. |

## Unknown actions

An unsupported, malformed, or unrecognized action is never executed. It produces `VALIDATION_FAILED` with a stable internal code such as `ACTION_UNSUPPORTED` and a Spanish response such as **“No puedo realizar esa acción.”**
