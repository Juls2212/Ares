# Ares MVP Scope

## Purpose and goals

Ares is a supervised Windows desktop productivity assistant. It centralizes personal planning, tasks, events, reminders, productivity-focused file work, known-application launching, action history, system notifications, and typed or manually initiated Spanish voice interaction.

The MVP demonstrates a complete controlled flow: natural-language interpretation, structured action validation, confirmation where required, execution by internal services, persistence or operating-system interaction, and a visible Spanish result. The user remains in control at every stage.

## Included capabilities

- Typed Spanish requests interpreted into the catalog in [ACTIONS.md](ACTIONS.md).
- Tasks, events, reminders, categories, settings, applications, and action history persisted in PostgreSQL.
- Controlled search, folder creation, rename, move, and deterministic extension-based organization for user-authorized locations.
- Opening only registered or safely discovered known applications.
- Electron-managed notifications for reminders, upcoming events, and eligible tasks.
- A future bidirectional Spanish voice path: manually initiated Speech-to-Text, the same action pipeline as text, and optional Text-to-Speech responses.
- One primary Electron window with the documented functional sections: Inicio, Ares, Planificador, Archivos, Aplicaciones, and Ajustes.

## Explicit exclusions

- Destructive file operations in the MVP.
- Permanent microphone listening, a wake word, autonomous operation, remote control, arbitrary command execution, or generic control of external applications.
- Recurring event behavior.
- AI content classification and custom organization rules beyond the approved extension rules.
- Mobile, web, microservice, REST, or independently hosted backend variants.
- A definitive frontend until the conditions below are met.

## Platform and phases

The supported target platform is Windows. Ares is a single modular-monolithic Electron desktop application.

| Phase | Boundary |
| --- | --- |
| Phase 0 | Technical documentation and contracts only. No production code, project scaffold, dependency installation, database, or Git initialization. |
| Phase 1 | Secure Electron, React, TypeScript, Vite, Tailwind CSS, and Forge foundation with a temporary communication-only renderer. |
| Later phases | Database, internal services, action security, IPC/preload, tests, approved frontend, integration, and packaging in the documented order. |

## Backend-first and frontend restriction

Internal services, action validation, IPC contracts, and backend tests must be implemented and stabilized before the definitive frontend. Phase 0 may name frontend responsibilities and Spanish user-facing states, but it must not prescribe layouts, visual styles, components, or a final sidebar implementation. The definitive frontend starts only after backend stability, implemented IPC contracts, user-supplied visual references, and explicit design approval.

## MVP completion criteria

The MVP is complete when the approved action catalog works through its controlled pipeline, Level 2 changes have visible confirmation, results and failures are reported in Spanish, important actions are recorded, secrets and privileged APIs remain outside the renderer, and the packaged Windows application demonstrates the required flows without expanding scope.
