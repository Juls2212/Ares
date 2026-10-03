CREATE TYPE "public"."weekday" AS ENUM('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');--> statement-breakpoint
CREATE TABLE "weekly_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"weekday" "weekday" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"category_id" uuid,
	"location" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_routines_title_non_blank_check" CHECK (btrim("weekly_routines"."title") <> ''),
	CONSTRAINT "weekly_routines_location_non_blank_check" CHECK ("weekly_routines"."location" IS NULL OR btrim("weekly_routines"."location") <> ''),
	CONSTRAINT "weekly_routines_time_range_check" CHECK ("weekly_routines"."end_time" > "weekly_routines"."start_time")
);
--> statement-breakpoint
ALTER TABLE "weekly_routines" ADD CONSTRAINT "weekly_routines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "weekly_routines_weekday_start_time_index" ON "weekly_routines" USING btree ("weekday","start_time");--> statement-breakpoint
CREATE INDEX "weekly_routines_category_id_index" ON "weekly_routines" USING btree ("category_id");