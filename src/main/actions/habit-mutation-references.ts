import type { CategoryRecord } from "../../shared/planner-contracts";
import type { HabitRecord } from "../../shared/habit-contracts";
import type { HabitService } from "../habits/habit-service";
import type { PlannerService } from "../planner/planner-service";

const normalize = (value: string): string => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("es-CO");

type ResolvedHabit = { state: "RESOLVED"; habit: HabitRecord };
type ResolvedCategory = { state: "RESOLVED"; category: CategoryRecord };
type ReferenceState = { state: "MISSING" | "AMBIGUOUS" | "UNAVAILABLE" };

export type HabitMutationReferences = {
  resolveHabit: (title: string) => Promise<ResolvedHabit | ReferenceState>;
  resolveCategory: (name: string) => Promise<ResolvedCategory | ReferenceState>;
};

type ReferenceServices = Pick<HabitService, "list"> & { listCategories: PlannerService["listCategories"] };

const select = <T>(items: T[]): { state: "RESOLVED"; item: T } | ReferenceState =>
  items.length === 1 ? { state: "RESOLVED", item: items[0] } : items.length === 0 ? { state: "MISSING" } : { state: "AMBIGUOUS" };

/** Resolves user-visible names only in Main and never returns identifiers to the provider. */
export const createHabitMutationReferences = (
  getServices: () => ReferenceServices
): HabitMutationReferences => ({
  resolveHabit: async (title) => {
    try {
      const result = await getServices().list({});
      if (!result.ok) return { state: "UNAVAILABLE" };
      const selected = select(result.data.items.filter((habit) => habit.active && normalize(habit.title) === normalize(title)));
      return selected.state === "RESOLVED" ? { state: "RESOLVED", habit: selected.item } : selected;
    } catch {
      return { state: "UNAVAILABLE" };
    }
  },
  resolveCategory: async (name) => {
    try {
      const result = await getServices().listCategories({});
      if (!result.ok) return { state: "UNAVAILABLE" };
      const selected = select(result.data.items.filter((category) => normalize(category.name) === normalize(name)));
      return selected.state === "RESOLVED" ? { state: "RESOLVED", category: selected.item } : selected;
    } catch {
      return { state: "UNAVAILABLE" };
    }
  }
});
