import type { HabitDailyProgressData, HabitsApi } from "../../../shared/habit-contracts";
import { localHabitDate } from "../calendar/habit-data";

export type AresHabitSummaryData = {
  completedCount: number;
  totalCount: number;
  pending: HabitDailyProgressData["pending"];
};

export type AresHabitSummaryState =
  | { kind: "LOADING" }
  | { kind: "READY"; data: AresHabitSummaryData }
  | { kind: "ERROR" };

export const summarizeAresHabits = (daily: HabitDailyProgressData): AresHabitSummaryData => ({
  completedCount: daily.completed.length,
  totalCount: daily.completed.length + daily.pending.length,
  pending: daily.pending.slice(0, 2)
});

/** Reads only Main-authoritative progress for the current browser-local day. */
export const loadAresHabitSummary = async (
  habits: HabitsApi | undefined,
  now: Date = new Date()
): Promise<AresHabitSummaryState> => {
  if (!habits) return { kind: "ERROR" };
  try {
    const result = await habits.getDailyProgress({ date: localHabitDate(now) });
    return result.ok ? { kind: "READY", data: summarizeAresHabits(result.data) } : { kind: "ERROR" };
  } catch {
    return { kind: "ERROR" };
  }
};
