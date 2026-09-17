CREATE TYPE "public"."action_result_status" AS ENUM('SUCCEEDED', 'CANCELLED', 'VALIDATION_FAILED', 'EXECUTION_FAILED', 'DEPENDENCY_SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."application_platform" AS ENUM('WINDOWS');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('PENDING', 'TRIGGERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "action_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" varchar(128) NOT NULL,
	"action_name" varchar(80) NOT NULL,
	"risk_level" smallint NOT NULL,
	"result_status" "action_result_status" NOT NULL,
	"user_summary" varchar(500) NOT NULL,
	"error_code" varchar(128),
	"metadata" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_history_action_id_non_blank_check" CHECK (btrim("action_history"."action_id") <> ''),
	CONSTRAINT "action_history_action_name_non_blank_check" CHECK (btrim("action_history"."action_name") <> ''),
	CONSTRAINT "action_history_user_summary_non_blank_check" CHECK (btrim("action_history"."user_summary") <> ''),
	CONSTRAINT "action_history_risk_level_check" CHECK ("action_history"."risk_level" IN (1, 2, 3)),
	CONSTRAINT "action_history_finished_after_started_check" CHECK ("action_history"."finished_at" IS NULL OR "action_history"."finished_at" >= "action_history"."started_at")
);
--> statement-breakpoint
CREATE TABLE "application_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"alias" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_aliases_alias_non_blank_check" CHECK (btrim("application_aliases"."alias") <> '')
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"executable_path" varchar(2048) NOT NULL,
	"platform" "application_platform" DEFAULT 'WINDOWS' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_launched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_name_non_blank_check" CHECK (btrim("applications"."name") <> ''),
	CONSTRAINT "applications_executable_path_non_blank_check" CHECK (btrim("applications"."executable_path") <> '')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"color" varchar(7),
	"icon" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_non_blank_check" CHECK (btrim("categories"."name") <> ''),
	CONSTRAINT "categories_color_format_check" CHECK ("categories"."color" IS NULL OR "categories"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" varchar(4000),
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"category_id" uuid,
	"location" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_title_non_blank_check" CHECK (btrim("events"."title") <> ''),
	CONSTRAINT "events_time_range_check" CHECK ("events"."end_at" IS NULL OR "events"."end_at" > "events"."start_at")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"task_id" uuid,
	"event_id" uuid,
	"status" "reminder_status" DEFAULT 'PENDING' NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_title_non_blank_check" CHECK (btrim("reminders"."title") <> ''),
	CONSTRAINT "reminders_single_association_check" CHECK (NOT ("reminders"."task_id" IS NOT NULL AND "reminders"."event_id" IS NOT NULL)),
	CONSTRAINT "reminders_delivery_state_check" CHECK (("reminders"."status" = 'TRIGGERED' AND "reminders"."delivered_at" IS NOT NULL) OR ("reminders"."status" <> 'TRIGGERED' AND "reminders"."delivered_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"setting_key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_format_check" CHECK ("settings"."setting_key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" varchar(4000),
	"due_date" date,
	"due_time" time,
	"priority" "task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"status" "task_status" DEFAULT 'PENDING' NOT NULL,
	"category_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title_non_blank_check" CHECK (btrim("tasks"."title") <> ''),
	CONSTRAINT "tasks_due_time_requires_date_check" CHECK ("tasks"."due_time" IS NULL OR "tasks"."due_date" IS NOT NULL),
	CONSTRAINT "tasks_completion_state_check" CHECK (("tasks"."status" = 'COMPLETED' AND "tasks"."completed_at" IS NOT NULL) OR ("tasks"."status" <> 'COMPLETED' AND "tasks"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "application_aliases" ADD CONSTRAINT "application_aliases_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_history_action_id_unique" ON "action_history" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "action_history_started_at_index" ON "action_history" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "action_history_action_name_index" ON "action_history" USING btree ("action_name");--> statement-breakpoint
CREATE INDEX "action_history_result_status_index" ON "action_history" USING btree ("result_status");--> statement-breakpoint
CREATE UNIQUE INDEX "application_aliases_alias_lower_unique" ON "application_aliases" USING btree (lower(btrim("alias")));--> statement-breakpoint
CREATE INDEX "application_aliases_application_id_index" ON "application_aliases" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_executable_path_lower_unique" ON "applications" USING btree (lower(btrim("executable_path")));--> statement-breakpoint
CREATE INDEX "applications_favorite_index" ON "applications" USING btree ("is_favorite");--> statement-breakpoint
CREATE INDEX "applications_enabled_index" ON "applications" USING btree ("is_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_lower_unique" ON "categories" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "events_start_at_index" ON "events" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "events_category_id_index" ON "events" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "reminders_pending_remind_at_index" ON "reminders" USING btree ("remind_at") WHERE "reminders"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "reminders_task_id_index" ON "reminders" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "reminders_event_id_index" ON "reminders" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tasks_status_index" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_due_date_index" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_category_id_index" ON "tasks" USING btree ("category_id");