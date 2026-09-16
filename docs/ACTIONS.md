# Ares MVP Action Contracts

## Terminology

An **action** is a typed, validated proposal. AI may propose actions, but only Main services may execute them. Action names, fields, error codes, and examples of internal structures are English. Visible summaries and messages are Spanish.

## Result categories

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
| `AWAITING_CONFIRMATION` | A Level 2 proposal awaits a valid visible confirmation. |
| `APPROVED` | Main has accepted a valid confirmation for the exact immutable proposal. |
| `RUNNING` | Main has begun execution. |

Level 1 actions may move from a validated `PROPOSED` state directly to `RUNNING` without an additional confirmation. Level 2 actions must enter `AWAITING_CONFIRMATION` and cannot execute without Main correlating confirmation to the exact validated action or batch through an opaque confirmation identifier or equivalent secure mechanism. A renderer Boolean alone is not confirmation.

The proposal associated with a confirmation identifier is immutable: it cannot be silently modified before execution. Duplicate confirmation or execution requests must be idempotently rejected or return the original lifecycle/result state; they must not perform the action twice.

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
| `OPEN_APPLICATION` | Open a registered known application. | Level 1; no extra confirmation. | `applicationId` or registered `alias` | `requestContext` | Resolve only a validated registration and its validated executable path. AI may identify a requested name but never provides a command or path. Launch directly without shell interpretation; no arguments are supported. Unknown names, shell metacharacters, or arbitrary paths are validation failures and never fall back to PowerShell, Command Prompt, or another shell. | “Se abrió {applicationName}.” Failure: controlled unavailable/not-registered message. | Record success and failure. |
| `CREATE_FOLDER` | Create a folder in an authorized parent. | Level 1 when explicit; otherwise clarify. | `parentPath`, `name` | `proposedAlternativeName` | Validate parent authorization, name, normalization, and collision. Never silently overwrite. | “Se creó la carpeta {name}.” Failure: explain collision or access in Spanish. | Record result. |
| `RENAME_FILE` | Rename an existing file. | Level 2; visible confirmation. | `sourcePath`, `newName` | `proposedAlternativeName` | Existing authorized file, valid name, collision detection. | Before: “Se cambiará el nombre de 1 archivo.” After: “Se cambió el nombre del archivo.” | Record result. |
| `RENAME_FOLDER` | Rename an existing folder. | Level 2; visible confirmation. | `sourcePath`, `newName` | `proposedAlternativeName` | Existing authorized folder, valid name, collision detection. | Before: “Se cambiará el nombre de 1 carpeta.” After: “Se cambió el nombre de la carpeta.” | Record result. |
| `MOVE_FILE` | Move one or more files to an authorized destination. | Level 2; visible confirmation. | `sourcePaths`, `destinationPath` | `collisionChoices` | Validate every source, destination, authorization, collisions, and per-item plan. | Before: “Se moverán {count} archivos a {destination}.” Per-item outcomes are reported. | Record aggregate and outcomes. |
| `SEARCH_FILES` | Search authorized locations for files. | Level 1; no extra confirmation. | `query` or `filters`, `authorizedLocations` | `extensions`, `modifiedAfter` | Require at least one searchable criterion and authorized scope. Return bounded matches and inaccessible scopes. | “Se encontraron {count} archivos.” Failure: controlled search/access message. | Record query metadata, not unnecessary content. |
| `ORGANIZE_FILES` | Analyze and apply extension-based organization. | Level 2; preview and visible confirmation always required. | `sourcePath` | `rules` | First produce non-mutating plan; detect collisions. MVP rules: PDF/DOCX/TXT -> Documentos; PNG/JPG/JPEG -> Imágenes; ZIP/RAR/7Z -> Comprimidos; MP4/MOV -> Videos. Execute item by item. | Before: “Se organizarán {count} archivos en {sourcePath}.” Return proposed destinations and per-item results. | Record final aggregate and outcomes. |
| `CREATE_TASK` | Create work that must be completed. | Level 1 when explicit and resolved; otherwise clarify. | `title` | `dueDate`, `dueTime`, `priority`, `categoryId`, `reminder` | Validate title, local date semantics, optional category, and explicit reminder linkage. | “Se creó la tarea {title}.” Failure: Spanish validation message. | Record result. |
| `UPDATE_TASK` | Change an existing task. | Level 2; visible confirmation. | `taskId`, `changes` | none | Resolve task and validate each permitted field. | Before: “Se actualizará la tarea {title}.” After: “Se actualizó la tarea {title}.” | Record result. |
| `COMPLETE_TASK` | Mark an existing task complete. | Level 2; visible confirmation always required. | `taskId` | `completionNote` | Resolve exactly one task before proposal. An ambiguous reference requires clarification; an already-completed task returns a controlled result. | Before: “Se completará la tarea {title}.” After: “Se completó la tarea {title}.” | Record result. |
| `CREATE_EVENT` | Create a scheduled event. | Level 1 when explicit and resolved; otherwise clarify. | `title`, `startAt` | `endAt`, `categoryId`, `notes`, `reminder` | Require local resolved start; exact instants use UTC storage. End must not precede start. Recurrence is unsupported. | “Se creó el evento {title}.” Failure: Spanish validation message. | Record result. |
| `UPDATE_EVENT` | Change an existing event. | Level 2; visible confirmation. | `eventId`, `changes` | none | Resolve event and validate temporal ordering and allowed fields. | Before: “Se actualizará el evento {title}.” After: “Se actualizó el evento {title}.” | Record result. |
| `CREATE_REMINDER` | Create an alert tied to one task, one event, or an independent explicit subject. | Level 1 when explicit and resolved; otherwise clarify. | `remindAt` and either `taskId`, `eventId`, or `title` | `title`, `taskId`, `eventId` | `remindAt` is always required. At most one of `taskId` and `eventId` may exist. Without either reference, `title` is required. Referenced entities must exist and be valid; the result supplies a display title from the independent title or referenced entity. | “Se creó el recordatorio {reminderTitle}.” Failure: Spanish validation message. | Record result. |
| `GET_TODAY_SCHEDULE` | Retrieve the local-day schedule. | Level 1; no extra confirmation. | none | `includeCompletedTasks` | Use current local date; return tasks, events, and reminders in a stable order. | “Esto es lo que tienes programado hoy.” | Record query result. |
| `GET_WEEK_SCHEDULE` | Retrieve the local-week schedule. | Level 1; no extra confirmation. | none | `weekStart`, `includeCompletedTasks` | Use local calendar boundaries; validate requested week start if supplied. | “Esto es lo que tienes programado esta semana.” | Record query result. |

## Unknown actions

An unsupported, malformed, or unrecognized action is never executed. It produces `VALIDATION_FAILED` with a stable internal code such as `ACTION_UNSUPPORTED` and a Spanish response such as **“No puedo realizar esa acción.”**
