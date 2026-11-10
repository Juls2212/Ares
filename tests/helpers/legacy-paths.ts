/**
 * Everything scheduled for deletion in the cleanup refactor, mapped from the user's decisions to concrete paths.
 *
 * A test that imports, reads or names one of these paths must carry LEGACY_TEST_MARKER (see tests/helpers/read-source.ts);
 * a test without the marker must not. tests/legacy-isolation.test.ts enforces both rules and that every entry still exists.
 *
 * Phases: 3.1 = habits, weekly schedules, legacy file chain and native addon; 3.2 = legacy action names and the
 * duplicate catalog-registration service. (Phase 2.1, the legacy renderer UI, ares.css and Tailwind, and Phase 2.2, the unused
 * IPC and preload surface and the dashboard, are done and their entries were removed.)
 */
export type LegacyEntry = { path: string; phase: "3.1" | "3.2"; note: string };

export const LEGACY_ENTRIES: readonly LegacyEntry[] = [
  // ---- Phase 3.1: habits, weekly schedules, legacy file chain, native addon
  { path: "src/main/habits", phase: "3.1", note: "habit service, repository, validation, composition" },
  { path: "src/main/actions/habit-action-executor.ts", phase: "3.1", note: "habit executor (never wired into the production executor)" },
  { path: "src/main/actions/habit-mutation-references.ts", phase: "3.1", note: "habit reference resolver used by the interpreter" },
  { path: "src/shared/habit-contracts.ts", phase: "3.1", note: "habit contracts; imported by contracts.ts, action-contracts.ts, assistant-contracts.ts and the preload" },
  { path: "src/main/database/schema/habits.ts", phase: "3.1", note: "habits table (drop migration needed)" },
  { path: "src/main/database/schema/habit-completions.ts", phase: "3.1", note: "habit_completions table (drop migration needed)" },
  { path: "src/main/actions/weekly-schedule-analysis.ts", phase: "3.1", note: "weekly schedule analysis used by the planner executor" },
  { path: "src/main/actions/weekly-schedule-mutation-references.ts", phase: "3.1", note: "weekly reference resolver used by the planner executor" },
  { path: "src/main/database/schema/weekly-routines.ts", phase: "3.1", note: "weekly_routines table (drop migration needed)" },
  { path: "src/main/database/schema/weekly-schedules.ts", phase: "3.1", note: "weekly_schedules table (drop migration needed)" },
  { path: "src/main/actions/file-action-executor.ts", phase: "3.1", note: "legacy file action executor, unregistered" },
  { path: "src/main/files/file-composition.ts", phase: "3.1", note: "legacy file composition root" },
  { path: "src/main/files/file-mutation-service.ts", phase: "3.1", note: "legacy rename, move, create service" },
  { path: "src/main/files/file-organization-classifier.ts", phase: "3.1", note: "legacy organization classifier" },
  { path: "src/main/files/file-organization-executor.ts", phase: "3.1", note: "legacy organization executor" },
  { path: "src/main/files/file-organization-plan-generator.ts", phase: "3.1", note: "legacy organization planner" },
  { path: "src/main/files/file-search-service.ts", phase: "3.1", note: "legacy search service (supervised search lives in supervised-file-service.ts)" },
  { path: "src/main/files/windows-atomic-move.ts", phase: "3.1", note: "wrapper of the native no-replace move addon" },
  { path: "native/atomic-no-replace", phase: "3.1", note: "native addon sources; also forge.config.ts extraResource and the native:build and test:native scripts" },

  // ---- Phase 3.2: duplicate service and process hygiene
  { path: "src/main/applications/catalog-application-registration-service.ts", phase: "3.2", note: "older duplicate; the voice flow uses catalog-application-registration.ts" },
  { path: "src/main/database/register-database-lifecycle.ts", phase: "3.2", note: "duplicate of the shutdown in reminders/register-reminder-delivery-lifecycle.ts" }
];

export const LEGACY_PATHS: readonly string[] = LEGACY_ENTRIES.map((entry) => entry.path);

/** Entries that are expected to be gone already; none today. A path may be listed here only with a reason. */
export const ALREADY_ABSENT: Readonly<Record<string, string>> = {};

/**
 * NOT legacy, deliberately excluded (the decisions keep them):
 *  - the planner BACKEND for tasks, events and reminders (src/main/planner, planner-action-executor.ts, src/main/reminders, src/main/events,
 *    planner-temporal-resolution.ts, planner-contracts.ts), including the tables tasks, events, categories, reminders, event_notification_deliveries;
 *  - src/main/applications/custom-application-registration-service.ts, src/main/weather/*, src/main/actions/weather-action-executor.ts;
 *  - FILES (supervised), MESSAGING, MUSIC, APPLICATIONS, WEB.
 *
 * PARTIAL, not listed because survivors still import them (these need a surgical cut, not a deletion):
 *  - src/shared/file-contracts.ts and src/main/files/file-validation.ts: still imported by action-orchestrator.ts, assistant-interpreter.ts, action-executor.ts,
 *    assistant-context-service.ts, supervised-file-service.ts, approved-file-roots.ts and file-path-boundary.ts. The decision says "as applicable":
 *    only the legacy-only parts can go. The mismatch with the decision text is reported in the refactor notes.
 *  - planner-service.ts, planner-repositories.ts, planner-validation.ts and planner-contracts.ts still hold the weekly schedule and routine
 *    methods, types and validators, which die in Phase 3.1 inside surviving files.
 *
 * ---------------------------------------------------------------------------------------------------------------------------------------
 * DELETION MAP (generated from an import scan of src/ and tests/ while building this file)
 *
 * Tests deleted with each entry (all of them are marked LEGACY after this task):
 *  - src/main/habits, habit-action-executor, habit-mutation-references, habit-contracts: habit-action-executor, habit-service, habit-validation, habit-database (integration)
 *  - weekly-schedule-analysis: weekly-schedule-analysis, legacy-planner-weekly-executor, legacy-planner-weekly-service, legacy-planner-weekly-validation
 *  - legacy file chain: file-action-executor, file-mutation-service, file-organization, file-search-service
 *  - native addon and windows-atomic-move: windows-atomic-move, windows-atomic-move.integration
 *  - catalog-application-registration-service: catalog-application-registration-service
 *  - register-database-lifecycle: database-lifecycle
 *
 * Characterization snapshots that need a deliberate edit:
 *  - action-catalog-snapshot and capability-completeness: habit actions (4) in 3.1 empty KNOWN_GAPS; weekly actions (7) in 3.1 shrink the catalog from 53 to 42
 *    (INTERNAL_MEMORY 22 -> 11); legacy action names in 3.2 change no registered action.
 *  - preload-surface-snapshot and preload-surface: updated in Phase 2.2 (13 methods and 13 channels remain). Phase 3.1 changes no channel.
 *  - call-site-allowlist: no entry points at a legacy path; unchanged. window-security-options and history-privacy-domains: unchanged.
 *
 * Non-test code that still imports a legacy path (SURVIVING modules; cut these before deleting):
 *  - src/shared/contracts.ts, action-contracts.ts and assistant-contracts.ts -> habit-contracts (the preload no longer imports it)
 *  - src/main/assistant/assistant-interpreter.ts and assistant-composition.ts -> habits, habit-mutation-references, weekly-schedule-analysis, weekly-schedule-mutation-references
 *  - src/main/actions/planner-action-executor.ts -> weekly-schedule-analysis, weekly-schedule-mutation-references
 *  - src/main/database/schema/index.ts and relations.ts -> habits, habit-completions, weekly-routines, weekly-schedules
 *  - src/main/applications/application-composition.ts -> catalog-application-registration-service
 *  Legacy entries with no surviving importer (safe to delete as soon as their tests go): habit-action-executor, the legacy file chain except what is listed above, native/atomic-no-replace and register-database-lifecycle.
 */
