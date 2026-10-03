import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CategoryRecord, PlannerApi, TodayScheduleData, WeeklyRoutineRecord, WeeklyScheduleRecord } from "../src/shared/planner-contracts";
import { loadWeeklyRoutineData, loadWeeklyScheduleData } from "../src/renderer/features/calendar/weekly-routine-data";
import { WeeklyRoutinePlanner } from "../src/renderer/features/calendar/weekly-routine-planner";
import {
  createRoutinePlacements,
  DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS,
  formatRoutineTimeRange,
  FULL_DAY_WEEKLY_ROUTINE_TIME_BOUNDS,
  isValidWeeklyRoutineTimeBounds,
  routinePosition,
  WEEKDAY_COLUMNS,
  weeklyRoutineHourLabels,
  weeklyRoutineTimeBounds
} from "../src/renderer/features/calendar/weekly-routine-utils";
import {
  findLargestWeeklyFreePeriod,
  loadWeeklyScheduleToday,
  summarizeWeeklySchedule
} from "../src/renderer/features/calendar/weekly-schedule-context";
import { CalendarView } from "../src/renderer/views/calendar-view";

const viewSource = readFileSync(path.resolve(process.cwd(), "src/renderer/views/calendar-view.tsx"), "utf8");
const weeklySource = readFileSync(path.resolve(process.cwd(), "src/renderer/features/calendar/weekly-routine-planner.tsx"), "utf8");

const routine = (overrides: Partial<WeeklyRoutineRecord> = {}): WeeklyRoutineRecord => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  weeklyScheduleId: "21ae1498-1a4e-4f85-86ae-0db35afc8921",
  title: "Clase real",
  weekday: "MONDAY",
  startTime: "08:00",
  endTime: "10:00",
  categoryId: null,
  location: "Aula 4",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...overrides
});

const category: CategoryRecord = {
  id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  name: "Universidad",
  color: "#164c87",
  icon: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z"
};

const primarySchedule: WeeklyScheduleRecord = {
  id: "21ae1498-1a4e-4f85-86ae-0db35afc8921",
  title: "Horario principal",
  description: null,
  color: "#164C87",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z"
};

const planner = (routineResult: unknown, categoryResult: unknown, scheduleResult: unknown = { ok: true, data: { items: [primarySchedule], total: 1 } }): PlannerApi => ({
  weeklyRoutines: { list: vi.fn(async () => routineResult) },
  categories: { list: vi.fn(async () => categoryResult) },
  weeklySchedules: { list: vi.fn(async () => scheduleResult) }
} as unknown as PlannerApi);

describe("weekly routine renderer data", () => {
  it("loads real schedules and scopes routine loading to the selected schedule", async () => {
    const api = planner(
      { ok: true, data: { items: [routine()], total: 1 } },
      { ok: true, data: { items: [category], total: 1 } }
    );
    await expect(loadWeeklyScheduleData(api)).resolves.toEqual({ schedules: [primarySchedule], categories: [category] });
    await expect(loadWeeklyRoutineData(api, primarySchedule.id)).resolves.toEqual({ routines: [routine()], categories: [] });
    expect(api.weeklySchedules.list).toHaveBeenCalledWith({});
    expect(api.weeklyRoutines.list).toHaveBeenCalledWith({ weeklyScheduleId: primarySchedule.id });
    expect(api.categories.list).toHaveBeenCalledWith({});
    expect(Object.keys(api.weeklySchedules)).toEqual(["list"]);
  });

  it("preserves an available source while rendering controlled weekly loading errors", async () => {
    const result = await loadWeeklyScheduleData(planner(
      { ok: false, error: { code: "PLANNER_DATABASE_UNAVAILABLE", userMessage: "unsafe detail" } },
      { ok: true, data: { items: [category], total: 1 } },
      { ok: false, error: { code: "PLANNER_DATABASE_UNAVAILABLE", userMessage: "unsafe detail" } }
    ));
    expect(result.schedules).toEqual([]);
    expect(result.categories).toEqual([category]);
    expect(result.scheduleError).toBe("No se pudieron cargar los horarios.");
    expect(JSON.stringify(result)).not.toContain("unsafe detail");
  });

});

describe("weekly routine timetable helpers", () => {
  it("uses Spanish Monday-through-Sunday labels and places real routines by local time", () => {
    expect(WEEKDAY_COLUMNS.map((day) => day.label)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
    const first = routine();
    const overlap = routine({ id: "event-2", title: "Laboratorio real", startTime: "09:00", endTime: "11:00" });
    const bounds = weeklyRoutineTimeBounds([first, overlap]);
    expect(bounds).toEqual({ start: 480, end: 720 });
    expect(weeklyRoutineHourLabels(bounds)).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00"]);
    expect(createRoutinePlacements([first, overlap])).toEqual(expect.arrayContaining([
      expect.objectContaining({ routine: first, lane: 0, laneCount: 2 }),
      expect.objectContaining({ routine: overlap, lane: 1, laneCount: 2 })
    ]));
    expect(formatRoutineTimeRange(first)).toBe("08:00–10:00");
    expect(routinePosition(first, bounds)).toEqual({ top: "0%", height: expect.any(String) });
  });

  it("uses a 06:00–22:00 default, supports a full day, and clips blocks to valid visible ranges", () => {
    expect(DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS).toEqual({ start: 360, end: 1320 });
    expect(weeklyRoutineHourLabels(DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS)).toEqual(expect.arrayContaining(["06:00", "22:00"]));
    expect(FULL_DAY_WEEKLY_ROUTINE_TIME_BOUNDS).toEqual({ start: 0, end: 1440 });
    expect(weeklyRoutineHourLabels(FULL_DAY_WEEKLY_ROUTINE_TIME_BOUNDS)).toEqual(expect.arrayContaining(["00:00", "24:00"]));
    expect(isValidWeeklyRoutineTimeBounds({ start: 480, end: 1080 })).toBe(true);
    expect(isValidWeeklyRoutineTimeBounds({ start: 1080, end: 480 })).toBe(false);
    expect(routinePosition(routine({ startTime: "05:00", endTime: "07:00" }), DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS)).toEqual({ top: "0%", height: expect.any(String) });
    expect(routinePosition(routine({ startTime: "22:00", endTime: "23:00" }), DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS)).toBeUndefined();
  });
});

describe("weekly schedule context", () => {
  const todaySchedule: TodayScheduleData = {
    localDate: "2026-10-03",
    tasks: [{ id: "task-1", title: "Entregar avance", description: null, dueDate: "2026-10-03", dueTime: "10:00", priority: "HIGH", status: "PENDING", categoryId: null, completedAt: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }],
    events: [{ id: "event-1", title: "Reunión real", description: null, startAt: "2026-10-03T14:00:00-05:00", endAt: null, categoryId: null, location: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }],
    reminders: []
  };

  it("loads grounded today tasks and events through the existing schedule API", async () => {
    const getToday = vi.fn(async () => ({ ok: true as const, data: todaySchedule }));
    const result = await loadWeeklyScheduleToday({ schedule: { getToday } } as unknown as PlannerApi);
    expect(result).toEqual({ kind: "READY", data: todaySchedule });
    expect(getToday).toHaveBeenCalledWith({ includeCompletedTasks: true });
    await expect(loadWeeklyScheduleToday(undefined)).resolves.toEqual({ kind: "ERROR" });
  });

  it("derives schedule totals and a merged free period from real routine intervals", () => {
    const routines = [
      routine({ id: "monday-a", weekday: "MONDAY", startTime: "08:00", endTime: "10:00" }),
      routine({ id: "monday-b", weekday: "MONDAY", startTime: "09:00", endTime: "11:00" }),
      ...WEEKDAY_COLUMNS.filter((day) => day.value !== "MONDAY").map((day, index) => routine({ id: `day-${index}`, weekday: day.value, startTime: "08:00", endTime: "17:00" }))
    ];
    expect(summarizeWeeklySchedule(routines)).toEqual({ blockCount: 8, totalMinutes: 3480, busiestWeekday: "TUESDAY" });
    expect(findLargestWeeklyFreePeriod(routines, { start: 8 * 60, end: 18 * 60 })).toEqual({ weekday: "MONDAY", start: 11 * 60, end: 18 * 60, durationMinutes: 7 * 60 });
    expect(findLargestWeeklyFreePeriod([], DEFAULT_WEEKLY_ROUTINE_TIME_BOUNDS)).toBeUndefined();
  });
});

describe("weekly routine planner presentation", () => {
  it("renders the switch on the Calendar component route and keeps the monthly view available", () => {
    const markup = renderToStaticMarkup(createElement(CalendarView));
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-controls="calendar-month-view"');
    expect(markup).toContain(">Calendario</button>");
    expect(markup).toContain(">Horario semanal</button>");
    expect(markup).toContain('id="calendar-month-view"');
    expect(markup).toContain("Mes anterior");
  });

  it("renders only the gallery on the initial weekly planner mount", () => {
    const markup = renderToStaticMarkup(createElement(WeeklyRoutinePlanner));
    expect(markup).toContain("Cargando horarios...");
    expect(markup).toContain('id="weekly-routine-view"');
    expect(markup).toContain('class="weekly-schedule-gallery"');
    expect(markup).toContain("Nuevo horario");
    expect(markup).not.toContain("weekly-routine-timetable");
    expect(markup).not.toContain("Horas visibles");
    expect(markup).not.toContain("weekly-schedule-sidebar");
  });

  it("keeps Calendar unchanged behind an accessible segmented switch", () => {
    expect(viewSource).toContain('role="tablist"');
    expect(viewSource).toContain(">Calendario</button>");
    expect(viewSource).toContain(">Horario semanal</button>");
    expect(viewSource).toContain('className="calendar-header__actions"');
    expect(viewSource).toContain("setWeeklyPlannerSession((session) => session + 1)");
    expect(viewSource).toContain('plannerView === "WEEKLY_ROUTINES" ? <WeeklyRoutinePlanner key={weeklyPlannerSession} />');
    expect(viewSource).toContain("<CalendarGrid days={days}");
  });

  it("renders selection, edit, and explicit deletion confirmation without mutation before confirmation", () => {
    expect(weeklySource).toContain("Añadir bloque");
    expect(weeklySource).toContain("Nuevo horario");
    expect(weeklySource).toContain("Editar horario");
    expect(weeklySource).toContain("Eliminar horario");
    expect(weeklySource).toContain("todos sus bloques semanales asociados");
    expect(weeklySource).toContain("Seleccionar bloque:");
    expect(weeklySource).toContain(">Editar</button>");
    expect(weeklySource).toContain(">Eliminar</button>");
    expect(weeklySource).toContain("Se eliminará permanentemente el bloque");
    expect(weeklySource).toContain("planner.weeklySchedules.create");
    expect(weeklySource).toContain("planner.weeklySchedules.update");
    expect(weeklySource).toContain("planner.weeklySchedules.delete");
    expect(weeklySource).toContain("planner.weeklyRoutines.create");
    expect(weeklySource).toContain("planner.weeklyRoutines.update");
    expect(weeklySource).toContain("weeklyScheduleId: openedScheduleId");
    expect(weeklySource).toContain("planner.weeklyRoutines.delete({ routineId: routineToDelete.id })");
    expect(weeklySource.indexOf("const deleteRoutine")).toBeGreaterThan(weeklySource.indexOf("RoutineDeleteDialog"));
    expect(weeklySource).toContain("event.key === \"Escape\"");
    expect(weeklySource).toContain("trigger.current?.focus()");
  });

  it("keeps normal calendar layout free of forced rail and page overflow", () => {
    expect(weeklySource).toContain('className="weekly-routine-shell" id="weekly-routine-view" role="tabpanel"');
    expect(viewSource).toContain('className="calendar-console" id="calendar-month-view" role="tabpanel"');
    expect(readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8")).toContain(".calendar-focus-rail {\n  max-height: none;\n  overflow-y: visible;");
    expect(readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8")).toContain(".calendar-shell {\n  padding: clamp(.55rem, 1.35vh, .9rem) 0 clamp(.7rem, 1.5vh, 1rem);\n  box-sizing: border-box;\n  overflow-x: clip;");
  });

  it("uses a schedule gallery landing and opens a single schedule workspace on demand", () => {
    expect(weeklySource).toContain("!isOpenedScheduleWorkspace ? <div className=\"weekly-schedule-gallery\">");
    expect(weeklySource).not.toContain("selectInitialWeeklySchedule");
    expect(weeklySource).toContain("Mis horarios");
    expect(weeklySource).toContain("Abrir horario");
    expect(weeklySource).toContain("setOpenedScheduleId(schedule.id)");
    expect(weeklySource).toContain('setNavigationMode("SCHEDULE")');
    expect(weeklySource).toContain(">← Todos los horarios</button>");
    expect(weeklySource).toContain("setOpenedScheduleId(null)");
    expect(weeklySource).toContain('setNavigationMode("LIBRARY")');
    expect(weeklySource).toContain("setOpenedScheduleId(result.data.record.id)");
    expect(weeklySource).toContain('className="weekly-routine-empty"');
    expect(weeklySource).toContain("No hay bloques en este horario.");
    expect(weeklySource).toContain("No hay horarios creados.");
    expect(weeklySource).toContain('className="weekly-routine-timetable"');
    expect(readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8")).toContain('.weekly-routine-empty { position: absolute;');
  });

  it("renders the grounded context sidebar only beside an opened schedule workspace", () => {
    expect(weeklySource).toContain("loadWeeklyScheduleToday(window.ares?.planner)");
    expect(weeklySource).toContain('<WeeklyScheduleContextSidebar routines={routineData.routines} today={todayData} visibleBounds={visibleBounds} />');
    expect(weeklySource.indexOf("<WeeklyScheduleContextSidebar")).toBeGreaterThan(weeklySource.indexOf('<div className="weekly-schedule-workspace">'));
    expect(weeklySource.indexOf("<WeeklyScheduleContextSidebar")).toBeGreaterThan(weeklySource.indexOf('!isOpenedScheduleWorkspace ? <div className="weekly-schedule-gallery">'));
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) clamp(280px, 20vw, 320px);");
    expect(styles).toContain(".weekly-schedule-context {");
  });

  it("uses the expanded gallery and an explicit back button for weekly navigation", () => {
    const styles = readFileSync(path.resolve(process.cwd(), "src/renderer/styles/ares.css"), "utf8");
    expect(weeklySource).toContain('className="weekly-schedule-back"');
    expect(weeklySource).toContain(">← Todos los horarios</button>");
    expect(styles).toContain(".calendar-shell:has(.weekly-routine-shell) { width: calc(100% - 2rem); max-width: none; }");
    expect(styles).toContain("grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));");
    expect(styles).toContain("min-height: 148px;");
    expect(styles).toContain("grid-template-columns: 56px repeat(7, minmax(124px, 1fr));");
  });

  it("renders local visible-hour controls without changing routine persistence", () => {
    expect(weeklySource).toContain('aria-label="Horas visibles"');
    expect(weeklySource).toContain(">06:00–22:00</button>");
    expect(weeklySource).toContain(">Todo el día</button>");
    expect(weeklySource).toContain('aria-label="Hora de inicio visible"');
    expect(weeklySource).toContain('aria-label="Hora de finalización visible"');
    expect(weeklySource).toContain("if (hour <= customStartHour) return;");
    expect(weeklySource).toContain("if (!position) return null;");
  });
});
