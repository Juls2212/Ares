import { describe, expect, it, vi } from "vitest";
import {
  createPlannerService,
  type PlannerClock
} from "../src/main/planner/planner-service";
import {
  PlannerRepositoryError,
  type PlannerRepositories
} from "../src/main/planner/planner-repositories";
import type {
  CategoryRecord,
  EventRecord,
  PlannerOperationResult,
  ReminderRecord,
  TaskRecord,
  WeeklyRoutineRecord,
  WeeklyScheduleRecord
} from "../src/shared/planner-contracts";
import { LEGACY_TEST_MARKER } from "./helpers/read-source";
// LEGACY: scheduled for deletion in Refactor Phase 3.1. Only verifies weekly routine and schedule persistence rules (split out of planner-service).
void LEGACY_TEST_MARKER;

const categoryId = "550e8400-e29b-41d4-a716-446655440000";
const taskId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const eventId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const weeklyScheduleId = "21ae1498-1a4e-4f85-86ae-0db35afc8921";
const dateTime = "2026-09-17T14:30:00.000Z";

const category: CategoryRecord = {
  id: categoryId,
  name: "Trabajo",
  color: null,
  icon: null,
  createdAt: dateTime,
  updatedAt: dateTime
};

const task: TaskRecord = {
  id: taskId,
  title: "Informe",
  description: null,
  dueDate: "2026-09-17",
  dueTime: "09:30",
  priority: "MEDIUM",
  status: "PENDING",
  categoryId,
  completedAt: null,
  createdAt: dateTime,
  updatedAt: dateTime
};

const event: EventRecord = {
  id: eventId,
  title: "Reunión",
  description: null,
  startAt: "2026-09-17T15:00:00.000Z",
  endAt: "2026-09-17T16:00:00.000Z",
  categoryId,
  location: null,
  createdAt: dateTime,
  updatedAt: dateTime
};

const reminder: ReminderRecord = {
  id: "8c9e6679-7425-40de-944b-e07fc1f90ae7",
  title: "Llamar a Juan",
  remindAt: "2026-09-17T16:00:00.000Z",
  taskId: null,
  eventId: null,
  status: "PENDING",
  deliveredAt: null,
  createdAt: dateTime,
  updatedAt: dateTime
};

const weeklyRoutine: WeeklyRoutineRecord = {
  id: "998e6679-7425-40de-944b-e07fc1f90ae7",
  weeklyScheduleId,
  title: "Clase de diseño",
  weekday: "MONDAY",
  startTime: "08:00",
  endTime: "10:00",
  categoryId,
  location: "Aula 4",
  createdAt: dateTime,
  updatedAt: dateTime
};

const weeklySchedule: WeeklyScheduleRecord = {
  id: weeklyScheduleId,
  title: "Horario principal",
  description: null,
  color: null,
  createdAt: dateTime,
  updatedAt: dateTime
};

const clock: PlannerClock = {
  getLocalDate: () => "2026-09-17",
  getRangeBounds: (startDate, days) => ({
    startAt: `${startDate}T05:00:00.000Z`,
    endAt: days === 1 ? "2026-09-18T05:00:00.000Z" : "2026-09-21T05:00:00.000Z"
  })
};

const createRepositories = (): PlannerRepositories => ({
  createCategory: vi.fn(async () => category),
  findCategoryById: vi.fn(async () => category),
  listCategories: vi.fn(async () => [category]),
  updateCategory: vi.fn(async () => category),
  createTask: vi.fn(async () => task),
  findTaskById: vi.fn(async () => task),
  listTasks: vi.fn(async () => [task]),
  updateTask: vi.fn(async () => task),
  updateTaskCompletion: vi.fn(async () => ({ ...task, status: "COMPLETED" as const, completedAt: dateTime })),
  createEvent: vi.fn(async () => event),
  findEventById: vi.fn(async () => event),
  listEvents: vi.fn(async () => [event]),
  updateEvent: vi.fn(async () => event),
  deleteEvent: vi.fn(async () => true),
  deleteTask: vi.fn(async () => true),
  createWeeklyRoutine: vi.fn(async () => weeklyRoutine),
  findWeeklyRoutineById: vi.fn(async () => weeklyRoutine),
  listWeeklyRoutines: vi.fn(async () => [weeklyRoutine]),
  updateWeeklyRoutine: vi.fn(async () => weeklyRoutine),
  deleteWeeklyRoutine: vi.fn(async () => true),
  createWeeklySchedule: vi.fn(async () => weeklySchedule),
  findWeeklyScheduleById: vi.fn(async () => weeklySchedule),
  listWeeklySchedules: vi.fn(async () => [weeklySchedule]),
  updateWeeklySchedule: vi.fn(async () => weeklySchedule),
  deleteWeeklySchedule: vi.fn(async () => true),
  createReminder: vi.fn(async () => reminder),
  findReminderById: vi.fn(async () => reminder),
  listReminders: vi.fn(async () => [reminder])
});

const expectFailureCode = <T>(result: PlannerOperationResult<T>, code: string): void => {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
};

describe("legacy weekly routines and schedules in the planner service", () => {
  it("creates, orders, updates, and deletes weekly routines through validated repository methods", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });
    const input = {
      weeklyScheduleId,
      title: "Clase de diseño",
      weekday: "MONDAY" as const,
      startTime: "08:00",
      endTime: "10:00",
      categoryId,
      location: "Aula 4"
    };

    await expect(service.createWeeklyRoutine(input)).resolves.toEqual({ ok: true, data: { record: weeklyRoutine } });
    await expect(service.listWeeklyRoutines({ weeklyScheduleId, weekday: "MONDAY" })).resolves.toEqual({ ok: true, data: { items: [weeklyRoutine], total: 1 } });
    await expect(service.updateWeeklyRoutine({ routineId: weeklyRoutine.id, weeklyScheduleId, endTime: "11:00" })).resolves.toEqual({ ok: true, data: { record: weeklyRoutine } });
    await expect(service.deleteWeeklyRoutine({ routineId: weeklyRoutine.id })).resolves.toEqual({ ok: true, data: { deleted: true } });
    expect(repositories.createWeeklyRoutine).toHaveBeenCalledWith(input);
    expect(repositories.deleteWeeklyRoutine).toHaveBeenCalledWith({ routineId: weeklyRoutine.id });
  });
  it("rejects invalid weekly routine ranges and missing category references without persistence", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });
    expectFailureCode(await service.createWeeklyRoutine({ weeklyScheduleId, title: "Clase", weekday: "MONDAY", startTime: "10:00", endTime: "09:00" }), "PLANNER_WEEKLY_ROUTINE_TIME_RANGE_INVALID");
    vi.mocked(repositories.findCategoryById).mockResolvedValueOnce(undefined);
    expectFailureCode(await service.createWeeklyRoutine({ weeklyScheduleId, title: "Clase", weekday: "MONDAY", startTime: "08:00", endTime: "09:00", categoryId }), "PLANNER_REFERENCE_NOT_FOUND");
    expect(repositories.createWeeklyRoutine).not.toHaveBeenCalled();
  });
  it("scopes weekly routines to an existing schedule and keeps schedule deletion controlled", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });
    await expect(service.createWeeklySchedule({ title: "Clases de U", color: "#164C87" })).resolves.toEqual({ ok: true, data: { record: weeklySchedule } });
    await expect(service.listWeeklySchedules({})).resolves.toEqual({ ok: true, data: { items: [weeklySchedule], total: 1 } });
    await expect(service.updateWeeklySchedule({ weeklyScheduleId, description: "Bloques semanales" })).resolves.toEqual({ ok: true, data: { record: weeklySchedule } });
    await expect(service.deleteWeeklySchedule({ weeklyScheduleId })).resolves.toEqual({ ok: true, data: { deleted: true } });

    vi.mocked(repositories.findWeeklyScheduleById).mockResolvedValueOnce(undefined);
    expectFailureCode(await service.listWeeklyRoutines({ weeklyScheduleId }), "PLANNER_REFERENCE_NOT_FOUND");
    expect(repositories.listWeeklyRoutines).not.toHaveBeenCalled();
  });
});
