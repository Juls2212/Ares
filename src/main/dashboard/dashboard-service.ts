import {
  DASHBOARD_ERROR_CODES,
  DASHBOARD_SECTION_LIMIT,
  type DashboardOperationResult,
  type DashboardTodaySummary
} from "../../shared/dashboard-contracts";
import { createActionHistoryService, type ActionHistoryService } from "../actions/action-history-service";
import {
  createDefaultPlannerClock,
  type PlannerClock
} from "../planner/planner-service";
import {
  createDashboardRepository,
  DashboardRepositoryError,
  type DashboardRepository
} from "./dashboard-repository";

export type DashboardClock = Pick<PlannerClock, "getLocalDate" | "getRangeBounds"> & {
  now: () => Date;
};

export type DashboardService = {
  getTodaySummary: () => Promise<DashboardOperationResult<DashboardTodaySummary>>;
};

type DashboardServiceDependencies = {
  repository: DashboardRepository;
  historyService: ActionHistoryService;
  clock: DashboardClock;
  logError: (message: string) => void;
};

const createFailure = <T>(): DashboardOperationResult<T> => ({
  ok: false,
  error: {
    code: DASHBOARD_ERROR_CODES.unavailable,
    userMessage: "No se pudo cargar el resumen de inicio."
  }
});

const createDefaultDashboardClock = (): DashboardClock => {
  const plannerClock = createDefaultPlannerClock();
  return { ...plannerClock, now: () => new Date() };
};

export const createDashboardService = (
  overrides: Partial<DashboardServiceDependencies> = {}
): DashboardService => {
  const dependencies: DashboardServiceDependencies = {
    repository: overrides.repository ?? createDashboardRepository(),
    historyService: overrides.historyService ?? createActionHistoryService(),
    clock: overrides.clock ?? createDefaultDashboardClock(),
    logError: overrides.logError ?? ((message) => console.error(message))
  };

  return {
    getTodaySummary: async () => {
      const generatedAt = dependencies.clock.now();
      const localDate = dependencies.clock.getLocalDate();
      const todayBounds = dependencies.clock.getRangeBounds(localDate, 1);
      const upcomingEnd = new Date(generatedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

      try {
        const [
          todayTasks,
          todayEvents,
          todayReminders,
          pendingTasks,
          upcomingEvents,
          upcomingReminders,
          activityResult
        ] = await Promise.all([
          dependencies.repository.listTodayTasks(localDate, DASHBOARD_SECTION_LIMIT),
          dependencies.repository.listTodayEvents(
            new Date(todayBounds.startAt),
            new Date(todayBounds.endAt),
            DASHBOARD_SECTION_LIMIT
          ),
          dependencies.repository.listTodayReminders(
            new Date(todayBounds.startAt),
            new Date(todayBounds.endAt),
            DASHBOARD_SECTION_LIMIT
          ),
          dependencies.repository.listPendingTasks(DASHBOARD_SECTION_LIMIT),
          dependencies.repository.listUpcomingEvents(generatedAt, upcomingEnd, DASHBOARD_SECTION_LIMIT),
          dependencies.repository.listUpcomingPendingReminders(
            generatedAt,
            upcomingEnd,
            DASHBOARD_SECTION_LIMIT
          ),
          dependencies.historyService.list({ limit: DASHBOARD_SECTION_LIMIT })
        ]);
        if (!activityResult.ok) return createFailure();

        return {
          ok: true,
          data: {
            today: {
              localDate,
              tasks: todayTasks,
              events: todayEvents,
              reminders: todayReminders
            },
            pendingTasks,
            upcomingEvents,
            upcomingReminders,
            recentActivity: activityResult.data.items,
            generatedAt: generatedAt.toISOString()
          }
        };
      } catch (error) {
        if (!(error instanceof DashboardRepositoryError)) {
          dependencies.logError("Dashboard summary retrieval failed.");
        }
        return createFailure();
      }
    }
  };
};
