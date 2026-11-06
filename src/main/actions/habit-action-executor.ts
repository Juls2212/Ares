import type {
  ActionOutcome,
  ActionPolicy,
  HabitActionProposal
} from "../../shared/action-contracts";
import { getHabitService } from "../habits/habit-composition";
import type { HabitService } from "../habits/habit-service";
import { getPlannerService } from "../planner/planner-composition";
import type { PlannerService } from "../planner/planner-service";
import { createHabitMutationReferences, type HabitMutationReferences } from "./habit-mutation-references";

type HabitActionExecutorDependencies = {
  habitService?: HabitService;
  plannerService?: Pick<PlannerService, "listCategories">;
  now?: () => Date;
  timeZone?: () => string;
  references?: HabitMutationReferences;
  logError?: (message: string) => void;
};

export type HabitActionExecutor = {
  execute: (proposal: HabitActionProposal, policy: ActionPolicy) => Promise<ActionOutcome>;
};

const localDate = (now: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const addDays = (date: string, amount: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

const weekStartFor = (date: string): string => {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
};

const failed = (proposal: HabitActionProposal, policy: ActionPolicy, code: string, userSummary: string): ActionOutcome => ({
  actionId: proposal.actionId,
  action: proposal.action,
  riskLevel: policy.riskLevel,
  status: code === "HABIT_DATABASE_UNAVAILABLE" ? "EXECUTION_FAILED" : "VALIDATION_FAILED",
  errorCode: code,
  userSummary
});

const referenceFailure = (
  proposal: HabitActionProposal,
  policy: ActionPolicy,
  state: "MISSING" | "AMBIGUOUS" | "UNAVAILABLE",
  kind: "habit" | "category"
): ActionOutcome => failed(
  proposal,
  policy,
  state === "UNAVAILABLE" ? "HABIT_DATABASE_UNAVAILABLE" : "HABIT_NOT_FOUND",
  kind === "habit"
    ? state === "MISSING" ? "No encontré ese hábito activo." : state === "AMBIGUOUS" ? "Encontré varios hábitos con ese nombre. Indica uno más específico." : "No se pudieron consultar los hábitos."
    : state === "MISSING" ? "No encontré esa categoría." : state === "AMBIGUOUS" ? "Encontré varias categorías con ese nombre. Indica una más específica." : "No se pudieron consultar las categorías."
);

const boundedNames = (names: string[]): string => names.slice(0, 3).map((name) => `«${name}»`).join(", ");

export const createHabitActionExecutor = (
  overrides: HabitActionExecutorDependencies = {}
): HabitActionExecutor => {
  const habitService = overrides.habitService ?? getHabitService();
  const plannerService = overrides.plannerService ?? getPlannerService();
  const references = overrides.references ?? createHabitMutationReferences(() => ({ ...habitService, listCategories: plannerService.listCategories }));
  const now = overrides.now ?? (() => new Date());
  const timeZone = overrides.timeZone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const logError = overrides.logError ?? (() => undefined);

  return {
    execute: async (proposal, policy) => {
      try {
        const today = localDate(now(), timeZone());
        if (proposal.action === "GET_HABIT_PROGRESS") {
          const title = proposal.input.habitTitle;
          const resolved = title ? await references.resolveHabit(title) : undefined;
          if (resolved && resolved.state !== "RESOLVED") return referenceFailure(proposal, policy, resolved.state, "habit");
          if (!resolved && proposal.input.scope === "WEEK") {
            const weekly = await habitService.getWeeklyProgress({ weekStart: weekStartFor(today) });
            if (!weekly.ok) return failed(proposal, policy, weekly.error.code, weekly.error.userMessage);
            if (weekly.data.items.length === 0) {
              return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: "Esta semana no tienes hábitos activos." };
            }
            const items = weekly.data.items.slice(0, 3).map((item) => `«${item.habit.title}»: ${item.completionCount} de ${item.targetCount}`);
            const remaining = weekly.data.items.length - items.length;
            return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: `Progreso de esta semana: ${items.join("; ")}.${remaining > 0 ? ` Además, tienes ${remaining} hábitos más.` : ""}` };
          }
          if (resolved?.state === "RESOLVED" && resolved.habit.frequency === "WEEKLY") {
            const weekly = await habitService.getWeeklyProgress({ weekStart: weekStartFor(today) });
            if (!weekly.ok) return failed(proposal, policy, weekly.error.code, weekly.error.userMessage);
            const item = weekly.data.items.find((entry) => entry.habit.id === resolved.habit.id);
            if (!item) return referenceFailure(proposal, policy, "MISSING", "habit");
            return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: `«${item.habit.title}»: ${item.completionCount} de ${item.targetCount} veces esta semana. Racha actual: ${item.currentStreak}.` };
          }
          const daily = await habitService.getDailyProgress({ date: today });
          if (!daily.ok) return failed(proposal, policy, daily.error.code, daily.error.userMessage);
          const items = [...daily.data.completed, ...daily.data.pending];
          if (resolved?.state === "RESOLVED") {
            const item = items.find((entry) => entry.habit.id === resolved.habit.id);
            if (!item) return referenceFailure(proposal, policy, "MISSING", "habit");
            return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: `«${item.habit.title}»: ${item.completed ? "completado hoy" : "pendiente hoy"}. Racha actual: ${item.currentStreak}.` };
          }
          const completed = daily.data.completed.length;
          const total = items.length;
          const pending = daily.data.pending.map((item) => item.habit.title);
          return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: total === 0 ? "Hoy no tienes hábitos diarios activos." : `Hoy completaste ${completed} de ${total} hábitos.${pending.length ? ` Pendientes: ${boundedNames(pending)}.` : ""}` };
        }

        if (proposal.action === "CREATE_HABIT") {
          const category = proposal.input.categoryName ? await references.resolveCategory(proposal.input.categoryName) : undefined;
          if (category && category.state !== "RESOLVED") return referenceFailure(proposal, policy, category.state, "category");
          const { categoryName: _categoryName, ...input } = proposal.input;
          const result = await habitService.create({ ...input, ...(category ? { categoryId: category.category.id } : {}) });
          if (!result.ok) return failed(proposal, policy, result.error.code, result.error.userMessage);
          return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: `Listo, creé el hábito «${result.data.record.title}».` };
        }

        const habit = await references.resolveHabit(proposal.input.habitTitle);
        if (habit.state !== "RESOLVED") return referenceFailure(proposal, policy, habit.state, "habit");
        if (proposal.action === "UPDATE_HABIT") {
          const category = proposal.input.categoryName === undefined || proposal.input.categoryName === null ? undefined : await references.resolveCategory(proposal.input.categoryName);
          if (category && category.state !== "RESOLVED") return referenceFailure(proposal, policy, category.state, "category");
          const { habitTitle: _habitTitle, categoryName: _categoryName, ...input } = proposal.input;
          const result = await habitService.update({ ...input, habitId: habit.habit.id, ...(proposal.input.categoryName === null ? { categoryId: null } : category ? { categoryId: category.category.id } : {}) });
          if (!result.ok) return failed(proposal, policy, result.error.code, result.error.userMessage);
          return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: `Listo, actualicé el hábito «${result.data.record.title}».` };
        }

        const completionStatus = await habitService.isCompletedOn({ habitId: habit.habit.id, completedOn: today });
        if (!completionStatus.ok) return failed(proposal, policy, completionStatus.error.code, completionStatus.error.userMessage);
        if (completionStatus.data) {
          return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: `«${habit.habit.title}» ya estaba completado hoy.` };
        }
        const result = await habitService.complete({ habitId: habit.habit.id, completedOn: today });
        if (!result.ok) return failed(proposal, policy, result.error.code, result.error.userMessage);
        return { actionId: proposal.actionId, action: proposal.action, riskLevel: policy.riskLevel, status: "SUCCEEDED", data: {}, userSummary: `Listo, marqué «${habit.habit.title}» como completado hoy.` };
      } catch {
        logError("Habit action execution failed.");
        return failed(proposal, policy, "HABIT_DATABASE_UNAVAILABLE", "No se pudo completar la acción del hábito.");
      }
    }
  };
};
