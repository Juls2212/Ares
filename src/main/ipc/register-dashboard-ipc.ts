import { ipcMain } from "electron";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  DASHBOARD_ERROR_CODES,
  type DashboardOperationResult,
  type DashboardTodaySummary
} from "../../shared/dashboard-contracts";
import { getDashboardService } from "../dashboard/dashboard-composition";
import type { DashboardService } from "../dashboard/dashboard-service";

export type DashboardIpcHandler = () => Promise<OperationResult<unknown>>;
export type DashboardIpcHandlerRegistrar = (channel: string, handler: DashboardIpcHandler) => void;

type DashboardIpcDependencies = {
  registerHandler: DashboardIpcHandlerRegistrar;
  getService: () => DashboardService;
  logError: (message: string) => void;
};

const createUnexpectedFailure = (): DashboardOperationResult<DashboardTodaySummary> => ({
  ok: false,
  error: {
    code: DASHBOARD_ERROR_CODES.ipcUnavailable,
    userMessage: "No se pudo cargar el resumen de inicio."
  }
});

export const createDashboardIpcRegistration = (
  dependencies: DashboardIpcDependencies
): (() => void) => {
  let registered = false;

  return (): void => {
    if (registered) return;
    dependencies.registerHandler(IPC_CHANNELS.dashboard.getTodaySummary, async () => {
      try {
        return await dependencies.getService().getTodaySummary();
      } catch {
        dependencies.logError("Dashboard IPC handler failed.");
        return createUnexpectedFailure();
      }
    });
    registered = true;
  };
};

const registerElectronHandler: DashboardIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, () => handler());
};

export const registerDashboardIpcHandlers = createDashboardIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getDashboardService,
  logError: (message) => console.error(message)
});
