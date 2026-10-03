import type {
  EventRecord,
  PlannerApi,
  ReminderRecord,
  TaskRecord,
  TodayScheduleData
} from "../../../shared/planner-contracts";

export type AresTodayData = {
  pendingTasks: number;
  completedTasks: number;
  totalEvents: number;
  upcomingEvents: EventRecord[];
  currentHighPriorityTask?: TaskRecord;
  nextReminder?: ReminderRecord;
};

export type AresTodayState =
  | { kind: "LOADING" }
  | { kind: "READY"; data: AresTodayData }
  | { kind: "ERROR" };

const isUpcoming = (event: EventRecord, now: Date): boolean => {
  const startAt = new Date(event.startAt);
  return Number.isFinite(startAt.getTime()) && startAt.getTime() >= now.getTime();
};

export const summarizeAresToday = (schedule: TodayScheduleData, now: Date): AresTodayData => {
  const completedTasks = schedule.tasks.filter((task: TaskRecord) => task.status === "COMPLETED").length;
  const currentHighPriorityTask = schedule.tasks.find((task) =>
    task.priority === "HIGH" && task.status !== "COMPLETED"
  );
  const upcomingEvents = schedule.events
    .filter((event) => isUpcoming(event, now))
    .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
    .slice(0, 3);
  const nextReminder = schedule.reminders
    .filter((reminder) => {
      const remindAt = new Date(reminder.remindAt);
      return reminder.status === "PENDING" && Number.isFinite(remindAt.getTime()) && remindAt.getTime() >= now.getTime();
    })
    .sort((left, right) => new Date(left.remindAt).getTime() - new Date(right.remindAt).getTime())[0];

  return {
    pendingTasks: schedule.tasks.length - completedTasks,
    completedTasks,
    totalEvents: schedule.events.length,
    upcomingEvents,
    currentHighPriorityTask,
    nextReminder
  };
};

/** Reads the existing, read-only today schedule without exposing source-specific errors. */
export const loadAresToday = async (
  planner: PlannerApi | undefined,
  now: Date = new Date()
): Promise<AresTodayState> => {
  if (!planner) return { kind: "ERROR" };
  try {
    const result = await planner.schedule.getToday({ includeCompletedTasks: true });
    return result.ok ? { kind: "READY", data: summarizeAresToday(result.data, now) } : { kind: "ERROR" };
  } catch {
    return { kind: "ERROR" };
  }
};

export const formatAresEventTime = (event: EventRecord): string | undefined => {
  const startAt = new Date(event.startAt);
  if (!Number.isFinite(startAt.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(startAt);
  } catch {
    return undefined;
  }
};

export const formatAresReminderTime = (reminder: ReminderRecord): string | undefined => {
  const remindAt = new Date(reminder.remindAt);
  if (!Number.isFinite(remindAt.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(remindAt);
  } catch {
    return undefined;
  }
};
