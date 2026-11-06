import { pgEnum } from "drizzle-orm/pg-core";

export const taskStatusValues = ["PENDING", "IN_PROGRESS", "COMPLETED"] as const;
export const taskPriorityValues = ["LOW", "MEDIUM", "HIGH"] as const;
export const reminderStatusValues = ["PENDING", "TRIGGERED", "CANCELLED"] as const;
export const actionResultStatusValues = [
  "SUCCEEDED",
  "CANCELLED",
  "VALIDATION_FAILED",
  "EXECUTION_FAILED",
  "DEPENDENCY_SKIPPED"
] as const;
export const applicationPlatformValues = ["WINDOWS", "MACOS", "LINUX"] as const;
export const applicationLaunchModeValues = [
  "WINDOWS_EXECUTABLE",
  "CATALOG_APPLICATION"
] as const;
export const applicationCatalogKeyValues = [
  "GOOGLE_CHROME",
  "MICROSOFT_EDGE",
  "MOZILLA_FIREFOX",
  "SPOTIFY",
  "WHATSAPP",
  "MICROSOFT_WORD",
  "VISUAL_STUDIO_CODE",
  "DISCORD",
  "CLAUDE"
] as const;
export const riskLevelValues = [1, 2, 3] as const;
export const weekdayValues = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export const habitFrequencyValues = ["DAILY", "WEEKLY"] as const;

export const taskStatusEnum = pgEnum("task_status", taskStatusValues);
export const taskPriorityEnum = pgEnum("task_priority", taskPriorityValues);
export const reminderStatusEnum = pgEnum("reminder_status", reminderStatusValues);
export const actionResultStatusEnum = pgEnum(
  "action_result_status",
  actionResultStatusValues
);
export const applicationPlatformEnum = pgEnum(
  "application_platform",
  applicationPlatformValues
);
export const applicationLaunchModeEnum = pgEnum(
  "application_launch_mode",
  applicationLaunchModeValues
);
export const applicationCatalogKeyEnum = pgEnum(
  "application_catalog_key",
  applicationCatalogKeyValues
);
export const weekdayEnum = pgEnum("weekday", weekdayValues);
export const habitFrequencyEnum = pgEnum("habit_frequency", habitFrequencyValues);

export type TaskStatus = (typeof taskStatusValues)[number];
export type TaskPriority = (typeof taskPriorityValues)[number];
export type ReminderStatus = (typeof reminderStatusValues)[number];
export type ActionResultStatus = (typeof actionResultStatusValues)[number];
export type ApplicationPlatform = (typeof applicationPlatformValues)[number];
export type ApplicationLaunchMode = (typeof applicationLaunchModeValues)[number];
export type ApplicationCatalogKey = (typeof applicationCatalogKeyValues)[number];
export type RiskLevel = (typeof riskLevelValues)[number];
export type Weekday = (typeof weekdayValues)[number];
export type HabitFrequency = (typeof habitFrequencyValues)[number];
