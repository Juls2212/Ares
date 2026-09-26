import type { PlannerApi, TaskRecord, TaskPriority } from "../../../shared/planner-contracts";

export type CalendarTaskEditValues = { title: string; description: string; dueDate: string; dueTime: string; priority: TaskPriority };
export const taskEditValues = (task: TaskRecord): CalendarTaskEditValues => ({
  title: task.title, description: task.description ?? "", dueDate: task.dueDate ?? "", dueTime: task.dueTime ?? "", priority: task.priority
});
export type TaskChangeOutcome = { saved: boolean; message?: string };
const unavailable = (): TaskChangeOutcome => ({ saved: false, message: "No se pudo actualizar la tarea. Inténtalo de nuevo." });
export const saveCalendarTaskEdit = async (planner: PlannerApi | undefined, task: TaskRecord, values: CalendarTaskEditValues): Promise<TaskChangeOutcome> => {
  if (!values.title.trim()) return { saved: false, message: "Escribe un título para la tarea." };
  if (values.dueTime && !values.dueDate) return { saved: false, message: "La hora necesita una fecha de vencimiento." };
  try {
    if (!planner) return unavailable();
    const result = await planner.tasks.update({ taskId: task.id, title: values.title, description: values.description || null, dueDate: values.dueDate || null, dueTime: values.dueTime || null, priority: values.priority });
    return result.ok ? { saved: true } : { saved: false, message: "No se pudo guardar la tarea. Revisa los campos e inténtalo de nuevo." };
  } catch { return unavailable(); }
};
export const toggleCalendarTaskCompletion = async (planner: PlannerApi | undefined, task: TaskRecord, now: () => Date = () => new Date()): Promise<TaskChangeOutcome> => {
  try {
    if (!planner) return unavailable();
    const result = task.status === "COMPLETED"
      ? await planner.tasks.update({ taskId: task.id, status: "PENDING", completedAt: null })
      : await planner.tasks.complete({ taskId: task.id, completedAt: now().toISOString() });
    return result.ok ? { saved: true } : unavailable();
  } catch { return unavailable(); }
};
