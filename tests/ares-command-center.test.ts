import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EventRecord, PlannerApi, ReminderRecord, TaskRecord, TodayScheduleData } from "../src/shared/planner-contracts";
import { AresInformationPanels } from "../src/renderer/features/assistant/ares-information-panels";
import { loadAresToday, summarizeAresToday } from "../src/renderer/features/assistant/ares-today-summary";
import { loadAresHabitSummary, summarizeAresHabits } from "../src/renderer/features/assistant/ares-habit-summary";
import { createLocalClockUpdater, formatLocalClockDate, formatLocalClockTime } from "../src/renderer/features/assistant/local-clock";
import { VoiceCommandControls } from "../src/renderer/features/voice/voice-command-controls";
import { AresView } from "../src/renderer/views/ares-view";
import type { HabitDailyProgressData, HabitsApi } from "../src/shared/habit-contracts";

const dailyHabits: HabitDailyProgressData = {
  date: "2026-10-02",
  completed: [{ habit: { id: "habit-complete", title: "Leer", description: null, categoryId: null, icon: "BOOK", frequency: "DAILY", targetCount: 1, active: true, createdAt: "2026-10-01T00:00:00-05:00", updatedAt: "2026-10-01T00:00:00-05:00" }, completed: true, completion: { id: "completion", habitId: "habit-complete", completedOn: "2026-10-02", completedAt: "2026-10-02T09:00:00-05:00" }, currentStreak: 2, longestStreak: 4 }],
  pending: [{ habit: { id: "habit-pending", title: "Caminar", description: null, categoryId: null, icon: "RUNNING", frequency: "DAILY", targetCount: 1, active: true, createdAt: "2026-10-01T00:00:00-05:00", updatedAt: "2026-10-01T00:00:00-05:00" }, completed: false, completion: null, currentStreak: 0, longestStreak: 2 }]
};

const task = (status: TaskRecord["status"], priority: TaskRecord["priority"] = "MEDIUM", title: string = status): TaskRecord => ({
  id: status,
  title,
  description: null,
  dueDate: "2026-10-02",
  dueTime: null,
  priority,
  status,
  categoryId: null,
  completedAt: status === "COMPLETED" ? "2026-10-02T09:00:00-05:00" : null,
  createdAt: "2026-10-01T00:00:00-05:00",
  updatedAt: "2026-10-01T00:00:00-05:00"
});

const reminder = (title: string, remindAt: string): ReminderRecord => ({
  id: title,
  title,
  remindAt,
  taskId: null,
  eventId: null,
  status: "PENDING",
  deliveredAt: null,
  createdAt: "2026-10-01T00:00:00-05:00",
  updatedAt: "2026-10-01T00:00:00-05:00"
});

const event = (id: string, title: string, startAt: string): EventRecord => ({
  id,
  title,
  description: null,
  startAt,
  endAt: null,
  categoryId: null,
  location: null,
  createdAt: "2026-10-01T00:00:00-05:00",
  updatedAt: "2026-10-01T00:00:00-05:00"
});

const schedule: TodayScheduleData = {
  localDate: "2026-10-02",
  tasks: [task("PENDING", "HIGH", "Preparar informe"), task("IN_PROGRESS"), task("COMPLETED")],
  events: [
    event("past", "Evento pasado", "2026-10-02T08:00:00-05:00"),
    event("first", "Primero", "2026-10-02T10:00:00-05:00"),
    event("second", "Segundo", "2026-10-02T11:00:00-05:00"),
    event("third", "Tercero", "2026-10-02T12:00:00-05:00"),
    event("fourth", "Cuarto", "2026-10-02T13:00:00-05:00")
  ],
  reminders: [reminder("Llamar a María", "2026-10-02T10:30:00-05:00")]
};

describe("Ares command-center information", () => {
  it("renders the narrow panels around the centered command column in document order", () => {
    const markup = renderToStaticMarkup(createElement(AresView, {
      technicalState: "SUCCESS",
      voiceLabel: "Listo para grabar",
      voiceState: "IDLE",
      orbState: "idle",
      instruction: "",
      isInterpreting: false,
      draftStates: {},
      onInstructionChange: vi.fn(),
      onInterpret: vi.fn(),
      onStartRecording: vi.fn(),
      onCancelRecording: vi.fn(),
      onPropose: vi.fn(),
      onResolveConfirmation: vi.fn()
    }));
    const left = markup.indexOf("support-panel--left");
    const core = markup.indexOf("command-core");
    const right = markup.indexOf("support-panel--right");

    expect(left).toBeGreaterThan(-1);
    expect(core).toBeGreaterThan(left);
    expect(right).toBeGreaterThan(core);
    expect(markup).toContain("¿En qué trabajamos hoy, Juli?");
    expect(markup).toContain('aria-label="Iniciar grabación por voz"');
    expect(markup).not.toContain("audio se enviará a OpenAI");
  });

  it("derives truthful today counts and up to three upcoming events from the approved schedule result", () => {
    const data = summarizeAresToday(schedule, new Date("2026-10-02T09:00:00-05:00"));

    expect(data).toMatchObject({ pendingTasks: 2, completedTasks: 1, totalEvents: 5, currentHighPriorityTask: { title: "Preparar informe" }, nextReminder: { title: "Llamar a María" } });
    expect(data.upcomingEvents.map((item) => item.id)).toEqual(["first", "second", "third"]);
    const markup = renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "READY", data } }));
    expect(markup).toContain("Resumen de hoy");
    expect(markup).toContain("Próximos eventos");
    expect(markup).toContain("Ares es tu centro personal");
    expect(markup).toContain("Progreso de hoy");
    expect(markup).toContain("Prioridad actual");
    expect(markup).toContain("Preparar informe");
    expect(markup).toContain("Próximo recordatorio");
    expect(markup).toContain("Llamar a María");
    expect(markup).toContain("Primero");
    expect(markup).not.toContain("Cuarto");
    expect(markup.indexOf("local-clock")).toBeLessThan(markup.indexOf("ares-mini-calendar"));
  });

  it("uses only the existing read-only today schedule and maps unavailable data to controlled panel states", async () => {
    const getToday = vi.fn(async () => ({ ok: true as const, data: schedule }));
    const planner = { schedule: { getToday } } as unknown as PlannerApi;
    const result = await loadAresToday(planner, new Date("2026-10-02T09:00:00-05:00"));

    expect(result.kind).toBe("READY");
    expect(getToday).toHaveBeenCalledWith({ includeCompletedTasks: true });
    expect(Object.keys(planner.schedule)).toEqual(["getToday"]);
    await expect(loadAresToday(undefined)).resolves.toEqual({ kind: "ERROR" });
    expect(renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "LOADING" } }))).toContain("Cargando resumen de hoy…");
    expect(renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "ERROR" } }))).toContain("No se pudieron cargar los eventos.");
  });

  it("shows the honest upcoming-event empty state when no future event is available today", () => {
    const data = summarizeAresToday({ ...schedule, events: [schedule.events[0]] }, new Date("2026-10-02T09:00:00-05:00"));
    const markup = renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "READY", data } }));

    expect(markup).toContain("No tienes eventos próximos.");
  });

  it("uses honest empty states rather than inventing task priority or reminder data", () => {
    const data = summarizeAresToday({ ...schedule, tasks: [], reminders: [] }, new Date("2026-10-02T09:00:00-05:00"));
    const markup = renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "READY", data } }));

    expect(markup).toContain("No tienes tareas para hoy.");
    expect(markup).toContain("No tienes tareas de prioridad alta pendientes.");
    expect(markup).toContain("No tienes recordatorios próximos.");
  });

  it("renders only Main-authoritative habit progress, pending icons, and controlled states", async () => {
    const ready = summarizeAresHabits(dailyHabits);
    const readyMarkup = renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "READY", data: summarizeAresToday(schedule, new Date("2026-10-02T09:00:00-05:00")) }, habits: { kind: "READY", data: ready } }));
    expect(readyMarkup).toContain("Hábitos de hoy");
    expect(readyMarkup).toMatch(/1<\/strong> de 2 completados/);
    expect(readyMarkup).toContain("Caminar");
    expect(readyMarkup).not.toContain("Leer</span>");

    const habits = { getDailyProgress: vi.fn(async () => ({ ok: true as const, data: dailyHabits })) } as unknown as HabitsApi;
    await expect(loadAresHabitSummary(habits, new Date(2026, 9, 2))).resolves.toEqual({ kind: "READY", data: ready });
    expect(habits.getDailyProgress).toHaveBeenCalledWith({ date: "2026-10-02" });
    expect(renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "READY", data: summarizeAresToday(schedule, new Date()) }, habits: { kind: "READY", data: { completedCount: 0, totalCount: 0, pending: [] } } }))).toContain("No tienes hábitos activos para hoy.");
    expect(renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "READY", data: summarizeAresToday(schedule, new Date()) }, habits: { kind: "ERROR" } }))).toContain("No se pudieron cargar los hábitos.");
    expect(renderToStaticMarkup(createElement(AresInformationPanels, { today: { kind: "ERROR" }, habits: { kind: "READY", data: ready } }))).toContain("1</strong> de 2 completados");
  });

  it("keeps the voice entry compact by hiding redundant completed-processing feedback", () => {
    const markup = renderToStaticMarkup(createElement(VoiceCommandControls, {
      state: "IDLE",
      message: "Instrucción procesada. Revisa el resultado y confirma si se requiere.",
      onStart: vi.fn(),
      onCancel: vi.fn()
    }));

    expect(markup).toContain("¿En qué trabajamos hoy, Juli?");
    expect(markup).toContain('aria-label="Iniciar grabación por voz"');
    expect(markup).not.toContain("Instrucción procesada.");
  });
});

describe("local command-header clock", () => {
  it("formats local time in a 24-hour display and clears its one-minute updater", () => {
    expect(formatLocalClockTime(new Date("2026-10-02T18:30:00-05:00"))).toBe("18:30");
    expect(formatLocalClockDate(new Date("2026-10-02T18:30:00-05:00"))).toMatch(/2.*octubre/i);
    const update = vi.fn();
    const clearInterval = vi.fn();
    const handle = 9;
    const setInterval = vi.fn(() => handle);

    const dispose = createLocalClockUpdater(update, {
      now: () => new Date("2026-10-02T18:30:00-05:00"),
      setInterval,
      clearInterval
    });

    expect(update).toHaveBeenCalledWith("18:30");
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    dispose();
    expect(clearInterval).toHaveBeenCalledWith(handle);
  });
});
