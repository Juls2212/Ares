import {
  HABIT_ERROR_CODES,
  type CompleteHabitInput,
  type HabitCompletionRecord,
  type HabitDailyProgressData,
  type HabitFrequency,
  type HabitListData,
  type HabitMutationData,
  type HabitOperationResult,
  type HabitRecord,
  type HabitWeeklyProgressData,
  type UpdateHabitInput
} from "../../shared/habit-contracts";
import {
  isFrequencyTargetConsistent,
  validateCompleteHabitInput,
  validateCreateHabitInput,
  validateHabitDailyProgressInput,
  validateHabitListInput,
  validateHabitWeeklyProgressInput,
  validateUpdateHabitInput
} from "./habit-validation";
import { createHabitRepositories, HabitRepositoryError, type HabitRepositories } from "./habit-repository";

export type HabitService = {
  create: (input: unknown) => Promise<HabitOperationResult<HabitMutationData<HabitRecord>>>;
  list: (input: unknown) => Promise<HabitOperationResult<HabitListData<HabitRecord>>>;
  update: (input: unknown) => Promise<HabitOperationResult<HabitMutationData<HabitRecord>>>;
  complete: (input: unknown) => Promise<HabitOperationResult<HabitMutationData<HabitCompletionRecord>>>;
  isCompletedOn: (input: unknown) => Promise<HabitOperationResult<boolean>>;
  getDailyProgress: (input: unknown) => Promise<HabitOperationResult<HabitDailyProgressData>>;
  getWeeklyProgress: (input: unknown) => Promise<HabitOperationResult<HabitWeeklyProgressData>>;
};

type HabitServiceDependencies = { repositories: HabitRepositories; logError: (message: string) => void };

const messages: Record<string, string> = {
  HABIT_INPUT_INVALID: "La información del hábito no es válida.",
  HABIT_UNKNOWN_FIELD: "La solicitud contiene campos no permitidos.",
  HABIT_REQUIRED_FIELD_MISSING: "Faltan datos requeridos del hábito.",
  HABIT_FIELD_TYPE_INVALID: "Uno de los campos del hábito tiene un formato no válido.",
  HABIT_TEXT_INVALID: "Uno de los textos del hábito no es válido.",
  HABIT_TEXT_TOO_LONG: "Uno de los textos supera la longitud permitida.",
  HABIT_IDENTIFIER_INVALID: "Uno de los identificadores no es válido.",
  HABIT_ENUM_INVALID: "La frecuencia del hábito no es válida.",
  HABIT_ICON_INVALID: "El icono del hábito no es válido.",
  HABIT_TARGET_COUNT_INVALID: "La meta del hábito no coincide con su frecuencia.",
  HABIT_DATE_INVALID: "La fecha del hábito no es válida.",
  HABIT_UPDATE_EMPTY: "Debes indicar al menos un cambio para actualizar.",
  HABIT_NOT_FOUND: "No se encontró el hábito solicitado.",
  HABIT_REFERENCE_NOT_FOUND: "No se encontró una categoría relacionada.",
  HABIT_CONFLICT: "El hábito ya tiene un registro para esa fecha.",
  HABIT_DATABASE_UNAVAILABLE: "No se pudo acceder a los datos de hábitos.",
  HABIT_IPC_UNAVAILABLE: "No se pudo procesar la solicitud de hábitos."
};

const success = <T>(data: T): HabitOperationResult<T> => ({ ok: true, data });
const failure = <T>(code: string): HabitOperationResult<T> => ({ ok: false, error: { code, userMessage: messages[code] ?? messages.HABIT_DATABASE_UNAVAILABLE } });
const listData = <T>(items: T[]): HabitListData<T> => ({ items, total: items.length });

const calendarDate = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
const addDays = (date: string, amount: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return calendarDate(value);
};
const weekStartFor = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  const weekday = value.getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
};

const longestConsecutive = (periods: readonly string[]): number => {
  const sorted = [...new Set(periods)].sort();
  let longest = 0;
  let current = 0;
  let previous: string | undefined;
  for (const period of sorted) {
    current = previous && addDays(previous, 1) === period ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = period;
  }
  return longest;
};

const dailyStreak = (completions: HabitCompletionRecord[], endingDate: string): { current: number; longest: number } => {
  const dates = new Set(completions.map((completion) => completion.completedOn));
  let current = 0;
  for (let date = endingDate; dates.has(date); date = addDays(date, -1)) current += 1;
  return { current, longest: longestConsecutive([...dates]) };
};

const weeklyStreak = (completions: HabitCompletionRecord[], target: number, endingWeek: string): { current: number; longest: number } => {
  const counts = new Map<string, number>();
  for (const completion of completions) {
    const week = weekStartFor(completion.completedOn);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  const qualifying = [...counts.entries()].filter(([, count]) => count >= target).map(([week]) => week).sort();
  const qualifyingSet = new Set(qualifying);
  let current = 0;
  for (let week = endingWeek; qualifyingSet.has(week); week = addDays(week, -7)) current += 1;
  let longest = 0;
  let run = 0;
  let previous: string | undefined;
  for (const week of qualifying) {
    run = previous && addDays(previous, 7) === week ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = week;
  }
  return { current, longest };
};

const periodTarget = (habit: HabitRecord): number => habit.frequency === "DAILY" ? 7 : habit.targetCount;

export const createHabitService = (overrides: Partial<HabitServiceDependencies> = {}): HabitService => {
  const dependencies: HabitServiceDependencies = {
    repositories: overrides.repositories ?? createHabitRepositories(),
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  const persistenceFailure = <T>(error: unknown): HabitOperationResult<T> => {
    if (error instanceof HabitRepositoryError) {
      if (error.kind === "REFERENCE_NOT_FOUND") return failure(HABIT_ERROR_CODES.referenceNotFound);
      if (error.kind === "CONFLICT") return failure(HABIT_ERROR_CODES.conflict);
    }
    dependencies.logError("Habit persistence operation failed.");
    return failure(HABIT_ERROR_CODES.databaseUnavailable);
  };

  const verifyCategory = async <T>(categoryId: string | null | undefined): Promise<HabitOperationResult<T> | undefined> => {
    if (categoryId === undefined || categoryId === null) return undefined;
    try { return await dependencies.repositories.findCategoryById(categoryId) ? undefined : failure(HABIT_ERROR_CODES.referenceNotFound); }
    catch (error) { return persistenceFailure(error); }
  };

  const activeHabits = async (): Promise<HabitOperationResult<HabitRecord[]>> => {
    try { return success(await dependencies.repositories.listHabits({})); }
    catch (error) { return persistenceFailure(error); }
  };

  const completionsFor = async (habitIds: string[], to?: string, from?: string): Promise<HabitOperationResult<HabitCompletionRecord[]>> => {
    try { return success(await dependencies.repositories.listCompletions({ habitIds, ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) })); }
    catch (error) { return persistenceFailure(error); }
  };

  return {
    create: async (input) => {
      const validation = validateCreateHabitInput(input);
      if (!validation.ok) return failure(validation.error.code);
      const categoryFailure = await verifyCategory<HabitMutationData<HabitRecord>>(validation.data.categoryId);
      if (categoryFailure) return categoryFailure;
      try { return success({ record: await dependencies.repositories.createHabit(validation.data) }); }
      catch (error) { return persistenceFailure(error); }
    },
    list: async (input) => {
      const validation = validateHabitListInput(input);
      if (!validation.ok) return failure(validation.error.code);
      try { return success(listData(await dependencies.repositories.listHabits(validation.data))); }
      catch (error) { return persistenceFailure(error); }
    },
    update: async (input) => {
      const validation = validateUpdateHabitInput(input);
      if (!validation.ok) return failure(validation.error.code);
      try {
        const existing = await dependencies.repositories.findHabitById(validation.data.habitId);
        if (!existing) return failure(HABIT_ERROR_CODES.notFound);
        const frequency: HabitFrequency = validation.data.frequency ?? existing.frequency;
        const targetCount = validation.data.targetCount ?? existing.targetCount;
        if (!isFrequencyTargetConsistent(frequency, targetCount)) return failure(HABIT_ERROR_CODES.targetCountInvalid);
        const categoryFailure = await verifyCategory<HabitMutationData<HabitRecord>>(validation.data.categoryId);
        if (categoryFailure) return categoryFailure;
        const record = await dependencies.repositories.updateHabit(validation.data);
        return record ? success({ record }) : failure(HABIT_ERROR_CODES.notFound);
      } catch (error) { return persistenceFailure(error); }
    },
    complete: async (input) => {
      const validation = validateCompleteHabitInput(input);
      if (!validation.ok) return failure(validation.error.code);
      try {
        const habit = await dependencies.repositories.findHabitById(validation.data.habitId);
        if (!habit) return failure(HABIT_ERROR_CODES.notFound);
        return success({ record: await dependencies.repositories.completeHabit(validation.data) });
      } catch (error) { return persistenceFailure(error); }
    },
    isCompletedOn: async (input) => {
      const validation = validateCompleteHabitInput(input);
      if (!validation.ok) return failure(validation.error.code);
      try {
        const habit = await dependencies.repositories.findHabitById(validation.data.habitId);
        if (!habit) return failure(HABIT_ERROR_CODES.notFound);
        const completions = await dependencies.repositories.listCompletions({
          habitIds: [validation.data.habitId],
          from: validation.data.completedOn,
          to: validation.data.completedOn
        });
        return success(completions.some((completion) => completion.completedOn === validation.data.completedOn));
      } catch (error) { return persistenceFailure(error); }
    },
    getDailyProgress: async (input) => {
      const validation = validateHabitDailyProgressInput(input);
      if (!validation.ok) return failure(validation.error.code);
      const habitsResult = await activeHabits();
      if (!habitsResult.ok) return habitsResult;
      const dailyHabits = habitsResult.data.filter((habit) => habit.frequency === "DAILY");
      const completionResult = await completionsFor(dailyHabits.map((habit) => habit.id), validation.data.date);
      if (!completionResult.ok) return completionResult;
      const byHabit = new Map<string, HabitCompletionRecord[]>();
      for (const completion of completionResult.data) byHabit.set(completion.habitId, [...(byHabit.get(completion.habitId) ?? []), completion]);
      const items = dailyHabits.map((habit) => {
        const history = byHabit.get(habit.id) ?? [];
        const completion = history.find((entry) => entry.completedOn === validation.data.date) ?? null;
        const streak = dailyStreak(history, validation.data.date);
        return { habit, completed: completion !== null, completion, currentStreak: streak.current, longestStreak: streak.longest };
      });
      return success({ date: validation.data.date, completed: items.filter((item) => item.completed), pending: items.filter((item) => !item.completed) });
    },
    getWeeklyProgress: async (input) => {
      const validation = validateHabitWeeklyProgressInput(input);
      if (!validation.ok) return failure(validation.error.code);
      const habitsResult = await activeHabits();
      if (!habitsResult.ok) return habitsResult;
      const weekEnd = addDays(validation.data.weekStart, 6);
      const completionResult = await completionsFor(habitsResult.data.map((habit) => habit.id), weekEnd);
      if (!completionResult.ok) return completionResult;
      const byHabit = new Map<string, HabitCompletionRecord[]>();
      for (const completion of completionResult.data) byHabit.set(completion.habitId, [...(byHabit.get(completion.habitId) ?? []), completion]);
      return success({
        weekStart: validation.data.weekStart,
        weekEnd,
        items: habitsResult.data.map((habit) => {
          const history = byHabit.get(habit.id) ?? [];
          const completionCount = history.filter((completion) => completion.completedOn >= validation.data.weekStart && completion.completedOn <= weekEnd).length;
          const targetCount = periodTarget(habit);
          const streak = habit.frequency === "DAILY" ? dailyStreak(history, weekEnd) : weeklyStreak(history, habit.targetCount, validation.data.weekStart);
          return { habit, completionCount, targetCount: habit.targetCount, periodTargetCount: targetCount, targetMet: completionCount >= targetCount, currentStreak: streak.current, longestStreak: streak.longest };
        })
      });
    }
  };
};
