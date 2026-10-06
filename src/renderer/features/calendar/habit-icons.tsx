import type { HabitIcon } from "../../../shared/habit-contracts";

export type HabitIconOption = {
  key: HabitIcon;
  label: string;
  glyph: string;
};

export const HABIT_ICON_OPTIONS: readonly HabitIconOption[] = [
  { key: "SPARK", label: "Brillo", glyph: "✦" },
  { key: "BOOK", label: "Libro", glyph: "📖" },
  { key: "DUMBBELL", label: "Mancuerna", glyph: "🏋" },
  { key: "HOME", label: "Hogar", glyph: "⌂" },
  { key: "HEART", label: "Corazón", glyph: "♥" },
  { key: "WATER", label: "Agua", glyph: "💧" },
  { key: "RUNNING", label: "Correr", glyph: "🏃" },
  { key: "BRAIN", label: "Mente", glyph: "🧠" },
  { key: "LEAF", label: "Hoja", glyph: "🍃" }
];

const iconMap = new Map(HABIT_ICON_OPTIONS.map((option) => [option.key, option]));

export const habitIconOption = (icon: HabitIcon): HabitIconOption =>
  iconMap.get(icon) ?? HABIT_ICON_OPTIONS[0]!;

export const HabitIconGlyph = ({ icon }: { icon: HabitIcon }) => {
  const option = habitIconOption(icon);
  return <span aria-hidden="true" className="habit-icon-glyph">{option.glyph}</span>;
};
