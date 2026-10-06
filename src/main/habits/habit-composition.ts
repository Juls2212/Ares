import { createHabitService, type HabitService } from "./habit-service";

let habitService: HabitService | undefined;

export const getHabitService = (): HabitService => {
  habitService ??= createHabitService();
  return habitService;
};
