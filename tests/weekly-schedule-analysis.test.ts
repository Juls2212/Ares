import { describe, expect, it, vi } from "vitest";

import {
  createWeeklyScheduleAnalysisService,
  createWeeklyScheduleReferenceResolver
} from "../src/main/actions/weekly-schedule-analysis";
import type { PlannerService } from "../src/main/planner/planner-service";
import type { TodayScheduleData, WeeklyRoutineRecord, WeeklyScheduleRecord } from "../src/shared/planner-contracts";

const schedule = (id: string, title: string): WeeklyScheduleRecord => ({
  id,
  title,
  description: null,
  color: null,
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z"
});

const routine = (
  id: string,
  weekday: WeeklyRoutineRecord["weekday"],
  startTime: string,
  endTime: string,
  title = id
): WeeklyRoutineRecord => ({
  id,
  weeklyScheduleId: "schedule-university",
  title,
  weekday,
  startTime,
  endTime,
  categoryId: null,
  location: null,
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z"
});

const plannerFor = (
  schedules: WeeklyScheduleRecord[] = [schedule("schedule-university", "Universidad")],
  routines: WeeklyRoutineRecord[] = [],
  today: TodayScheduleData = { localDate: "2026-10-03", tasks: [], events: [], reminders: [] }
): Pick<PlannerService, "listWeeklySchedules" | "listWeeklyRoutines" | "getTodaySchedule"> => ({
  listWeeklySchedules: vi.fn(async () => ({ ok: true as const, data: { items: schedules, total: schedules.length } })),
  listWeeklyRoutines: vi.fn(async ({ weeklyScheduleId }) => ({
    ok: true as const,
    data: { items: routines.filter((item) => item.weeklyScheduleId === weeklyScheduleId), total: routines.length }
  })),
  getTodaySchedule: vi.fn(async () => ({ ok: true as const, data: today }))
});

describe("weekly schedule analysis", () => {
  it("resolves only exact normalized schedule titles and controls unknown or ambiguous references", async () => {
    const resolved = createWeeklyScheduleReferenceResolver(() => plannerFor([schedule("one", "Universidad")])) ;
    await expect(resolved("  universidad ")).resolves.toEqual({ state: "RESOLVED", title: "Universidad" });
    await expect(resolved("Trabajo")).resolves.toEqual({ state: "MISSING" });

    const ambiguous = createWeeklyScheduleReferenceResolver(() => plannerFor([
      schedule("one", "Universidad"),
      schedule("two", "UNIVERSIDAD")
    ]));
    await expect(ambiguous("universidad")).resolves.toEqual({ state: "AMBIGUOUS" });
  });

  it("derives detailed totals and a deterministic busiest weekday only from real routine records", async () => {
    const routines = [
      routine("monday", "MONDAY", "08:00", "10:00", "Álgebra"),
      routine("tuesday", "TUESDAY", "09:00", "11:00", "Física")
    ];
    const service = createWeeklyScheduleAnalysisService({ plannerService: plannerFor(undefined, routines), timeZone: () => "America/Bogota" });

    const details = await service.getDetails({ scheduleTitle: "Universidad" });
    const busiest = await service.analyze({ scheduleTitle: "Universidad", analysis: "BUSIEST_DAY" });

    expect(details).toMatchObject({ ok: true, data: { summary: expect.stringContaining("4 horas") } });
    expect(JSON.stringify(details)).toContain("Álgebra");
    expect(JSON.stringify(details)).not.toContain("schedule-university");
    expect(busiest).toMatchObject({ ok: true, data: { summary: expect.stringContaining("lunes") } });
  });

  it("merges overlapping blocks before calculating bounded weekly free intervals and reports conflicts", async () => {
    const routines = [
      routine("one", "MONDAY", "08:00", "12:00", "Bloque uno"),
      routine("two", "MONDAY", "10:00", "13:00", "Bloque dos"),
      routine("tuesday", "TUESDAY", "06:00", "22:00"),
      routine("wednesday", "WEDNESDAY", "06:00", "22:00"),
      routine("thursday", "THURSDAY", "06:00", "22:00"),
      routine("friday", "FRIDAY", "06:00", "22:00"),
      routine("saturday", "SATURDAY", "06:00", "22:00"),
      routine("sunday", "SUNDAY", "06:00", "22:00")
    ];
    const service = createWeeklyScheduleAnalysisService({ plannerService: plannerFor(undefined, routines), timeZone: () => "America/Bogota" });

    const availability = await service.analyze({ scheduleTitle: "Universidad", analysis: "AVAILABILITY" });
    const overlaps = await service.analyze({ scheduleTitle: "Universidad", analysis: "OVERLAPS" });

    expect(availability).toMatchObject({ ok: true, data: { summary: expect.stringContaining("lunes de 13:00 a 22:00") } });
    expect(JSON.stringify(availability)).not.toContain("10:00 a 12:00");
    expect(overlaps).toMatchObject({ ok: true, data: { summary: expect.stringContaining("1 cruce") } });
  });

  it("returns a grounded no-conflict response for a schedule without overlap", async () => {
    const service = createWeeklyScheduleAnalysisService({
      plannerService: plannerFor(undefined, [routine("one", "MONDAY", "08:00", "09:00")]),
      timeZone: () => "America/Bogota"
    });

    await expect(service.analyze({ scheduleTitle: "Universidad", analysis: "OVERLAPS" })).resolves.toEqual({
      ok: true,
      data: { summary: "No encontré cruces entre los bloques de «Universidad»." }
    });
  });

  it("treats real event intervals as occupied today while preserving task due times as deadlines", async () => {
    const service = createWeeklyScheduleAnalysisService({
      plannerService: plannerFor(undefined, [], {
        localDate: "2026-10-03",
        tasks: [{ id: "task-private", title: "Entregar informe", dueTime: "16:00" }],
        events: [{ id: "event-private", title: "Clase", startAt: "2026-10-03T19:00:00.000Z", endAt: "2026-10-03T20:00:00.000Z" }],
        reminders: []
      } as unknown as TodayScheduleData),
      timeZone: () => "America/Bogota"
    });

    const result = await service.getTodayAvailability({ afterTime: "14:00" });
    expect(result).toMatchObject({ ok: true, data: { summary: expect.stringContaining("Clase de 14:00 a 15:00") } });
    expect(JSON.stringify(result)).toContain("Entregar informe vence a las 16:00");
    expect(JSON.stringify(result)).toContain("15:00–22:00");
    expect(JSON.stringify(result)).not.toContain("task-private");
    expect(JSON.stringify(result)).not.toContain("event-private");
  });

  it("maps unavailable planner data to a controlled Spanish result without mutating records", async () => {
    const planner = plannerFor();
    vi.mocked(planner.listWeeklySchedules).mockResolvedValueOnce({
      ok: false,
      error: { code: "PLANNER_DATABASE_UNAVAILABLE", userMessage: "private" }
    });
    const service = createWeeklyScheduleAnalysisService({ plannerService: planner, timeZone: () => "America/Bogota" });
    const result = await service.getDetails({ scheduleTitle: "Universidad" });

    expect(result).toEqual({
      ok: false,
      error: { code: "PLANNER_DATABASE_UNAVAILABLE", userMessage: "No se pudieron consultar los horarios semanales." }
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
