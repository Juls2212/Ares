import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
import { actionResultStatusEnum } from "./enums";

export const actionHistory = pgTable(
  "action_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actionId: varchar("action_id", { length: 128 }).notNull(),
    actionName: varchar("action_name", { length: 80 }).notNull(),
    riskLevel: smallint("risk_level").notNull(),
    resultStatus: actionResultStatusEnum("result_status").notNull(),
    userSummary: varchar("user_summary", { length: 500 }).notNull(),
    errorCode: varchar("error_code", { length: 128 }),
    metadata: jsonb("metadata"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check(
      "action_history_action_id_non_blank_check",
      sql`btrim(${table.actionId}) <> ''`
    ),
    check(
      "action_history_action_name_non_blank_check",
      sql`btrim(${table.actionName}) <> ''`
    ),
    check(
      "action_history_user_summary_non_blank_check",
      sql`btrim(${table.userSummary}) <> ''`
    ),
    check(
      "action_history_risk_level_check",
      sql`${table.riskLevel} IN (1, 2, 3)`
    ),
    check(
      "action_history_finished_after_started_check",
      sql`${table.finishedAt} IS NULL OR ${table.finishedAt} >= ${table.startedAt}`
    ),
    uniqueIndex("action_history_action_id_unique").on(table.actionId),
    index("action_history_started_at_index").on(table.startedAt),
    index("action_history_action_name_index").on(table.actionName),
    index("action_history_result_status_index").on(table.resultStatus)
  ]
);

export type ActionHistoryEntry = typeof actionHistory.$inferSelect;
export type NewActionHistoryEntry = typeof actionHistory.$inferInsert;
