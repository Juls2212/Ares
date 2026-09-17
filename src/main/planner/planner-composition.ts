import { createPlannerService, type PlannerService } from "./planner-service";

let plannerService: PlannerService | undefined;

export const getPlannerService = (): PlannerService => {
  plannerService ??= createPlannerService();
  return plannerService;
};
