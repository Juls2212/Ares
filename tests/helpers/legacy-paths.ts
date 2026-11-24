/**
 * Everything still scheduled for deletion in the cleanup refactor, mapped from the user's decisions to concrete paths.
 *
 * A test that imports, reads or names one of these paths must carry LEGACY_TEST_MARKER (see tests/helpers/read-source.ts);
 * a test without the marker must not. tests/legacy-isolation.test.ts enforces both rules and that every entry still exists.
 *
 * The list is empty: Phase 2.1 (the legacy renderer UI), Phase 2.2 (the unused IPC and preload surface), Phase 3.1 (habits,
 * weekly schedules, the legacy file chain, the native addon) and Phase 3.2 (the legacy action names, the duplicate catalog
 * registration service and the unused database lifecycle module) are all done. The mechanism stays so that a future cleanup
 * can list a path here again and have the same isolation rules enforced.
 */
export type LegacyEntry = { path: string; phase: string; note: string };

export const LEGACY_ENTRIES: readonly LegacyEntry[] = [];

export const LEGACY_PATHS: readonly string[] = LEGACY_ENTRIES.map((entry) => entry.path);

/** Entries that are expected to be gone already; none today. A path may be listed here only with a reason. */
export const ALREADY_ABSENT: Readonly<Record<string, string>> = {};

/**
 * NOT legacy, deliberately kept (the decisions keep them):
 *  - the planner BACKEND for tasks, events and reminders (src/main/planner including the deletion services, planner-action-executor.ts,
 *    src/main/reminders, src/main/events, planner-temporal-resolution.ts, planner-contracts.ts), including the tables tasks, events,
 *    categories, reminders, event_notification_deliveries;
 *  - src/main/applications/custom-application-registration-service.ts and catalog-application-registration.ts;
 *  - src/main/weather/* and src/main/actions/weather-action-executor.ts (the read-only weather query);
 *  - FILES (supervised), MESSAGING, MUSIC, APPLICATIONS, WEB.
 */
