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
  TaskRecord
} from "../src/shared/planner-contracts";

const categoryId = "550e8400-e29b-41d4-a716-446655440000";
const taskId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const eventId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
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
});
