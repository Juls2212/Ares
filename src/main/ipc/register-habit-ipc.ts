import { ipcMain } from "electron";
import { IPC_CHANNELS, type OperationResult } from "../../shared/contracts";
import { getHabitService } from "../habits/habit-composition";
import type { HabitService } from "../habits/habit-service";

type HabitIpcHandler = (input: unknown) => Promise<OperationResult<unknown>>;
type HabitIpcDependencies = {
  registerHandler: (channel: string, handler: HabitIpcHandler) => void;
  getService: () => HabitService;
  logError: (message: string) => void;
};

const controlledUnavailable = (): OperationResult<never> => ({ ok: false, error: { code: "HABIT_IPC_UNAVAILABLE", userMessage: "No se pudo procesar la solicitud de hábitos." } });

const createHandler = (getService: () => HabitService, method: (service: HabitService, input: unknown) => Promise<OperationResult<unknown>>, logError: (message: string) => void): HabitIpcHandler => async (input) => {
  try { return await method(getService(), input); }
  catch { logError("Habit IPC operation failed."); return controlledUnavailable(); }
};

export const createHabitIpcRegistration = (dependencies: HabitIpcDependencies): (() => void) => {
  let registered = false;
  return () => {
    if (registered) return;
    dependencies.registerHandler(IPC_CHANNELS.habits.create, createHandler(dependencies.getService, (service, input) => service.create(input), dependencies.logError));
    dependencies.registerHandler(IPC_CHANNELS.habits.list, createHandler(dependencies.getService, (service, input) => service.list(input), dependencies.logError));
    dependencies.registerHandler(IPC_CHANNELS.habits.update, createHandler(dependencies.getService, (service, input) => service.update(input), dependencies.logError));
    dependencies.registerHandler(IPC_CHANNELS.habits.complete, createHandler(dependencies.getService, (service, input) => service.complete(input), dependencies.logError));
    dependencies.registerHandler(IPC_CHANNELS.habits.getDailyProgress, createHandler(dependencies.getService, (service, input) => service.getDailyProgress(input), dependencies.logError));
    dependencies.registerHandler(IPC_CHANNELS.habits.getWeeklyProgress, createHandler(dependencies.getService, (service, input) => service.getWeeklyProgress(input), dependencies.logError));
    registered = true;
  };
};

export const registerHabitIpcHandlers = createHabitIpcRegistration({
  registerHandler: (channel, handler) => ipcMain.handle(channel, (_event, input: unknown) => handler(input)),
  getService: getHabitService,
  logError: (message) => console.error(message)
});
