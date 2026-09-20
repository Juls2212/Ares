import { createDashboardService, type DashboardService } from "./dashboard-service";

let dashboardService: DashboardService | undefined;

export const getDashboardService = (): DashboardService => {
  dashboardService ??= createDashboardService();
  return dashboardService;
};
