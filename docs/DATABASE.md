# Database Strategy

## PostgreSQL and Drizzle

PostgreSQL is mandatory for Ares-owned data. Electron Main accesses it through Drizzle ORM; renderer and preload never connect to it. Development uses PostgreSQL through Docker Compose, with Drizzle ORM and Drizzle Kit. This phase defines strategy only and creates no Compose file, schema, migration, or database.

Migrations are versioned and are the exclusive schema-change path. Manual schema changes outside the migration workflow are prohibited. The final Windows provisioning approach is deferred before packaging and does not permit replacement with another database.

## Conceptual entities and relationships

| Entity | Conceptual ownership and relationships |
| --- | --- |
| `tasks` | User work items; may reference `categories` and may have associated `reminders`. |
| `events` | Scheduled activities; may reference `categories` and may have associated `reminders`. |
| `reminders` | Alerts tied to exactly one task, exactly one event, or an independent explicit subject. |
| `categories` | Optional planner classification used by tasks and events. |
| `applications` | Registered known applications, aliases, validated path metadata, and preference state. |
| `action_history` | Audit-oriented records of important actions, ordered outcomes, and safe metadata. |
| `settings` | User preferences such as notifications, voice output, appearance, and behavior. |

The final schema must define ownership and deletion/update behavior explicitly during implementation; no destructive cascade behavior is assumed in Phase 0. A reminder must never reference both a task and an event. `remindAt` is always required; if neither `taskId` nor `eventId` is present, an independent title or subject is required. Missing or invalid references produce controlled validation results. The eventual schema must enforce the one-association invariant where practical, with service-level validation required in all cases.

## Date, time, and paths

Exact instants, such as event starts and reminder times, are stored consistently in UTC and converted to the local system time zone for display. Date-only values preserve local calendar meaning and must not shift through UTC conversion. Natural-language resolution uses the current local date and time. Recurrence is deferred.

PostgreSQL stores file-path references only when needed for Ares metadata or history; user documents remain in the operating system. Paths must be normalized and validated in Main before persistence. Avoid persisting unnecessary file content or sensitive metadata.

## Suggested constraints and indexes

Implementation should evaluate primary keys, timestamps, foreign keys, unique application aliases, checked task status values, temporal ordering for events, and indexes supporting planner date ranges, due dates, reminder scheduling, history ordering, and registered application lookup. Exact column types, constraints, and indexes remain implementation-phase work and must be captured in versioned migrations.

## Data that must not be stored

- User document contents as a database substitute for the filesystem.
- OpenAI secrets, database passwords, microphone audio beyond approved temporary handling, or raw credentials.
- Unnecessary full file contents or unnecessarily detailed personal log data.

## Deferred database decisions

Final table shape, enum representation, retention rules, indexes, migration filenames, test database lifecycle, and Windows production provisioning are deferred to the database implementation and packaging phases. See [OPEN_DECISIONS.md](OPEN_DECISIONS.md).
