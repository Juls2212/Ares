-- Removes the habit and weekly schedule features. This permanently deletes every row in the dropped tables.
-- Order: dependent tables first, then their parents, then the enum types that only these tables used.
-- No surviving table references a dropped table; dropping a table also drops its own indexes, checks and foreign keys.
DROP TABLE IF EXISTS "habit_completions";--> statement-breakpoint
DROP TABLE IF EXISTS "habits";--> statement-breakpoint
DROP TABLE IF EXISTS "weekly_routines";--> statement-breakpoint
DROP TABLE IF EXISTS "weekly_schedules";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."habit_frequency";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."weekday";
