import type {
  HabitDailyProgressData,
  HabitOperationResult,
  HabitWeeklyProgressData,
  HabitsApi
} from "../../../shared/habit-contracts";
import type { CategoryRecord, PlannerApi } from "../../../shared/planner-contracts";

export type HabitLoadData = {
  daily: HabitDailyProgressData | null;
  weekly: HabitWeeklyProgressData | null;
  categories: CategoryRecord[];
  dailyError?: string;
  weeklyError?: string;
  categoryError?: string;
};

const dailyUnavailableMessage = "No se pudieron cargar los hábitos de hoy.";
const weeklyUnavailableMessage = "No se pudo cargar el progreso semanal.";
const categoryUnavailableMessage = "No se pudieron cargar las categorías.";

export const localHabitDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const localMondayForHabitWeek = (date: Date): string => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = start.getDay();
  start.setDate(start.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return localHabitDate(start);
};

const settledData = async <T>(request: () => Promise<HabitOperationResult<T>>, fallback: string): Promise<{ data: T | null; error?: string }> => {
  try {
    const result = await request();
    return result.ok ? { data: result.data } : { data: null, error: fallback };
  } catch {
    return { data: null, error: fallback };
  }
};

export const loadHabitData = async (
  habits: HabitsApi | undefined,
  planner: PlannerApi | undefined,
  now: Date
): Promise<HabitLoadData> => {
  if (!habits) {
    return {
      daily: null,
      weekly: null,
      categories: [],
      dailyError: dailyUnavailableMessage,
      weeklyError: weeklyUnavailableMessage,
      categoryError: categoryUnavailableMessage
    };
  }

  const date = localHabitDate(now);
  const weekStart = localMondayForHabitWeek(now);
  const categoryRequest = planner
    ? Promise.resolve().then(() => planner.categories.list({})).catch(() => null)
    : Promise.resolve(null);
  const [daily, weekly, categories] = await Promise.all([
    settledData(() => habits.getDailyProgress({ date }), dailyUnavailableMessage),
    settledData(() => habits.getWeeklyProgress({ weekStart }), weeklyUnavailableMessage),
    categoryRequest
  ]);
  const categoryResult = categories && categories.ok ? categories.data.items : [];

  return {
    daily: daily.data,
    weekly: weekly.data,
    categories: categoryResult,
    ...(daily.error ? { dailyError: daily.error } : {}),
    ...(weekly.error ? { weeklyError: weekly.error } : {}),
    ...(categories && !categories.ok ? { categoryError: categoryUnavailableMessage } : {}),
    ...(!categories ? { categoryError: categoryUnavailableMessage } : {})
  };
};

export const completeHabitForDate = async (
  habits: HabitsApi | undefined,
  habitId: string,
  date: string
): Promise<boolean> => {
  if (!habits) return false;
  try {
    const result = await habits.complete({ habitId, completedOn: date });
    return result.ok;
  } catch {
    return false;
  }
};
