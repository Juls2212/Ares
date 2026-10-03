import type {
  CategoryRecord,
  PlannerApi,
  WeeklyRoutineRecord,
  WeeklyScheduleRecord
} from "../../../shared/planner-contracts";

export type WeeklyRoutineLoadData = {
  routines: WeeklyRoutineRecord[];
  categories: CategoryRecord[];
  routineError?: string;
  categoryError?: string;
};

export type WeeklyScheduleLoadData = {
  schedules: WeeklyScheduleRecord[];
  categories: CategoryRecord[];
  scheduleError?: string;
  categoryError?: string;
};

const routineUnavailableMessage = "No se pudieron cargar los bloques semanales.";
const categoryUnavailableMessage = "No se pudieron cargar las categorías.";
const scheduleUnavailableMessage = "No se pudieron cargar los horarios.";

export const loadWeeklyScheduleData = async (
  planner: PlannerApi | undefined
): Promise<WeeklyScheduleLoadData> => {
  if (!planner) {
    return {
      schedules: [],
      categories: [],
      scheduleError: scheduleUnavailableMessage,
      categoryError: categoryUnavailableMessage
    };
  }

  const [scheduleResult, categoryResult] = await Promise.allSettled([
    planner.weeklySchedules.list({}),
    planner.categories.list({})
  ]);
  const schedules = scheduleResult.status === "fulfilled" && scheduleResult.value.ok
    ? scheduleResult.value.data.items
    : [];
  const categories = categoryResult.status === "fulfilled" && categoryResult.value.ok
    ? categoryResult.value.data.items
    : [];

  return {
    schedules,
    categories,
    ...(scheduleResult.status === "fulfilled" && scheduleResult.value.ok ? {} : { scheduleError: scheduleUnavailableMessage }),
    ...(categoryResult.status === "fulfilled" && categoryResult.value.ok ? {} : { categoryError: categoryUnavailableMessage })
  };
};

export const loadWeeklyRoutineData = async (
  planner: PlannerApi | undefined,
  weeklyScheduleId: string | null
): Promise<WeeklyRoutineLoadData> => {
  if (!planner || !weeklyScheduleId) {
    return {
      routines: [],
      categories: [],
      ...(planner ? {} : { routineError: routineUnavailableMessage }),
      ...(planner ? {} : { categoryError: categoryUnavailableMessage })
    };
  }

  try {
    const routineResult = await planner.weeklyRoutines.list({ weeklyScheduleId });
    return {
      routines: routineResult.ok ? routineResult.data.items : [],
      categories: [],
      ...(routineResult.ok ? {} : { routineError: routineUnavailableMessage })
    };
  } catch {
    return { routines: [], categories: [], routineError: routineUnavailableMessage };
  }
};
