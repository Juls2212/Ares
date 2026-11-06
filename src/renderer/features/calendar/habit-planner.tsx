import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type {
  CreateHabitInput,
  HabitDailyProgressData,
  HabitDailyProgressItem,
  HabitIcon,
  HabitRecord,
  HabitWeeklyProgressData,
  HabitWeeklyProgressItem,
  UpdateHabitInput
} from "../../../shared/habit-contracts";
import type { CategoryRecord } from "../../../shared/planner-contracts";
import { completeHabitForDate, loadHabitData, localHabitDate, type HabitLoadData } from "./habit-data";
import { HABIT_ICON_OPTIONS, HabitIconGlyph } from "./habit-icons";

type HabitFormValues = {
  title: string;
  description: string;
  frequency: HabitRecord["frequency"];
  targetCount: number;
  categoryId: string;
  icon: HabitIcon;
};

type HabitDialogProperties = {
  habit: HabitRecord | null;
  categories: CategoryRecord[];
  categoryError?: string;
  onCancel: () => void;
  onSave: (values: HabitFormValues) => Promise<{ saved: boolean; message?: string }>;
};

type HabitCardProperties = {
  habit: HabitRecord;
  category?: CategoryRecord;
  selected: boolean;
  onSelect: () => void;
  onEdit: (trigger: HTMLButtonElement) => void;
  detail: string;
  completionLabel?: string;
  completionDisabled?: boolean;
  completionState?: string;
  progress?: { value: number; maximum: number; label: string };
  onComplete?: (trigger: HTMLButtonElement) => void;
};

const emptyHabitData: HabitLoadData = { daily: null, weekly: null, categories: [] };
const emptyHabitValues: HabitFormValues = { title: "", description: "", frequency: "DAILY", targetCount: 1, categoryId: "", icon: "SPARK" };
const mutationError = "No se pudo guardar el hábito. Revisa los campos e inténtalo de nuevo.";
const completionError = "No se pudo registrar el hábito como completado.";

export const habitFormValues = (habit: HabitRecord | null): HabitFormValues => habit ? {
  title: habit.title,
  description: habit.description ?? "",
  frequency: habit.frequency,
  targetCount: habit.targetCount,
  categoryId: habit.categoryId ?? "",
  icon: habit.icon
} : emptyHabitValues;

export const validateHabitForm = (values: HabitFormValues): string | undefined => {
  if (!values.title.trim()) return "Escribe un título para el hábito.";
  if (values.frequency === "DAILY" && values.targetCount !== 1) return "Los hábitos diarios deben tener una meta de una vez.";
  if (values.frequency === "WEEKLY" && (values.targetCount < 1 || values.targetCount > 7)) return "La meta semanal debe estar entre una y siete veces.";
  return undefined;
};

export const createHabitMutationInput = (values: HabitFormValues): CreateHabitInput => ({
  title: values.title.trim(),
  icon: values.icon,
  frequency: values.frequency,
  targetCount: values.targetCount,
  ...(values.description.trim() ? { description: values.description.trim() } : {}),
  ...(values.categoryId ? { categoryId: values.categoryId } : {})
});

export const updateHabitMutationInput = (habitId: string, values: HabitFormValues): UpdateHabitInput => ({
  habitId,
  title: values.title.trim(),
  description: values.description.trim() || null,
  icon: values.icon,
  frequency: values.frequency,
  targetCount: values.targetCount,
  categoryId: values.categoryId || null
});

type DialogKeyboardProperties = {
  first: RefObject<HTMLInputElement | null>;
  last: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onCancel: () => void;
};

const handleHabitDialogKey = (event: KeyboardEvent<HTMLDivElement>, { first, last, disabled, onCancel }: DialogKeyboardProperties): void => {
  if (event.key === "Escape" && !disabled) {
    event.preventDefault();
    onCancel();
    return;
  }
  if (event.key !== "Tab" || disabled) return;
  if (event.shiftKey && document.activeElement === first.current) {
    event.preventDefault();
    last.current?.focus();
  }
  if (!event.shiftKey && document.activeElement === last.current) {
    event.preventDefault();
    first.current?.focus();
  }
};

export const HabitFormDialog = ({ habit, categories, categoryError, onCancel, onSave }: HabitDialogProperties) => {
  const [values, setValues] = useState(() => habitFormValues(habit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const title = useRef<HTMLInputElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => { title.current?.focus(); }, []);

  const change = <K extends keyof HabitFormValues>(key: K, value: HabitFormValues[K]): void => {
    setValues((current) => {
      if (key === "frequency") {
        return { ...current, frequency: value as HabitRecord["frequency"], targetCount: value === "DAILY" ? 1 : Math.max(1, current.targetCount) };
      }
      return { ...current, [key]: value };
    });
  };

  const submit = (): void => {
    if (saving) return;
    const validationError = validateHabitForm(values);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(undefined);
    void onSave(values)
      .then((result) => { if (!result.saved) setError(result.message ?? mutationError); })
      .catch(() => setError(mutationError))
      .finally(() => setSaving(false));
  };

  return <div className="calendar-delete-backdrop"><div aria-labelledby="habit-form-title" aria-modal="true" className="calendar-edit-dialog habit-dialog" onKeyDown={(event) => handleHabitDialogKey(event, { first: title, last: save, disabled: saving, onCancel })} role="dialog" tabIndex={-1}>
    <p className="eyebrow">Hábitos</p><h2 id="habit-form-title">{habit ? "Editar hábito" : "Nuevo hábito"}</h2>
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label>Título<input disabled={saving} onChange={(event) => change("title", event.target.value)} ref={title} required value={values.title} /></label>
      <label>Descripción (opcional)<input disabled={saving} onChange={(event) => change("description", event.target.value)} value={values.description} /></label>
      <fieldset className="habit-dialog__icons"><legend>Icono</legend><div aria-label="Icono del hábito" role="radiogroup">{HABIT_ICON_OPTIONS.map((option) => <button aria-checked={values.icon === option.key} aria-label={option.label} className={values.icon === option.key ? "is-selected" : undefined} disabled={saving} key={option.key} onClick={() => change("icon", option.key)} role="radio" title={option.label} type="button"><span aria-hidden="true">{option.glyph}</span></button>)}</div></fieldset>
      <div className="habit-dialog__form-grid"><label>Frecuencia<select disabled={saving} onChange={(event) => change("frequency", event.target.value as HabitRecord["frequency"])} value={values.frequency}><option value="DAILY">Diario</option><option value="WEEKLY">Semanal</option></select></label>{values.frequency === "DAILY" ? <p className="habit-dialog__fixed-target"><strong>Meta diaria</strong><span>Una vez al día</span></p> : <label>Meta semanal<select aria-label="Meta semanal" disabled={saving} onChange={(event) => change("targetCount", Number(event.target.value))} value={values.targetCount}>{Array.from({ length: 7 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} veces</option>)}</select></label>}</div>
      {categories.length > 0 && <label>Categoría (opcional)<select disabled={saving || Boolean(categoryError)} onChange={(event) => change("categoryId", event.target.value)} value={values.categoryId}><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
      {categoryError && <p className="habit-dialog__category-error" role="status">{categoryError}</p>}
      {error && <p role="alert">{error}</p>}{saving && <p role="status">Guardando hábito...</p>}
      <div className="calendar-delete-actions"><button disabled={saving} onClick={onCancel} type="button">Cancelar</button><button disabled={saving} ref={save} type="submit">Guardar</button></div>
    </form>
  </div></div>;
};

export const HabitCard = ({ habit, category, selected, onSelect, onEdit, detail, completionLabel, completionDisabled, completionState, progress, onComplete }: HabitCardProperties) => <article className={`habit-card habit-card--${habit.frequency.toLowerCase()}${selected ? " is-selected" : ""}${completionState ? " is-completed" : ""}`}>
  <button aria-pressed={selected} aria-label={`Seleccionar hábito: ${habit.title}`} className="habit-card__select" onClick={onSelect} type="button"><HabitIconGlyph icon={habit.icon} /><span><strong>{habit.title}</strong><small>{habit.frequency === "DAILY" ? "Diario" : "Semanal"}{category ? ` · ${category.name}` : ""}</small></span><span className="habit-card__detail">{detail}</span></button>
  {progress && <div aria-label={progress.label} aria-valuemax={progress.maximum} aria-valuemin={0} aria-valuenow={progress.value} className="habit-card__progress" role="progressbar"><span style={{ width: `${Math.min(100, Math.round((progress.value / progress.maximum) * 100))}%` }} /></div>}
  {(selected || completionLabel || completionState) && <div className="habit-card__actions">{selected && <button aria-label={`Editar hábito: ${habit.title}`} onClick={(event) => onEdit(event.currentTarget)} type="button">Editar</button>}{completionState && <span className="habit-card__completed">{completionState}</span>}{completionLabel && onComplete && <button disabled={completionDisabled} onClick={(event) => onComplete(event.currentTarget)} type="button">{completionLabel}</button>}</div>}
</article>;

export const dailyDetail = (item: HabitDailyProgressItem): string => item.completed
  ? `Completado hoy · Racha actual: ${item.currentStreak}`
  : `Pendiente hoy · Racha actual: ${item.currentStreak}`;

export const weeklyDetail = (item: HabitWeeklyProgressItem): string => `${item.completionCount} de ${item.targetCount} veces esta semana · ${item.targetMet ? "Meta cumplida" : "Meta pendiente"} · Racha actual: ${item.currentStreak} · Mejor racha: ${item.longestStreak}`;

const dailyItems = (daily: HabitDailyProgressData | null): HabitDailyProgressItem[] => daily ? [...daily.completed, ...daily.pending] : [];
const weeklyItems = (weekly: HabitWeeklyProgressData | null): HabitWeeklyProgressItem[] => weekly?.items.filter((item) => item.habit.frequency === "WEEKLY") ?? [];

export const isDailyHabitCompleted = (item: HabitDailyProgressItem, confirmedCompletionIds: ReadonlySet<string>): boolean =>
  item.completed || confirmedCompletionIds.has(item.habit.id);

export const HabitPlanner = () => {
  const [data, setData] = useState<HabitLoadData>(emptyHabitData);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [habitToEdit, setHabitToEdit] = useState<HabitRecord | null | undefined>(undefined);
  const [completionBusyIds, setCompletionBusyIds] = useState<Set<string>>(() => new Set());
  const [confirmedCompletionIds, setConfirmedCompletionIds] = useState<Set<string>>(() => new Set());
  const [completionFailure, setCompletionFailure] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const today = localHabitDate(new Date());

  const reload = (): void => setReloadVersion((version) => version + 1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadHabitData(window.ares?.habits, window.ares?.planner, new Date())
      .then((result) => {
        if (!active) return;
        setData(result);
        if (result.daily) {
          const reconciled = new Set(result.daily.completed.map((item) => item.habit.id));
          setConfirmedCompletionIds((current) => new Set([...current].filter((habitId) => reconciled.has(habitId))));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadVersion]);

  const allHabits = useMemo(() => {
    const records = new Map<string, HabitRecord>();
    for (const item of dailyItems(data.daily)) records.set(item.habit.id, item.habit);
    for (const item of weeklyItems(data.weekly)) records.set(item.habit.id, item.habit);
    return records;
  }, [data.daily, data.weekly]);
  const categories = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);

  useEffect(() => {
    if (selectedHabitId && !allHabits.has(selectedHabitId)) setSelectedHabitId(null);
  }, [allHabits, selectedHabitId]);

  const complete = async (habit: HabitRecord): Promise<void> => {
    if (completionBusyIds.has(habit.id)) return;
    setCompletionBusyIds((current) => new Set(current).add(habit.id));
    setCompletionFailure(undefined);
    const completed = await completeHabitForDate(window.ares?.habits, habit.id, today);
    setCompletionBusyIds((current) => { const next = new Set(current); next.delete(habit.id); return next; });
    if (!completed) { setCompletionFailure(completionError); return; }
    setConfirmedCompletionIds((current) => new Set(current).add(habit.id));
    reload();
  };

  const saveHabit = async (values: HabitFormValues): Promise<{ saved: boolean; message?: string }> => {
    const habits = window.ares?.habits;
    if (!habits) return { saved: false, message: mutationError };
    const result = habitToEdit
      ? await habits.update(updateHabitMutationInput(habitToEdit.id, values))
      : await habits.create(createHabitMutationInput(values));
    if (!result.ok) return { saved: false, message: mutationError };
    setHabitToEdit(undefined);
    setSelectedHabitId(result.data.record.id);
    reload();
    return { saved: true };
  };

  const renderDaily = () => {
    if (loading) return <p className="habit-state" role="status">Cargando hábitos de hoy...</p>;
    if (data.dailyError) return <p className="habit-state habit-state--error" role="alert">{data.dailyError}</p>;
    const items = dailyItems(data.daily);
    if (items.length === 0) return <p className="habit-state">No tienes hábitos diarios activos.</p>;
    return <div className="habit-list">{items.map((item) => {
      const completed = isDailyHabitCompleted(item, confirmedCompletionIds);
      const displayedItem = completed === item.completed ? item : { ...item, completed };
      return <HabitCard category={item.habit.categoryId ? categories.get(item.habit.categoryId) : undefined} completionDisabled={completed || completionBusyIds.has(item.habit.id)} completionLabel={completed ? undefined : completionBusyIds.has(item.habit.id) ? "Completando..." : "Completar hoy"} completionState={completed ? "✓ Completado hoy" : undefined} detail={dailyDetail(displayedItem)} habit={item.habit} key={item.habit.id} onComplete={() => { void complete(item.habit); }} onEdit={(button) => { trigger.current = button; setHabitToEdit(item.habit); }} onSelect={() => setSelectedHabitId(item.habit.id)} progress={{ value: completed ? 1 : 0, maximum: 1, label: completed ? "Hábito completado" : "Hábito pendiente" }} selected={selectedHabitId === item.habit.id} />;
    })}</div>;
  };

  const renderWeekly = () => {
    if (loading) return <p className="habit-state" role="status">Cargando progreso semanal...</p>;
    if (data.weeklyError) return <p className="habit-state habit-state--error" role="alert">{data.weeklyError}</p>;
    const items = weeklyItems(data.weekly);
    if (items.length === 0) return <p className="habit-state">No tienes metas semanales activas.</p>;
    return <div className="habit-list">{items.map((item) => <HabitCard category={item.habit.categoryId ? categories.get(item.habit.categoryId) : undefined} completionDisabled={item.targetMet || completionBusyIds.has(item.habit.id)} completionLabel={item.targetMet ? undefined : completionBusyIds.has(item.habit.id) ? "Completando..." : "Completar hoy"} completionState={item.targetMet ? "✓ Meta cumplida" : undefined} detail={weeklyDetail(item)} habit={item.habit} key={item.habit.id} onComplete={() => { void complete(item.habit); }} onEdit={(button) => { trigger.current = button; setHabitToEdit(item.habit); }} onSelect={() => setSelectedHabitId(item.habit.id)} progress={{ value: item.completionCount, maximum: item.targetCount, label: `${item.completionCount} de ${item.targetCount} veces esta semana` }} selected={selectedHabitId === item.habit.id} />)}</div>;
  };

  return <section aria-label="Hábitos" className="habit-planner" id="habit-view" role="tabpanel">
    <header className="habit-planner__header"><div><p className="eyebrow">Seguimiento</p><h2>Hábitos</h2></div><button className="weekly-routine-add" onClick={(event) => { trigger.current = event.currentTarget; setHabitToEdit(null); }} type="button">Nuevo hábito</button></header>
    {completionFailure && <p className="habit-state habit-state--error" role="alert">{completionFailure}</p>}
    <div className="habit-planner__columns"><section aria-label="Hábitos de hoy" className="habit-panel habit-panel--today"><header><p className="eyebrow">Hoy</p><h3>Hábitos diarios</h3></header>{renderDaily()}</section><section aria-label="Metas semanales" className="habit-panel"><header><p className="eyebrow">Esta semana</p><h3>Metas semanales</h3></header>{renderWeekly()}</section></div>
    {habitToEdit !== undefined && <HabitFormDialog categories={data.categories} categoryError={data.categoryError} habit={habitToEdit} onCancel={() => { setHabitToEdit(undefined); trigger.current?.focus(); }} onSave={saveHabit} />}
  </section>;
};
