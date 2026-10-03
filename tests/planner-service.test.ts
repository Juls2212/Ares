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

describe("planner service", () => {
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
  it("deletes only an existing UUID event and returns a controlled not-found result for races", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    await expect(service.deleteEvent({ eventId })).resolves.toEqual({ ok: true, data: { deleted: true } });
    expect(repositories.findEventById).toHaveBeenCalledWith(eventId);
    expect(repositories.deleteEvent).toHaveBeenCalledWith({ eventId });

    vi.mocked(repositories.deleteEvent).mockResolvedValueOnce(false);
    expectFailureCode(await service.deleteEvent({ eventId }), "PLANNER_NOT_FOUND");
    vi.mocked(repositories.findEventById).mockResolvedValueOnce(undefined);
    expectFailureCode(await service.deleteEvent({ eventId }), "PLANNER_NOT_FOUND");
    expect(repositories.deleteEvent).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed event deletion and redacts persistence failures", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });
    expectFailureCode(await service.deleteEvent({ eventId: "not-a-uuid" }), "PLANNER_IDENTIFIER_INVALID");
    expectFailureCode(await service.deleteEvent({ eventId, extra: "secret" }), "PLANNER_UNKNOWN_FIELD");
    expect(repositories.deleteEvent).not.toHaveBeenCalled();

    vi.mocked(repositories.deleteEvent).mockRejectedValueOnce(new Error("secret database detail"));
    const result = await service.deleteEvent({ eventId });
    expectFailureCode(result, "PLANNER_DATABASE_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("secret database detail");
  });
  it("creates a category after validation and returns a serializable mutation result", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    await expect(service.createCategory({ name: "  Trabajo  " })).resolves.toEqual({
      ok: true,
      data: { record: category }
    });
    expect(repositories.createCategory).toHaveBeenCalledWith({ name: "Trabajo" });
  });

  it("returns validation failures before repository access", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    const result = await service.createTask({ title: "  ", dueTime: "09:30" });

    expectFailureCode(result, "PLANNER_TEXT_INVALID");
    expect(repositories.createTask).not.toHaveBeenCalled();
  });

  it("maps unknown category, task, and event references to controlled failures", async () => {
    const repositories = createRepositories();
    vi.mocked(repositories.findCategoryById).mockResolvedValueOnce(undefined);
    vi.mocked(repositories.findTaskById).mockResolvedValueOnce(undefined);
    vi.mocked(repositories.findEventById).mockResolvedValueOnce(undefined);
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    expectFailureCode(
      await service.createTask({ title: "Informe", categoryId }),
      "PLANNER_REFERENCE_NOT_FOUND"
    );
    expectFailureCode(
      await service.createReminder({ title: "Recordatorio", remindAt: dateTime, taskId }),
      "PLANNER_REFERENCE_NOT_FOUND"
    );
    expectFailureCode(
      await service.createReminder({ title: "Recordatorio", remindAt: dateTime, eventId }),
      "PLANNER_REFERENCE_NOT_FOUND"
    );
  });

  it("maps missing targets and duplicate categories to stable failures", async () => {
    const repositories = createRepositories();
    vi.mocked(repositories.updateCategory).mockResolvedValueOnce(undefined);
    vi.mocked(repositories.createCategory).mockRejectedValueOnce(new PlannerRepositoryError("CONFLICT"));
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    expectFailureCode(
      await service.updateCategory({ categoryId, name: "Nuevo nombre" }),
      "PLANNER_NOT_FOUND"
    );
    expectFailureCode(await service.createCategory({ name: "Trabajo" }), "PLANNER_CONFLICT");
  });

  it("maps persistence foreign-key races to a controlled reference failure", async () => {
    const repositories = createRepositories();
    vi.mocked(repositories.createTask).mockRejectedValueOnce(
      new PlannerRepositoryError("REFERENCE_NOT_FOUND")
    );
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    expectFailureCode(
      await service.createTask({ title: "Informe", categoryId }),
      "PLANNER_REFERENCE_NOT_FOUND"
    );
  });

  it("updates and completes a task through the validated completion semantics", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    await expect(service.updateTask({ taskId, title: "  Informe final  " })).resolves.toMatchObject({
      ok: true,
      data: { record: task }
    });
    expect(repositories.updateTask).toHaveBeenCalledWith({ taskId, title: "Informe final" });

    const completeResult = await service.completeTask({ taskId, completedAt: dateTime });
    expect(completeResult).toMatchObject({
      ok: true,
      data: { record: { status: "COMPLETED", completedAt: dateTime } }
    });
    expect(repositories.updateTaskCompletion).toHaveBeenCalledWith(taskId, "COMPLETED", dateTime);
  });

  it("validates partial task and event updates against the persisted record", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    await expect(service.updateTask({ taskId, dueTime: "10:15" })).resolves.toMatchObject({
      ok: true
    });
    expect(repositories.updateTask).toHaveBeenCalledWith({ taskId, dueTime: "10:15" });

    vi.mocked(repositories.findTaskById).mockResolvedValueOnce({ ...task, dueDate: null });
    expectFailureCode(
      await service.updateTask({ taskId, dueTime: "10:15" }),
      "PLANNER_TASK_DUE_TIME_REQUIRES_DATE"
    );

    expectFailureCode(
      await service.updateEvent({ eventId, startAt: "2026-09-17T17:00:00.000Z" }),
      "PLANNER_EVENT_TIME_RANGE_INVALID"
    );
    expect(repositories.updateEvent).not.toHaveBeenCalled();
  });

  it("returns a controlled result when a task is already complete", async () => {
    const repositories = createRepositories();
    vi.mocked(repositories.findTaskById).mockResolvedValueOnce({
      ...task,
      status: "COMPLETED",
      completedAt: dateTime
    });
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    expectFailureCode(await service.completeTask({ taskId, completedAt: dateTime }), "PLANNER_TASK_ALREADY_COMPLETED");
    expect(repositories.updateTaskCompletion).not.toHaveBeenCalled();
  });

  it("uses injected clock bounds for deterministic today and Monday-to-Sunday week schedules", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });

    await expect(service.getTodaySchedule({})).resolves.toMatchObject({
      ok: true,
      data: { localDate: "2026-09-17", tasks: [task], events: [event], reminders: [reminder] }
    });
    expect(repositories.listTasks).toHaveBeenLastCalledWith({
      dueDateFrom: "2026-09-17",
      dueDateTo: "2026-09-17",
      includeCompleted: false
    });
    expect(repositories.listEvents).toHaveBeenLastCalledWith({
      startAt: "2026-09-17T05:00:00.000Z",
      endAt: "2026-09-18T05:00:00.000Z"
    });

    await expect(service.getWeekSchedule({})).resolves.toMatchObject({
      ok: true,
      data: { weekStart: "2026-09-14", weekEnd: "2026-09-20" }
    });
    expect(repositories.listTasks).toHaveBeenLastCalledWith({
      dueDateFrom: "2026-09-14",
      dueDateTo: "2026-09-20",
      includeCompleted: false
    });
    expect(repositories.listEvents).toHaveBeenLastCalledWith({
      startAt: "2026-09-14T05:00:00.000Z",
      endAt: "2026-09-21T05:00:00.000Z"
    });
  });

  it("maps unexpected repository errors without leaking database details", async () => {
    const repositories = createRepositories();
    const password = "do-not-expose-this-password";
    vi.mocked(repositories.listTasks).mockRejectedValueOnce(
      new Error(`connection failed for ${password}`)
    );
    const logError = vi.fn();
    const service = createPlannerService({ repositories, clock, logError });

    const result = await service.listTasks({});

    expectFailureCode(result, "PLANNER_DATABASE_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain(password);
    expect(logError).toHaveBeenCalledWith("Planner persistence operation failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toContain(password);
  });
  it("validates task deletion, checks existence, and deletes only the requested task", async () => {
    const repositories = createRepositories();
    const service = createPlannerService({ repositories, clock, logError: vi.fn() });
    expectFailureCode(await service.deleteTask({ taskId: "invalid" }), "PLANNER_IDENTIFIER_INVALID");
    expectFailureCode(await service.deleteTask({ taskId: task.id, extra: true }), "PLANNER_UNKNOWN_FIELD");
    expect(repositories.deleteTask).not.toHaveBeenCalled();
    vi.mocked(repositories.findTaskById).mockResolvedValueOnce(undefined);
    expectFailureCode(await service.deleteTask({ taskId: task.id }), "PLANNER_NOT_FOUND");
    expect(repositories.deleteTask).not.toHaveBeenCalled();
    expect(await service.deleteTask({ taskId: task.id })).toEqual({ ok: true, data: { deleted: true } });
    expect(repositories.deleteTask).toHaveBeenCalledWith({ taskId: task.id });
  });
});
