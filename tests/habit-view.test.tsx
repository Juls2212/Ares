import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  HabitDailyProgressData,
  HabitRecord,
  HabitWeeklyProgressData,
  HabitsApi
} from "../src/shared/habit-contracts";
import type { CategoryRecord, PlannerApi } from "../src/shared/planner-contracts";
import { completeHabitForDate, loadHabitData, localHabitDate, localMondayForHabitWeek } from "../src/renderer/features/calendar/habit-data";
import { createHabitMutationInput, dailyDetail, HabitCard, HabitFormDialog, habitFormValues, isDailyHabitCompleted, updateHabitMutationInput, validateHabitForm, weeklyDetail } from "../src/renderer/features/calendar/habit-planner";

const calendarViewSource = readFileSync(path.resolve(process.cwd(), "src/renderer/views/calendar-view.tsx"), "utf8");
const habitPlannerSource = readFileSync(path.resolve(process.cwd(), "src/renderer/features/calendar/habit-planner.tsx"), "utf8");

const dailyHabit: HabitRecord = {
  id: "habit-daily",
  title: "Leer",
  description: "Lectura breve",
  categoryId: "category-1",
  icon: "BOOK",
  frequency: "DAILY",
  targetCount: 1,
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
};
const weeklyHabit: HabitRecord = { ...dailyHabit, id: "habit-weekly", title: "Entrenar", description: null, categoryId: null, frequency: "WEEKLY", targetCount: 5 };
const category: CategoryRecord = { id: "category-1", name: "Personal", color: "#123456", icon: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const dailyProgress: HabitDailyProgressData = {
  date: "2026-09-21",
  completed: [{ habit: dailyHabit, completed: true, completion: { id: "completion-1", habitId: dailyHabit.id, completedOn: "2026-09-21", completedAt: "2026-09-21T10:00:00.000Z" }, currentStreak: 4, longestStreak: 9 }],
  pending: []
};
const weeklyProgress: HabitWeeklyProgressData = {
  weekStart: "2026-09-21",
  weekEnd: "2026-09-27",
  items: [{ habit: weeklyHabit, completionCount: 3, targetCount: 5, periodTargetCount: 5, targetMet: false, currentStreak: 1, longestStreak: 3 }]
};

const habitsApi = (overrides: Partial<HabitsApi> = {}): HabitsApi => ({
  create: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  getDailyProgress: vi.fn().mockResolvedValue({ ok: true, data: dailyProgress }),
  getWeeklyProgress: vi.fn().mockResolvedValue({ ok: true, data: weeklyProgress }),
  ...overrides
});

const plannerApi = (categories = [category]): PlannerApi => ({
  categories: { list: vi.fn().mockResolvedValue({ ok: true, data: { items: categories, total: categories.length } }) }
} as unknown as PlannerApi);

describe("habit planner data", () => {
  it("uses browser-local dates and requests both real daily and Monday through Sunday progress", async () => {
    const now = new Date(2026, 8, 21, 13, 0, 0);
    const habits = habitsApi();
    const planner = plannerApi();

    const data = await loadHabitData(habits, planner, now);

    expect(localHabitDate(now)).toBe("2026-09-21");
    expect(localMondayForHabitWeek(now)).toBe("2026-09-21");
    expect(habits.getDailyProgress).toHaveBeenCalledWith({ date: "2026-09-21" });
    expect(habits.getWeeklyProgress).toHaveBeenCalledWith({ weekStart: "2026-09-21" });
    expect(planner.categories.list).toHaveBeenCalledWith({});
    expect(data).toMatchObject({ daily: dailyProgress, weekly: weeklyProgress, categories: [category] });
  });

  it("keeps controlled daily, weekly, and category failures separate from usable data", async () => {
    const habits = habitsApi({
      getDailyProgress: vi.fn().mockResolvedValue({ ok: false, error: { code: "HABIT_DATABASE_UNAVAILABLE", userMessage: "private detail" } }),
      getWeeklyProgress: vi.fn().mockRejectedValue(new Error("private detail"))
    });
    const planner = plannerApi();
    vi.mocked(planner.categories.list).mockRejectedValue(new Error("private detail"));

    const data = await loadHabitData(habits, planner, new Date(2026, 8, 21));

    expect(data.daily).toBeNull();
    expect(data.weekly).toBeNull();
    expect(data.categories).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("private detail");
  });

  it("records a completion only through the explicit API and reports controlled failures", async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true, data: { record: dailyProgress.completed[0]!.completion } });
    expect(await completeHabitForDate(habitsApi({ complete }), dailyHabit.id, "2026-09-21")).toBe(true);
    expect(complete).toHaveBeenCalledWith({ habitId: dailyHabit.id, completedOn: "2026-09-21" });
    expect(await completeHabitForDate(habitsApi({ complete: vi.fn().mockResolvedValue({ ok: false, error: { code: "HABIT_NOT_FOUND", userMessage: "private detail" } }) }), dailyHabit.id, "2026-09-21")).toBe(false);
  });
});

describe("habit planner presentation", () => {
  it("renders selected pending actions, completed daily state, and grounded weekly progress", () => {
    const pendingMarkup = renderToStaticMarkup(createElement(HabitCard, {
      habit: dailyHabit,
      category,
      selected: true,
      detail: "Pendiente hoy · Racha actual: 2",
      completionLabel: "Completar hoy",
      onSelect: vi.fn(), onEdit: vi.fn(), onComplete: vi.fn()
    }));
    const completedMarkup = renderToStaticMarkup(createElement(HabitCard, {
      habit: dailyHabit,
      category,
      selected: true,
      detail: dailyDetail(dailyProgress.completed[0]!),
      onSelect: vi.fn(), onEdit: vi.fn()
    }));

    expect(pendingMarkup).toContain("Completar hoy");
    expect(pendingMarkup).toContain("Personal");
    expect(completedMarkup).toContain("Completado hoy · Racha actual: 4");
    expect(completedMarkup).not.toContain("Completar hoy");
    expect(weeklyDetail(weeklyProgress.items[0]!)).toBe("3 de 5 veces esta semana · Meta pendiente · Racha actual: 1 · Mejor racha: 3");
  });

  it("prefills create and edit forms, validates locally, and contains no deletion affordance", () => {
    expect(habitFormValues(weeklyHabit)).toEqual({ title: "Entrenar", description: "", frequency: "WEEKLY", targetCount: 5, categoryId: "", icon: "BOOK" });
    expect(validateHabitForm({ title: "", description: "", frequency: "DAILY", targetCount: 1, categoryId: "", icon: "SPARK" })).toBe("Escribe un título para el hábito.");
    expect(validateHabitForm({ title: "Leer", description: "", frequency: "DAILY", targetCount: 2, categoryId: "", icon: "SPARK" })).toContain("una vez");
    const markup = renderToStaticMarkup(createElement(HabitFormDialog, { habit: weeklyHabit, categories: [category], onCancel: vi.fn(), onSave: vi.fn(async () => ({ saved: false, message: "No se pudo guardar el hábito." })) }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('value="Entrenar"');
    expect(markup).toContain("Cancelar");
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Libro"');
    expect(markup).not.toContain("Eliminar");
  });

  it("hides the category selector when no real categories are available", () => {
    const emptyMarkup = renderToStaticMarkup(createElement(HabitFormDialog, { habit: null, categories: [], onCancel: vi.fn(), onSave: vi.fn(async () => ({ saved: true })) }));
    const populatedMarkup = renderToStaticMarkup(createElement(HabitFormDialog, { habit: null, categories: [category], onCancel: vi.fn(), onSave: vi.fn(async () => ({ saved: true })) }));

    expect(emptyMarkup).not.toContain("Categoría (opcional)");
    expect(emptyMarkup).not.toContain("Sin categoría");
    expect(populatedMarkup).toContain("Categoría (opcional)");
    expect(populatedMarkup).toContain("Sin categoría");
  });

  it("renders confirmed daily and target-met weekly states without another completion action", () => {
    const completedMarkup = renderToStaticMarkup(createElement(HabitCard, {
      habit: dailyHabit, category, selected: false, detail: dailyDetail(dailyProgress.completed[0]!), completionState: "✓ Completado hoy", progress: { value: 1, maximum: 1, label: "Hábito completado" }, onSelect: vi.fn(), onEdit: vi.fn()
    }));
    const targetMetMarkup = renderToStaticMarkup(createElement(HabitCard, {
      habit: weeklyHabit, selected: false, detail: weeklyDetail({ ...weeklyProgress.items[0]!, completionCount: 5, targetMet: true }), completionState: "✓ Meta cumplida", progress: { value: 5, maximum: 5, label: "5 de 5 veces esta semana" }, onSelect: vi.fn(), onEdit: vi.fn()
    }));

    expect(completedMarkup).toContain("✓ Completado hoy");
    expect(completedMarkup).not.toContain("Completar hoy");
    expect(targetMetMarkup).toContain("✓ Meta cumplida");
    expect(targetMetMarkup).not.toContain("Completar hoy");
  });

  it("uses a Main-confirmed completion only until the refreshed daily result reconciles it", () => {
    const pending = { ...dailyProgress.completed[0]!, completed: false, completion: null };
    expect(isDailyHabitCompleted(pending, new Set())).toBe(false);
    expect(isDailyHabitCompleted(pending, new Set([dailyHabit.id]))).toBe(true);
    expect(isDailyHabitCompleted(dailyProgress.completed[0]!, new Set())).toBe(true);
  });

  it("mounts habits as a third planner view without changing existing calendar and weekly paths", () => {
    expect(calendarViewSource).toContain('setPlannerView("HABITS")');
    expect(calendarViewSource).toContain('>Hábitos</button>');
    expect(calendarViewSource).toContain("<HabitPlanner");
    expect(calendarViewSource).toContain("<WeeklyRoutinePlanner");
    expect(calendarViewSource).toContain("<CalendarGrid");
    expect(habitPlannerSource).toContain("completionBusyIds.has(habit.id)");
    expect(habitPlannerSource).toContain("confirmedCompletionIds");
    const values = { title: " Caminar ", description: "", frequency: "DAILY" as const, targetCount: 1, categoryId: "", icon: "RUNNING" as const };
    expect(createHabitMutationInput(values)).toMatchObject({ title: "Caminar", icon: "RUNNING" });
    expect(updateHabitMutationInput(dailyHabit.id, values)).toMatchObject({ habitId: dailyHabit.id, icon: "RUNNING" });
    expect(habitPlannerSource).toContain("if (!completed) { setCompletionFailure(completionError); return; }");
    expect(habitPlannerSource).toContain("reload();");
  });
});
