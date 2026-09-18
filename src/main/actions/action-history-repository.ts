import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type {
  ActionHistoryListInput,
  ActionHistoryRecord,
  ActionName,
  ActionRiskLevel,
  SafeHistoryMetadata,
  TerminalActionStatus
} from "../../shared/action-contracts";
import { getDatabase, type AresDatabase } from "../database/database-client";
import { actionHistory } from "../database/schema";

export type PersistActionHistoryInput = {
  actionId: string;
  action: ActionName;
  riskLevel: ActionRiskLevel;
  status: TerminalActionStatus;
  userSummary: string;
  errorCode?: string;
  metadata?: SafeHistoryMetadata;
  startedAt: Date;
  finishedAt?: Date;
};

export class ActionHistoryRepositoryError extends Error {
  public constructor() {
    super("Action history persistence failed.");
    this.name = "ActionHistoryRepositoryError";
  }
}

export type ActionHistoryRepository = {
  record: (input: PersistActionHistoryInput) => Promise<ActionHistoryRecord>;
  list: (input: Required<Pick<ActionHistoryListInput, "limit">> & ActionHistoryListInput) => Promise<ActionHistoryRecord[]>;
};

const mapRecord = (record: typeof actionHistory.$inferSelect): ActionHistoryRecord => ({
  id: record.id,
  actionId: record.actionId,
  action: record.actionName as ActionName,
  riskLevel: record.riskLevel as ActionRiskLevel,
  status: record.resultStatus as TerminalActionStatus,
  userSummary: record.userSummary,
  errorCode: record.errorCode,
  metadata: record.metadata as SafeHistoryMetadata | null,
  startedAt: record.startedAt.toISOString(),
  finishedAt: record.finishedAt?.toISOString() ?? null,
  createdAt: record.createdAt.toISOString()
});

const executePersistence = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new ActionHistoryRepositoryError();
  }
};

export const createActionHistoryRepository = (
  database: AresDatabase = getDatabase()
): ActionHistoryRepository => ({
  record: async (input) =>
    executePersistence(async () => {
      const [record] = await database
        .insert(actionHistory)
        .values({
          actionId: input.actionId,
          actionName: input.action,
          riskLevel: input.riskLevel,
          resultStatus: input.status,
          userSummary: input.userSummary,
          errorCode: input.errorCode,
          metadata: input.metadata,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt
        })
        .returning();
      return mapRecord(record);
    }),
  list: async (input) =>
    executePersistence(async () => {
      const conditions = [
        ...(input.actionId === undefined ? [] : [eq(actionHistory.actionId, input.actionId)]),
        ...(input.actions === undefined ? [] : [inArray(actionHistory.actionName, input.actions)]),
        ...(input.statuses === undefined ? [] : [inArray(actionHistory.resultStatus, input.statuses)]),
        ...(input.riskLevels === undefined ? [] : [inArray(actionHistory.riskLevel, input.riskLevels)]),
        ...(input.startedAtFrom === undefined
          ? []
          : [gte(actionHistory.startedAt, new Date(input.startedAtFrom))]),
        ...(input.startedAtTo === undefined
          ? []
          : [lte(actionHistory.startedAt, new Date(input.startedAtTo))])
      ];
      const records = await database
        .select()
        .from(actionHistory)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(desc(actionHistory.startedAt), desc(actionHistory.id))
        .limit(input.limit);
      return records.map(mapRecord);
    })
});
