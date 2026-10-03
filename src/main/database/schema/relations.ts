import { relations } from "drizzle-orm";
import { applicationAliases } from "./application-aliases";
import { applications } from "./applications";
import { categories } from "./categories";
import { eventNotificationDeliveries } from "./event-notification-deliveries";
import { events } from "./events";
import { reminders } from "./reminders";
import { tasks } from "./tasks";
import { weeklyRoutines } from "./weekly-routines";
import { weeklySchedules } from "./weekly-schedules";

export const categoriesRelations = relations(categories, ({ many }) => ({
  tasks: many(tasks),
  events: many(events),
  weeklyRoutines: many(weeklyRoutines)
}));

export const tasksRelations = relations(tasks, ({ many, one }) => ({
  category: one(categories, {
    fields: [tasks.categoryId],
    references: [categories.id]
  }),
  reminders: many(reminders),
  notificationDeliveries: many(eventNotificationDeliveries)
}));

export const eventNotificationDeliveriesRelations = relations(
  eventNotificationDeliveries,
  ({ one }) => ({
    event: one(events, {
      fields: [eventNotificationDeliveries.eventId],
      references: [events.id]
    })
  })
);

export const eventsRelations = relations(events, ({ many, one }) => ({
  category: one(categories, {
    fields: [events.categoryId],
    references: [categories.id]
  }),
  reminders: many(reminders)
}));

export const weeklyRoutinesRelations = relations(weeklyRoutines, ({ one }) => ({
  weeklySchedule: one(weeklySchedules, {
    fields: [weeklyRoutines.weeklyScheduleId],
    references: [weeklySchedules.id]
  }),
  category: one(categories, {
    fields: [weeklyRoutines.categoryId],
    references: [categories.id]
  })
}));

export const weeklySchedulesRelations = relations(weeklySchedules, ({ many }) => ({
  routines: many(weeklyRoutines)
}));

export const remindersRelations = relations(reminders, ({ one }) => ({
  task: one(tasks, {
    fields: [reminders.taskId],
    references: [tasks.id]
  }),
  event: one(events, {
    fields: [reminders.eventId],
    references: [events.id]
  })
}));

export const applicationsRelations = relations(applications, ({ many }) => ({
  aliases: many(applicationAliases)
}));

export const applicationAliasesRelations = relations(applicationAliases, ({ one }) => ({
  application: one(applications, {
    fields: [applicationAliases.applicationId],
    references: [applications.id]
  })
}));
