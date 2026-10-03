CREATE TABLE "weekly_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" varchar(4000),
	"color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_schedules_title_non_blank_check" CHECK (btrim("weekly_schedules"."title") <> ''),
	CONSTRAINT "weekly_schedules_description_non_blank_check" CHECK ("weekly_schedules"."description" IS NULL OR btrim("weekly_schedules"."description") <> ''),
	CONSTRAINT "weekly_schedules_color_format_check" CHECK ("weekly_schedules"."color" IS NULL OR "weekly_schedules"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
DROP INDEX "weekly_routines_weekday_start_time_index";--> statement-breakpoint
INSERT INTO "weekly_schedules" ("id", "title") VALUES ('21ae1498-1a4e-4f85-86ae-0db35afc8921', 'Horario principal');--> statement-breakpoint
ALTER TABLE "weekly_routines" ADD COLUMN "weekly_schedule_id" uuid;--> statement-breakpoint
UPDATE "weekly_routines" SET "weekly_schedule_id" = '21ae1498-1a4e-4f85-86ae-0db35afc8921' WHERE "weekly_schedule_id" IS NULL;--> statement-breakpoint
ALTER TABLE "weekly_routines" ALTER COLUMN "weekly_schedule_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_schedules_title_lower_unique" ON "weekly_schedules" USING btree (lower(btrim("title")));--> statement-breakpoint
ALTER TABLE "weekly_routines" ADD CONSTRAINT "weekly_routines_weekly_schedule_id_weekly_schedules_id_fk" FOREIGN KEY ("weekly_schedule_id") REFERENCES "public"."weekly_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_routines_schedule_weekday_start_time_index" ON "weekly_routines" USING btree ("weekly_schedule_id","weekday","start_time");
