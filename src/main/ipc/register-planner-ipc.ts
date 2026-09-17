import { ipcMain } from "electron";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import {
  PLANNER_ERROR_CODES,
  type PlannerOperationResult
} from "../../shared/planner-contracts";
import { getPlannerService } from "../planner/planner-composition";
import type { PlannerService } from "../planner/planner-service";

export type PlannerIpcHandler = (input: unknown) => Promise<OperationResult<unknown>>;
export type PlannerIpcHandlerRegistrar = (
  channel: string,
  handler: PlannerIpcHandler
) => void;

type PlannerIpcDependencies = {
  registerHandler: PlannerIpcHandlerRegistrar;
  getService: () => PlannerService;
  logError: (message: string) => void;
};

const createUnexpectedFailure = <T>(): PlannerOperationResult<T> => ({
  ok: false,
  error: {
    code: PLANNER_ERROR_CODES.ipcUnavailable,
    userMessage: "No se pudo procesar la solicitud del planificador."
  }
});

const createHandler = <T>(
  getService: () => PlannerService,
  operation: (service: PlannerService, input: unknown) => Promise<PlannerOperationResult<T>>,
  logError: (message: string) => void
): PlannerIpcHandler => async (input) => {
  try {
    return await operation(getService(), input);
  } catch {
    logError("Planner IPC handler failed.");
    return createUnexpectedFailure<T>();
  }
};

export const createPlannerIpcRegistration = (dependencies: PlannerIpcDependencies): (() => void) => {
  let registered = false;

  return (): void => {
    if (registered) {
      return;
    }

    dependencies.registerHandler(
      IPC_CHANNELS.planner.categories.create,
      createHandler(dependencies.getService, (service, input) => service.createCategory(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.categories.list,
      createHandler(dependencies.getService, (service, input) => service.listCategories(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.categories.update,
      createHandler(dependencies.getService, (service, input) => service.updateCategory(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.tasks.create,
      createHandler(dependencies.getService, (service, input) => service.createTask(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.tasks.list,
      createHandler(dependencies.getService, (service, input) => service.listTasks(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.tasks.update,
      createHandler(dependencies.getService, (service, input) => service.updateTask(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.tasks.complete,
      createHandler(dependencies.getService, (service, input) => service.completeTask(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.events.create,
      createHandler(dependencies.getService, (service, input) => service.createEvent(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.events.list,
      createHandler(dependencies.getService, (service, input) => service.listEvents(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.events.update,
      createHandler(dependencies.getService, (service, input) => service.updateEvent(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.reminders.create,
      createHandler(dependencies.getService, (service, input) => service.createReminder(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.reminders.list,
      createHandler(dependencies.getService, (service, input) => service.listReminders(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.schedule.getToday,
      createHandler(dependencies.getService, (service, input) => service.getTodaySchedule(input), dependencies.logError)
    );
    dependencies.registerHandler(
      IPC_CHANNELS.planner.schedule.getWeek,
      createHandler(dependencies.getService, (service, input) => service.getWeekSchedule(input), dependencies.logError)
    );

    registered = true;
  };
};

const registerElectronHandler: PlannerIpcHandlerRegistrar = (channel, handler): void => {
  ipcMain.handle(channel, (_event, input: unknown) => handler(input));
};

export const registerPlannerIpcHandlers = createPlannerIpcRegistration({
  registerHandler: registerElectronHandler,
  getService: getPlannerService,
  logError: (message) => {
    console.error(message);
  }
});
