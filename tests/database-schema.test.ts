import { getTableName, isSQLWrapper } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionHistory,
  actionResultStatusEnum,
  applicationAliases,
  applicationAliasesRelations,
  applications,
  applicationsRelations,
  categories,
  categoriesRelations,
  events,
  habitCompletions,
  habitCompletionsRelations,
  habitFrequencyEnum,
  habits,
  habitsRelations,
  eventNotificationDeliveries,
  eventNotificationDeliveriesRelations,
  eventsRelations,
  reminderStatusEnum,
  reminders,
  remindersRelations,
  riskLevelValues,
  settings,
  taskPriorityEnum,
  taskStatusEnum,
  tasks,
  tasksRelations
  , weekdayEnum
  , weeklyRoutines
  , weeklyRoutinesRelations
  , weeklySchedules
  , weeklySchedulesRelations
} from "../src/main/database/schema";

const schemaDirectory = path.resolve(process.cwd(), "src/main/database/schema");

const readSchemaFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return readSchemaFiles(entryPath);
    }

    return entry.name.endsWith(".ts") ? [readFileSync(entryPath, "utf8")] : [];
  });

const getColumnNames = (table: Parameters<typeof getTableConfig>[0]): string[] =>
  getTableConfig(table).columns.map((column) => column.name);

const dialect = new PgDialect();

const getNamedCheckSql = (
  table: Parameters<typeof getTableConfig>[0],
  checkName: string
): string => {
  const namedCheck = getTableConfig(table).checks.find((check) => check.name === checkName);

  if (!namedCheck) {
    throw new Error(`Expected check was not declared: ${checkName}`);
  }

  return dialect.sqlToQuery(namedCheck.value).sql;
};

const getNamedIndexSql = (
  table: Parameters<typeof getTableConfig>[0],
  indexName: string
): string => {
  const namedIndex = getTableConfig(table).indexes.find((index) => index.config.name === indexName);
  const expression = namedIndex?.config.columns[0];

  if (!namedIndex || !isSQLWrapper(expression)) {
    throw new Error(`Expected SQL expression index was not declared: ${indexName}`);
  }

  return dialect.sqlToQuery(expression.getSQL(), "indexes").sql;
};

describe("Ares MVP database schema", () => {
  it("exports the approved PostgreSQL tables, including durable event deliveries", () => {
    expect([
      categories,
      tasks,
      events,
      eventNotificationDeliveries,
      reminders,
      applications,
      applicationAliases,
      actionHistory,
      settings,
      weeklyRoutines,
      weeklySchedules,
      habits,
      habitCompletions
    ].map(getTableName)).toEqual([
      "categories",
      "tasks",
      "events",
      "event_notification_deliveries",
      "reminders",
      "applications",
      "application_aliases",
      "action_history",
      "settings",
      "weekly_routines",
      "weekly_schedules",
      "habits",
      "habit_completions"
    ]);
  });

  it("uses only the approved enum values and conceptual risk levels", () => {
    expect(taskStatusEnum.enumValues).toEqual(["PENDING", "IN_PROGRESS", "COMPLETED"]);
    expect(taskPriorityEnum.enumValues).toEqual(["LOW", "MEDIUM", "HIGH"]);
    expect(reminderStatusEnum.enumValues).toEqual(["PENDING", "TRIGGERED", "CANCELLED"]);
    expect(weekdayEnum.enumValues).toEqual(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);
    expect(habitFrequencyEnum.enumValues).toEqual(["DAILY", "WEEKLY"]);
    expect(actionResultStatusEnum.enumValues).toEqual([
      "SUCCEEDED",
      "CANCELLED",
      "VALIDATION_FAILED",
      "EXECUTION_FAILED",
      "DEPENDENCY_SKIPPED"
    ]);
    expect(riskLevelValues).toEqual([1, 2, 3]);
    expect(getTableConfig(actionHistory).checks.map((check) => check.name)).toContain(
      "action_history_risk_level_check"
    );
    expect(getTableConfig(actionHistory).indexes.map((index) => index.config.name)).toContain(
      "action_history_action_id_unique"
    );
  });

  it("rejects blank required human-readable values with PostgreSQL trimming checks", () => {
    const requiredNonBlankChecks = [
      [categories, "categories_name_non_blank_check"],
      [tasks, "tasks_title_non_blank_check"],
      [events, "events_title_non_blank_check"],
      [weeklyRoutines, "weekly_routines_title_non_blank_check"],
      [weeklySchedules, "weekly_schedules_title_non_blank_check"],
      [habits, "habits_title_non_blank_check"],
      [reminders, "reminders_title_non_blank_check"],
      [applications, "applications_name_non_blank_check"],
      [applications, "applications_executable_path_non_blank_check"],
      [applicationAliases, "application_aliases_alias_non_blank_check"],
      [actionHistory, "action_history_action_id_non_blank_check"],
      [actionHistory, "action_history_action_name_non_blank_check"],
      [actionHistory, "action_history_user_summary_non_blank_check"]
    ] as const;

    for (const [table, checkName] of requiredNonBlankChecks) {
      const checkSql = getNamedCheckSql(table, checkName);

      expect(checkSql).toContain("btrim(");
      expect(checkSql).toContain("<> ''");
    }
  });

  it("normalizes case-insensitive unique expressions with trimming", () => {
    const normalizedIndexes = [
      [categories, "categories_name_lower_unique"],
      [applicationAliases, "application_aliases_alias_lower_unique"],
      [applications, "applications_executable_path_lower_unique"]
      , [weeklySchedules, "weekly_schedules_title_lower_unique"]
    ] as const;

    for (const [table, indexName] of normalizedIndexes) {
      expect(getNamedIndexSql(table, indexName)).toContain("lower(btrim(");
    }
  });

  it("enforces reminder association exclusivity and preserves linked reminders", () => {
    const reminderConfig = getTableConfig(reminders);
    const referencedTables = reminderConfig.foreignKeys.map((foreignKey) =>
      getTableName(foreignKey.reference().foreignTable)
    );

    expect(referencedTables).toEqual(expect.arrayContaining(["tasks", "events"]));
    expect(reminderConfig.foreignKeys.every((foreignKey) => foreignKey.onDelete === "set null")).toBe(
      true
    );
    expect(reminderConfig.checks.map((check) => check.name)).toContain(
      "reminders_single_association_check"
    );
    expect(reminderConfig.checks.map((check) => check.name)).toContain(
      "reminders_delivery_state_check"
    );
    const deliveryStateCheckSql = getNamedCheckSql(reminders, "reminders_delivery_state_check");

    expect(deliveryStateCheckSql).toContain("'TRIGGERED'");
    expect(deliveryStateCheckSql).toContain("<> 'TRIGGERED'");
    expect(deliveryStateCheckSql).toContain("delivered_at");
    expect(deliveryStateCheckSql).toContain("IS NOT NULL");
    expect(deliveryStateCheckSql).toContain("IS NULL");
  });

  it("keeps application launch data limited to registered paths and aliases", () => {
    const applicationColumns = getColumnNames(applications);
    const aliasConfig = getTableConfig(applicationAliases);

    expect(applicationColumns).toContain("executable_path");
    expect(applicationColumns).not.toContain("command");
    expect(applicationColumns).not.toContain("arguments");
    expect(aliasConfig.indexes.map((index) => index.config.name)).toContain(
      "application_aliases_alias_lower_unique"
    );
    expect(aliasConfig.foreignKeys).toHaveLength(1);
    expect(aliasConfig.foreignKeys[0]?.onDelete).toBe("cascade");
  });

  it("declares the required indexes, relations, and secret-free settings columns", () => {
    expect(getTableConfig(tasks).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["tasks_status_index", "tasks_due_date_index", "tasks_category_id_index"])
    );
    expect(getTableConfig(events).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["events_start_at_index", "events_category_id_index"])
    );
    expect(getTableConfig(weeklyRoutines).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["weekly_routines_schedule_weekday_start_time_index", "weekly_routines_category_id_index"])
    );
    expect(getTableConfig(habits).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["habits_active_created_at_index", "habits_category_id_index"])
    );
    expect(getTableConfig(habits).foreignKeys.map((foreignKey) => foreignKey.onDelete)).toContain("set null");
    expect(getTableConfig(habitCompletions).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining(["habit_completions_habit_id_completed_on_index", "habit_completions_completed_on_index"])
    );
    expect(getTableConfig(habitCompletions).foreignKeys[0]?.onDelete).toBe("cascade");
    expect(getTableConfig(habitCompletions).uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "habit_completions_habit_id_completed_on_unique"
    );
    expect(getTableConfig(habits).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(["habits_target_count_check", "habits_frequency_target_check", "habits_icon_check"])
    );
    expect(getColumnNames(habits)).toContain("icon");
    expect(getTableConfig(weeklyRoutines).foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual(
      expect.arrayContaining(["set null", "cascade"])
    );
    expect(getColumnNames(weeklyRoutines)).toContain("weekly_schedule_id");
    expect(getTableConfig(weeklySchedules).indexes.map((index) => index.config.name)).toContain(
      "weekly_schedules_title_lower_unique"
    );
    expect(getTableConfig(weeklyRoutines).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(["weekly_routines_location_non_blank_check", "weekly_routines_time_range_check"])
    );
    expect(getTableConfig(reminders).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "reminders_pending_remind_at_index",
        "reminders_task_id_index",
        "reminders_event_id_index"
      ])
    );
    const deliveryConfig = getTableConfig(eventNotificationDeliveries);
    expect(deliveryConfig.indexes.map((index) => index.config.name)).toContain(
      "event_notification_deliveries_event_scheduled_unique"
    );
    expect(deliveryConfig.foreignKeys).toHaveLength(1);
    expect(deliveryConfig.foreignKeys[0]?.onDelete).toBe("cascade");
    expect([
      categoriesRelations,
      tasksRelations,
      eventsRelations,
      eventNotificationDeliveriesRelations,
      remindersRelations,
      applicationsRelations,
      applicationAliasesRelations
      , weeklyRoutinesRelations
      , weeklySchedulesRelations
      , habitsRelations
      , habitCompletionsRelations
    ].every(Boolean)).toBe(true);
    expect(getColumnNames(settings).join(" ")).not.toMatch(
      /secret|credential|password|token|api[_]?key/i
    );
  });

  it("keeps schema modules independent from renderer and preload modules", () => {
    const schemaSource = readSchemaFiles(schemaDirectory).join("\n");

    expect(schemaSource).not.toMatch(/from\s+["'][^"']*(?:renderer|preload)[^"']*["']/);
  });
});
