import { getTableName, is } from "drizzle-orm";
import { getTableConfig, isPgEnum, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schemaModule from "../src/main/database/schema";
import { readSource } from "./helpers/read-source";

/**
 * Offline check of migration 0009 (drops the habit and weekly-schedule tables and enums): the SQL, the snapshot and the
 * journal entry agree with each other and with the Drizzle schema. No database is contacted and nothing is migrated.
 */

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, { columns: Record<string, unknown>; foreignKeys: Record<string, { tableTo: string }> }>;
  enums: Record<string, { name: string; values: string[] }>;
};

const TAG = "0009_remove_habits_and_weekly_schedules";
const DROPPED_TABLES = ["habit_completions", "habits", "weekly_routines", "weekly_schedules"];
const DROPPED_ENUMS = ["habit_frequency", "weekday"];

const schema: Record<string, unknown> = schemaModule;
const snapshot = (index: number): Snapshot => JSON.parse(readSource(`drizzle/meta/000${index}_snapshot.json`)) as Snapshot;
const journal = JSON.parse(readSource("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; tag: string; when: number; breakpoints: boolean; version: string }> };
const sql = readSource(`drizzle/${TAG}.sql`);
const statements = sql.split("--> statement-breakpoint").map((statement) => statement.trim());

describe("migration 0009: habit and weekly-schedule removal", () => {
  it("is the last journal entry, one after 0008, with a later timestamp and the same format", () => {
    const last = journal.entries.at(-1)!;
    const previous = journal.entries.at(-2)!;
    expect(last).toEqual({ idx: 9, version: "7", when: last.when, tag: TAG, breakpoints: true });
    expect(previous.tag).toBe("0008_messaging_contacts");
    expect(last.when).toBeGreaterThan(previous.when);
  });

  it("chains its snapshot to the 0008 snapshot with a new unique id", () => {
    const ids = journal.entries.map((_entry, index) => snapshot(index).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(snapshot(9).prevId).toBe(snapshot(8).id);
  });

  it("drops only the four tables and two enums, children first, guarded by IF EXISTS, and nothing else", () => {
    expect(statements.map((statement) => statement.replace(/^(?:--[^\n]*\n)+/u, "").trim())).toEqual([
      'DROP TABLE IF EXISTS "habit_completions";',
      'DROP TABLE IF EXISTS "habits";',
      'DROP TABLE IF EXISTS "weekly_routines";',
      'DROP TABLE IF EXISTS "weekly_schedules";',
      'DROP TYPE IF EXISTS "public"."habit_frequency";',
      'DROP TYPE IF EXISTS "public"."weekday";'
    ]);
    expect(sql).not.toMatch(/ALTER |DELETE |TRUNCATE |UPDATE |INSERT |CASCADE/iu);
    // The header comment states the data-loss consequence.
    expect(sql).toMatch(/permanently deletes every row/u);
  });

  it("keeps every dropped object in the 0008 snapshot (applied history is untouched) and removes it from 0009", () => {
    for (const table of DROPPED_TABLES) {
      expect(snapshot(8).tables, table).toHaveProperty(`public.${table}`);
      expect(snapshot(9).tables, table).not.toHaveProperty(`public.${table}`);
    }
    for (const name of DROPPED_ENUMS) {
      expect(snapshot(8).enums, name).toHaveProperty(`public.${name}`);
      expect(snapshot(9).enums, name).not.toHaveProperty(`public.${name}`);
    }
  });

  it("leaves no surviving foreign key or column that depends on a dropped table or enum", () => {
    for (const [name, table] of Object.entries(snapshot(9).tables)) {
      for (const foreignKey of Object.values(table.foreignKeys)) {
        expect(DROPPED_TABLES, `${name} -> ${foreignKey.tableTo}`).not.toContain(foreignKey.tableTo);
      }
      expect(JSON.stringify(table.columns), name).not.toMatch(/habit_frequency|"weekday"/u);
    }
  });

  it("describes exactly the tables, columns and enums the Drizzle schema declares", () => {
    const tables = Object.values(schema).filter((value): value is PgTable => is(value, PgTable));
    const described = snapshot(9).tables;
    expect(Object.keys(described).sort()).toEqual(tables.map((table) => `public.${getTableName(table)}`).sort());
    for (const table of tables) {
      const config = getTableConfig(table);
      expect(Object.keys(described[`public.${config.name}`]!.columns).sort(), config.name).toEqual(config.columns.map((column) => column.name).sort());
    }
    const enums = Object.values(schema).filter(isPgEnum) as unknown as Array<{ enumName: string; enumValues: readonly string[] }>;
    expect(Object.keys(snapshot(9).enums).sort()).toEqual(enums.map((entry) => `public.${entry.enumName}`).sort());
    for (const entry of enums) expect(snapshot(9).enums[`public.${entry.enumName}`]!.values, entry.enumName).toEqual([...entry.enumValues]);
  });

  it("exports no habit or weekly table, enum or relation from the schema", () => {
    expect(Object.keys(schema).filter((name) => /habit|weekly|weekday/iu.test(name))).toEqual([]);
  });
});
