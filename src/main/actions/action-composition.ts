import { createActionHistoryService, type ActionHistoryService } from "./action-history-service";
import { createActionOrchestrator, type ActionOrchestrator } from "./action-orchestrator";

let actionHistoryService: ActionHistoryService | undefined;
let actionOrchestrator: ActionOrchestrator | undefined;

export const getActionHistoryService = (): ActionHistoryService => {
  actionHistoryService ??= createActionHistoryService();
  return actionHistoryService;
};

export const getActionOrchestrator = (): ActionOrchestrator => {
  actionOrchestrator ??= createActionOrchestrator({
    historyService: getActionHistoryService()
  });
  return actionOrchestrator;
};
