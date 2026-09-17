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
  it("exports the eight approved PostgreSQL tables with their expected names", () => {
    expect([
      categories,
      tasks,
      events,
      reminders,
      applications,
      applicationAliases,
      actionHistory,
      settings
    ].map(getTableName)).toEqual([
      "categories",
      "tasks",
      "events",
      "reminders",
      "applications",
      "application_aliases",
      "action_history",
      "settings"
    ]);
  });

  it("uses only the approved enum values and conceptual risk levels", () => {
    expect(taskStatusEnum.enumValues).toEqual(["PENDING", "IN_PROGRESS", "COMPLETED"]);
    expect(taskPriorityEnum.enumValues).toEqual(["LOW", "MEDIUM", "HIGH"]);
    expect(reminderStatusEnum.enumValues).toEqual(["PENDING", "TRIGGERED", "CANCELLED"]);
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
    expect(getTableConfig(reminders).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "reminders_pending_remind_at_index",
        "reminders_task_id_index",
        "reminders_event_id_index"
      ])
    );
    expect([
      categoriesRelations,
      tasksRelations,
      eventsRelations,
      remindersRelations,
      applicationsRelations,
      applicationAliasesRelations
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
