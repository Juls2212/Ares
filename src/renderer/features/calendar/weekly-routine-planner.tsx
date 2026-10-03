import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import type {
  CategoryRecord,
  CreateWeeklyRoutineInput,
  CreateWeeklyScheduleInput,
  UpdateWeeklyRoutineInput,
  UpdateWeeklyScheduleInput,
  WeeklyRoutineRecord,
  WeeklyScheduleRecord
} from "../../../shared/planner-contracts";
import {
  loadWeeklyRoutineData,
  loadWeeklyScheduleData,
  type WeeklyRoutineLoadData,
  type WeeklyScheduleLoadData
} from "./weekly-routine-data";
import {
  createRoutinePlacements,
  DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS,
  formatRoutineTimeRange,
  FULL_DAY_WEEKLY_ROUTINE_TIME_BOUNDS,
  isValidWeeklyRoutineTimeBounds,
  routinePosition,
  WEEKDAY_COLUMNS,
  weeklyRoutineHourLabels
} from "./weekly-routine-utils";
import { WeeklyScheduleContextSidebar } from "./weekly-schedule-context-sidebar";
import { loadWeeklyScheduleToday, type WeeklyScheduleTodayState } from "./weekly-schedule-context";

type RoutineFormValues = {
  title: string;
  weekday: WeeklyRoutineRecord["weekday"];
  startTime: string;
  endTime: string;
  categoryId: string;
  location: string;
};

type ScheduleFormValues = {
  title: string;
  description: string;
  color: string;
};

const emptyRoutineData: WeeklyRoutineLoadData = { routines: [], categories: [] };
const emptyScheduleData: WeeklyScheduleLoadData = { schedules: [], categories: [] };
const emptyRoutineValues: RoutineFormValues = { title: "", weekday: "MONDAY", startTime: "08:00", endTime: "09:00", categoryId: "", location: "" };
const routineValues = (routine: WeeklyRoutineRecord): RoutineFormValues => ({ title: routine.title, weekday: routine.weekday, startTime: routine.startTime, endTime: routine.endTime, categoryId: routine.categoryId ?? "", location: routine.location ?? "" });
const scheduleValues = (schedule: WeeklyScheduleRecord | null): ScheduleFormValues => ({ title: schedule?.title ?? "", description: schedule?.description ?? "", color: schedule?.color ?? "" });
const routineMutationError = "No se pudo guardar el bloque. Revisa los campos e inténtalo de nuevo.";
const routineDeletionError = "No se pudo eliminar el bloque. Inténtalo de nuevo.";
const scheduleMutationError = "No se pudo guardar el horario. Revisa los campos e inténtalo de nuevo.";
const scheduleDeletionError = "No se pudo eliminar el horario. Inténtalo de nuevo.";

type DialogKeyboardProperties = {
  first: RefObject<HTMLButtonElement | HTMLInputElement | null>;
  last: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onCancel: () => void;
};

const handleDialogKeyboard = (event: KeyboardEvent<HTMLDivElement>, { first, last, disabled, onCancel }: DialogKeyboardProperties): void => {
  if (event.key === "Escape" && !disabled) { event.preventDefault(); onCancel(); }
  if (event.key !== "Tab" || disabled) return;
  if (event.shiftKey && document.activeElement === first.current) { event.preventDefault(); last.current?.focus(); }
  if (!event.shiftKey && document.activeElement === last.current) { event.preventDefault(); first.current?.focus(); }
};

type RoutineFormDialogProperties = { routine: WeeklyRoutineRecord | null; categories: CategoryRecord[]; onCancel: () => void; onSave: (values: RoutineFormValues) => Promise<{ saved: boolean; message?: string }>; };

const RoutineFormDialog = ({ routine, categories, onCancel, onSave }: RoutineFormDialogProperties) => {
  const [values, setValues] = useState(() => routine ? routineValues(routine) : emptyRoutineValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const title = useRef<HTMLInputElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  const change = <K extends keyof RoutineFormValues>(key: K, value: RoutineFormValues[K]): void => setValues((current) => ({ ...current, [key]: value }));
  return <div className="calendar-delete-backdrop"><div aria-labelledby="weekly-routine-form-title" aria-modal="true" className="calendar-edit-dialog weekly-routine-dialog" onKeyDown={(event) => handleDialogKeyboard(event, { first: title, last: save, disabled: saving, onCancel })} role="dialog" tabIndex={-1}>
    <p className="eyebrow">Horario semanal</p><h2 id="weekly-routine-form-title">{routine ? "Editar bloque" : "Añadir bloque"}</h2>
    <form onSubmit={(event) => { event.preventDefault(); if (saving) return; setSaving(true); setError(undefined); void onSave(values).then((result) => { if (!result.saved) setError(result.message); }).catch(() => setError(routineMutationError)).finally(() => setSaving(false)); }}>
      <label>Título<input disabled={saving} onChange={(event) => change("title", event.target.value)} ref={title} required value={values.title} /></label>
      <label>Día<select disabled={saving} onChange={(event) => change("weekday", event.target.value as WeeklyRoutineRecord["weekday"])} value={values.weekday}>{WEEKDAY_COLUMNS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
      <div className="weekly-routine-dialog__times"><label>Inicio<input disabled={saving} onChange={(event) => change("startTime", event.target.value)} required type="time" value={values.startTime} /></label><label>Fin<input disabled={saving} onChange={(event) => change("endTime", event.target.value)} required type="time" value={values.endTime} /></label></div>
      <label>Categoría (opcional)<select disabled={saving} onChange={(event) => change("categoryId", event.target.value)} value={values.categoryId}><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Lugar (opcional)<input disabled={saving} onChange={(event) => change("location", event.target.value)} value={values.location} /></label>
      {error && <p role="alert">{error}</p>}{saving && <p role="status">Guardando bloque...</p>}
      <div className="calendar-delete-actions"><button disabled={saving} onClick={onCancel} type="button">Cancelar</button><button disabled={saving} ref={save} type="submit">Guardar</button></div>
    </form>
  </div></div>;
};

type RoutineDeleteDialogProperties = { routine: WeeklyRoutineRecord; isDeleting: boolean; error?: string; onCancel: () => void; onConfirm: () => void; };

const RoutineDeleteDialog = ({ routine, isDeleting, error, onCancel, onConfirm }: RoutineDeleteDialogProperties) => {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return <div className="calendar-delete-backdrop"><div aria-describedby="weekly-routine-delete-description" aria-labelledby="weekly-routine-delete-title" aria-modal="true" className="calendar-delete-dialog" onKeyDown={(event) => handleDialogKeyboard(event, { first: cancel, last: confirm, disabled: isDeleting, onCancel })} role="dialog" tabIndex={-1}>
    <p className="eyebrow">Confirmación necesaria</p><h2 id="weekly-routine-delete-title">Eliminar bloque</h2><p id="weekly-routine-delete-description">Se eliminará permanentemente el bloque «{routine.title}». Esta acción no se puede deshacer.</p>
    {error && <p className="calendar-delete-error" role="alert">{error}</p>}{isDeleting && <p className="calendar-delete-progress" role="status">Eliminando bloque...</p>}
    <div className="calendar-delete-actions"><button disabled={isDeleting} onClick={onCancel} ref={cancel} type="button">Cancelar</button><button className="calendar-delete-actions__confirm" disabled={isDeleting} onClick={onConfirm} ref={confirm} type="button">Eliminar</button></div>
  </div></div>;
};

type ScheduleFormDialogProperties = { schedule: WeeklyScheduleRecord | null; onCancel: () => void; onSave: (values: ScheduleFormValues) => Promise<{ saved: boolean; message?: string }>; };

const ScheduleFormDialog = ({ schedule, onCancel, onSave }: ScheduleFormDialogProperties) => {
  const [values, setValues] = useState(() => scheduleValues(schedule));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const title = useRef<HTMLInputElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  return <div className="calendar-delete-backdrop"><div aria-labelledby="weekly-schedule-form-title" aria-modal="true" className="calendar-edit-dialog weekly-routine-dialog" onKeyDown={(event) => handleDialogKeyboard(event, { first: title, last: save, disabled: saving, onCancel })} role="dialog" tabIndex={-1}>
    <p className="eyebrow">Mis horarios</p><h2 id="weekly-schedule-form-title">{schedule ? "Editar horario" : "Nuevo horario"}</h2>
    <form onSubmit={(event) => { event.preventDefault(); if (saving) return; setSaving(true); setError(undefined); void onSave(values).then((result) => { if (!result.saved) setError(result.message); }).catch(() => setError(scheduleMutationError)).finally(() => setSaving(false)); }}>
      <label>Título<input disabled={saving} onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))} ref={title} required value={values.title} /></label>
      <label>Descripción (opcional)<input disabled={saving} onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} value={values.description} /></label>
      <label>Color (opcional)<input disabled={saving} onChange={(event) => setValues((current) => ({ ...current, color: event.target.value }))} pattern="#[0-9A-Fa-f]{6}" placeholder="#164C87" value={values.color} /></label>
      {error && <p role="alert">{error}</p>}{saving && <p role="status">Guardando horario...</p>}
      <div className="calendar-delete-actions"><button disabled={saving} onClick={onCancel} type="button">Cancelar</button><button disabled={saving} ref={save} type="submit">Guardar</button></div>
    </form>
  </div></div>;
};

type ScheduleDeleteDialogProperties = { schedule: WeeklyScheduleRecord; isDeleting: boolean; error?: string; onCancel: () => void; onConfirm: () => void; };

const ScheduleDeleteDialog = ({ schedule, isDeleting, error, onCancel, onConfirm }: ScheduleDeleteDialogProperties) => {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  return <div className="calendar-delete-backdrop"><div aria-describedby="weekly-schedule-delete-description" aria-labelledby="weekly-schedule-delete-title" aria-modal="true" className="calendar-delete-dialog" onKeyDown={(event) => handleDialogKeyboard(event, { first: cancel, last: confirm, disabled: isDeleting, onCancel })} role="dialog" tabIndex={-1}>
    <p className="eyebrow">Confirmación necesaria</p><h2 id="weekly-schedule-delete-title">Eliminar horario</h2><p id="weekly-schedule-delete-description">Se eliminará el horario «{schedule.title}» y todos sus bloques semanales asociados. Esta acción no se puede deshacer.</p>
    {error && <p className="calendar-delete-error" role="alert">{error}</p>}{isDeleting && <p className="calendar-delete-progress" role="status">Eliminando horario...</p>}
    <div className="calendar-delete-actions"><button disabled={isDeleting} onClick={onCancel} ref={cancel} type="button">Cancelar</button><button className="calendar-delete-actions__confirm" disabled={isDeleting} onClick={onConfirm} ref={confirm} type="button">Eliminar</button></div>
  </div></div>;
};

type VisibleRangeMode = "DEFAULT" | "FULL_DAY" | "CUSTOM";
type WeeklyScheduleNavigationMode = "LIBRARY" | "SCHEDULE";
const startHourOptions = Array.from({ length: 24 }, (_, hour) => hour);
const endHourOptions = Array.from({ length: 24 }, (_, hour) => hour + 1);
const formatHour = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

export const WeeklyRoutinePlanner = () => {
  const [scheduleData, setScheduleData] = useState<WeeklyScheduleLoadData>(emptyScheduleData);
  const [routineData, setRoutineData] = useState<WeeklyRoutineLoadData>(emptyRoutineData);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [loadingRoutines, setLoadingRoutines] = useState(false);
  const [todayData, setTodayData] = useState<WeeklyScheduleTodayState>({ kind: "LOADING" });
  const [scheduleReloadVersion, setScheduleReloadVersion] = useState(0);
  const [routineReloadVersion, setRoutineReloadVersion] = useState(0);
  const [navigationMode, setNavigationMode] = useState<WeeklyScheduleNavigationMode>("LIBRARY");
  const [openedScheduleId, setOpenedScheduleId] = useState<string | null>(null);
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null);
  const [routineToEdit, setRoutineToEdit] = useState<WeeklyRoutineRecord | null | undefined>(undefined);
  const [routineToDelete, setRoutineToDelete] = useState<WeeklyRoutineRecord | null>(null);
  const [scheduleToEdit, setScheduleToEdit] = useState<WeeklyScheduleRecord | null | undefined>(undefined);
  const [scheduleToDelete, setScheduleToDelete] = useState<WeeklyScheduleRecord | null>(null);
  const [isDeletingRoutine, setIsDeletingRoutine] = useState(false);
  const [isDeletingSchedule, setIsDeletingSchedule] = useState(false);
  const [routineDeleteError, setRoutineDeleteError] = useState<string>();
  const [scheduleDeleteError, setScheduleDeleteError] = useState<string>();
  const [rangeMode, setRangeMode] = useState<VisibleRangeMode>("DEFAULT");
  const [customStartHour, setCustomStartHour] = useState(DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS.start / 60);
  const [customEndHour, setCustomEndHour] = useState(DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS.end / 60);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    setLoadingSchedules(true);
    void loadWeeklyScheduleData(window.ares?.planner).then((result) => { if (active) setScheduleData(result); }).catch(() => { if (active) setScheduleData({ schedules: [], categories: [], scheduleError: "No se pudieron cargar los horarios.", categoryError: "No se pudieron cargar las categorías." }); }).finally(() => { if (active) setLoadingSchedules(false); });
    return () => { active = false; };
  }, [scheduleReloadVersion]);
  useEffect(() => {
    let active = true;
    if (!openedScheduleId) { setRoutineData(emptyRoutineData); setLoadingRoutines(false); return () => { active = false; }; }
    setLoadingRoutines(true);
    void loadWeeklyRoutineData(window.ares?.planner, openedScheduleId).then((result) => { if (active) setRoutineData(result); }).catch(() => { if (active) setRoutineData({ routines: [], categories: [], routineError: "No se pudieron cargar los bloques semanales." }); }).finally(() => { if (active) setLoadingRoutines(false); });
    return () => { active = false; };
  }, [routineReloadVersion, openedScheduleId]);
  useEffect(() => {
    let active = true;
    if (navigationMode !== "SCHEDULE" || !openedScheduleId) {
      setTodayData({ kind: "LOADING" });
      return () => { active = false; };
    }
    setTodayData({ kind: "LOADING" });
    void loadWeeklyScheduleToday(window.ares?.planner).then((result) => { if (active) setTodayData(result); });
    return () => { active = false; };
  }, [navigationMode, openedScheduleId]);
  useEffect(() => { if (!routineData.routines.some((routine) => routine.id === selectedRoutineId)) setSelectedRoutineId(null); }, [routineData.routines, selectedRoutineId]);

  const openedSchedule = scheduleData.schedules.find((schedule) => schedule.id === openedScheduleId) ?? null;
  const isOpenedScheduleWorkspace = navigationMode === "SCHEDULE" && openedSchedule !== null;
  const visibleBounds = useMemo(() => { if (rangeMode === "FULL_DAY") return FULL_DAY_WEEKLY_ROUTINE_TIME_BOUNDS; if (rangeMode === "DEFAULT") return DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS; const bounds = { start: customStartHour * 60, end: customEndHour * 60 }; return isValidWeeklyRoutineTimeBounds(bounds) ? bounds : DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS; }, [customEndHour, customStartHour, rangeMode]);
  const visibleHours = useMemo(() => weeklyRoutineHourLabels(visibleBounds), [visibleBounds]);
  const placements = useMemo(() => createRoutinePlacements(routineData.routines), [routineData.routines]);
  const categories = useMemo(() => new Map(scheduleData.categories.map((category) => [category.id, category])), [scheduleData.categories]);
  const reloadSchedules = (): void => setScheduleReloadVersion((version) => version + 1);
  const reloadRoutines = (): void => setRoutineReloadVersion((version) => version + 1);
  const selectCustomStartHour = (hour: number): void => { setCustomStartHour(hour); setCustomEndHour((current) => Math.max(current, Math.min(24, hour + 1))); setRangeMode("CUSTOM"); };
  const selectCustomEndHour = (hour: number): void => { if (hour <= customStartHour) return; setCustomEndHour(hour); setRangeMode("CUSTOM"); };

  const saveRoutine = async (values: RoutineFormValues): Promise<{ saved: boolean; message?: string }> => {
    if (!values.title.trim()) return { saved: false, message: "Escribe un título para el bloque." };
    if (values.endTime <= values.startTime) return { saved: false, message: "La hora de finalización debe ser posterior al inicio." };
    const planner = window.ares?.planner;
    if (!planner || !openedScheduleId) return { saved: false, message: routineMutationError };
    const result = routineToEdit ? await planner.weeklyRoutines.update({ routineId: routineToEdit.id, weeklyScheduleId: openedScheduleId, title: values.title.trim(), weekday: values.weekday, startTime: values.startTime, endTime: values.endTime, categoryId: values.categoryId || null, location: values.location.trim() || null } satisfies UpdateWeeklyRoutineInput) : await planner.weeklyRoutines.create({ weeklyScheduleId: openedScheduleId, title: values.title.trim(), weekday: values.weekday, startTime: values.startTime, endTime: values.endTime, ...(values.categoryId ? { categoryId: values.categoryId } : {}), ...(values.location.trim() ? { location: values.location.trim() } : {}) } satisfies CreateWeeklyRoutineInput);
    if (!result.ok) return { saved: false, message: routineMutationError };
    setRoutineToEdit(undefined); reloadRoutines(); return { saved: true };
  };
  const saveSchedule = async (values: ScheduleFormValues): Promise<{ saved: boolean; message?: string }> => {
    if (!values.title.trim()) return { saved: false, message: "Escribe un título para el horario." };
    const planner = window.ares?.planner;
    if (!planner) return { saved: false, message: scheduleMutationError };
    const result = scheduleToEdit ? await planner.weeklySchedules.update({ weeklyScheduleId: scheduleToEdit.id, title: values.title.trim(), description: values.description.trim() || null, color: values.color.trim() || null } satisfies UpdateWeeklyScheduleInput) : await planner.weeklySchedules.create({ title: values.title.trim(), ...(values.description.trim() ? { description: values.description.trim() } : {}), ...(values.color.trim() ? { color: values.color.trim() } : {}) } satisfies CreateWeeklyScheduleInput);
    if (!result.ok) return { saved: false, message: scheduleMutationError };
    setScheduleToEdit(undefined); setOpenedScheduleId(result.data.record.id); setNavigationMode("SCHEDULE"); setSelectedRoutineId(null); reloadSchedules(); return { saved: true };
  };
  const deleteRoutine = async (): Promise<void> => {
    if (!routineToDelete || isDeletingRoutine) return;
    setIsDeletingRoutine(true); setRoutineDeleteError(undefined);
    try { const result = await window.ares?.planner.weeklyRoutines.delete({ routineId: routineToDelete.id }); if (!result?.ok) { setRoutineDeleteError(routineDeletionError); return; } setSelectedRoutineId((current) => current === routineToDelete.id ? null : current); setRoutineToDelete(null); reloadRoutines(); } catch { setRoutineDeleteError(routineDeletionError); } finally { setIsDeletingRoutine(false); }
  };
  const deleteSchedule = async (): Promise<void> => {
    if (!scheduleToDelete || isDeletingSchedule) return;
    setIsDeletingSchedule(true); setScheduleDeleteError(undefined);
    try { const result = await window.ares?.planner.weeklySchedules.delete({ weeklyScheduleId: scheduleToDelete.id }); if (!result?.ok) { setScheduleDeleteError(scheduleDeletionError); return; } setOpenedScheduleId(null); setNavigationMode("LIBRARY"); setSelectedRoutineId(null); setRoutineData(emptyRoutineData); setScheduleToDelete(null); reloadSchedules(); } catch { setScheduleDeleteError(scheduleDeletionError); } finally { setIsDeletingSchedule(false); }
  };

  return <section aria-label="Horario semanal" className="weekly-routine-shell" id="weekly-routine-view" role="tabpanel">
    <div className="weekly-routine-notices">{loadingSchedules && <p className="calendar-status calendar-status--loading" role="status">Cargando horarios...</p>}{scheduleData.scheduleError && <p className="calendar-status calendar-status--error">{scheduleData.scheduleError}</p>}{scheduleData.categoryError && <p className="calendar-status calendar-status--error">{scheduleData.categoryError}</p>}{routineData.routineError && <p className="calendar-status calendar-status--error">{routineData.routineError}</p>}</div>
    {!isOpenedScheduleWorkspace ? <div className="weekly-schedule-gallery">
      <header className="weekly-schedule-gallery__header"><div><p className="eyebrow">Horario semanal</p><h2>Mis horarios</h2></div><button className="weekly-routine-add" onClick={(event) => { trigger.current = event.currentTarget; setScheduleToEdit(null); }} type="button">Nuevo horario</button></header>
      {!loadingSchedules && !scheduleData.scheduleError && scheduleData.schedules.length === 0 && <p className="weekly-schedule-gallery__empty" role="status">No hay horarios creados.</p>}
      <div className="weekly-schedule-gallery__cards">{scheduleData.schedules.map((schedule) => <button aria-label={`Abrir horario: ${schedule.title}`} className="weekly-schedule-card" key={schedule.id} onClick={() => { setRoutineData(emptyRoutineData); setOpenedScheduleId(schedule.id); setNavigationMode("SCHEDULE"); setSelectedRoutineId(null); }} type="button">{schedule.color && <span aria-hidden="true" className="weekly-schedule-card__color" style={{ backgroundColor: schedule.color }} />}<span><strong>{schedule.title}</strong>{schedule.description && <small>{schedule.description}</small>}<em>Abrir horario</em></span></button>)}</div>
    </div> : <div className="weekly-schedule-workspace">
      <header className="weekly-schedule-main__header"><div><button className="weekly-schedule-back" onClick={() => { setOpenedScheduleId(null); setNavigationMode("LIBRARY"); setSelectedRoutineId(null); setRoutineData(emptyRoutineData); }} type="button">← Todos los horarios</button><p className="eyebrow">Horario semanal</p><h2>{openedSchedule.title}</h2></div><div className="weekly-schedule-main__actions"><button onClick={(event) => { trigger.current = event.currentTarget; setScheduleToEdit(openedSchedule); }} type="button">Editar horario</button><button className="weekly-schedule-main__delete" onClick={(event) => { trigger.current = event.currentTarget; setScheduleDeleteError(undefined); setScheduleToDelete(openedSchedule); }} type="button">Eliminar horario</button><button className="weekly-routine-add" onClick={(event) => { trigger.current = event.currentTarget; setRoutineToEdit(null); }} type="button">Añadir bloque</button></div></header>
      <div className="weekly-schedule-workspace__body"><div className="weekly-schedule-workspace__timetable"><fieldset aria-label="Horas visibles" className="weekly-routine-range-controls"><legend>Horas visibles</legend><div className="weekly-routine-range-controls__presets"><button aria-pressed={rangeMode === "DEFAULT"} onClick={() => setRangeMode("DEFAULT")} type="button">06:00–22:00</button><button aria-pressed={rangeMode === "FULL_DAY"} onClick={() => setRangeMode("FULL_DAY")} type="button">Todo el día</button></div><label>Inicio<select aria-label="Hora de inicio visible" onChange={(event) => selectCustomStartHour(Number(event.target.value))} value={customStartHour}>{startHourOptions.map((hour) => <option key={hour} value={hour}>{formatHour(hour)}</option>)}</select></label><label>Fin<select aria-label="Hora de finalización visible" onChange={(event) => selectCustomEndHour(Number(event.target.value))} value={customEndHour}>{endHourOptions.map((hour) => <option disabled={hour <= customStartHour} key={hour} value={hour}>{formatHour(hour)}</option>)}</select></label></fieldset>
      {!scheduleData.scheduleError && <div aria-label="Horario semanal de rutinas" className="weekly-routine-timetable"><div className="weekly-routine-weekdays"><span aria-hidden="true" />{WEEKDAY_COLUMNS.map((day) => <span key={day.value}>{day.label}</span>)}</div><div className="weekly-routine-body" style={{ "--routine-hours": visibleHours.length - 1 } as CSSProperties}><div className="weekly-routine-axis">{visibleHours.map((hour) => <span key={hour}>{hour}</span>)}</div>{WEEKDAY_COLUMNS.map((day) => <div className="weekly-routine-day" key={day.value}>{placements.filter((placement) => placement.routine.weekday === day.value).map((placement) => {
        const category = placement.routine.categoryId ? categories.get(placement.routine.categoryId) : undefined;
        const selected = selectedRoutineId === placement.routine.id;
        const position = routinePosition(placement.routine, visibleBounds);
        if (!position) return null;
        return <div className={`weekly-routine-block${selected ? " is-selected" : ""}`} key={placement.routine.id} style={{ ...position, left: `calc(${(placement.lane / placement.laneCount) * 100}% + 3px)`, width: `calc(${100 / placement.laneCount}% - 6px)` }}><button aria-pressed={selected} aria-label={`Seleccionar bloque: ${placement.routine.title}`} onClick={() => setSelectedRoutineId(placement.routine.id)} type="button"><strong>{placement.routine.title}</strong><span>{formatRoutineTimeRange(placement.routine)}</span>{placement.routine.location && <small>{placement.routine.location}</small>}{category && <em style={{ borderColor: category.color ?? undefined }}>{category.name}</em>}</button>{selected && <div className="weekly-routine-actions"><button onClick={(event) => { trigger.current = event.currentTarget; setRoutineToEdit(placement.routine); }} type="button">Editar</button><button className="weekly-routine-actions__delete" onClick={(event) => { trigger.current = event.currentTarget; setRoutineDeleteError(undefined); setRoutineToDelete(placement.routine); }} type="button">Eliminar</button></div>}</div>;
      })}</div>)}{!loadingRoutines && routineData.routines.length === 0 && <p className="weekly-routine-empty" role="status">No hay bloques en este horario.</p>}</div></div>}</div><WeeklyScheduleContextSidebar routines={routineData.routines} today={todayData} visibleBounds={visibleBounds} /></div>
    </div>}
    {routineToEdit !== undefined && <RoutineFormDialog categories={scheduleData.categories} onCancel={() => { setRoutineToEdit(undefined); trigger.current?.focus(); }} onSave={saveRoutine} routine={routineToEdit} />}{routineToDelete && <RoutineDeleteDialog error={routineDeleteError} isDeleting={isDeletingRoutine} onCancel={() => { setRoutineToDelete(null); trigger.current?.focus(); }} onConfirm={() => { void deleteRoutine(); }} routine={routineToDelete} />}{scheduleToEdit !== undefined && <ScheduleFormDialog onCancel={() => { setScheduleToEdit(undefined); trigger.current?.focus(); }} onSave={saveSchedule} schedule={scheduleToEdit} />}{scheduleToDelete && <ScheduleDeleteDialog error={scheduleDeleteError} isDeleting={isDeletingSchedule} onCancel={() => { setScheduleToDelete(null); trigger.current?.focus(); }} onConfirm={() => { void deleteSchedule(); }} schedule={scheduleToDelete} />}
  </section>;
};
