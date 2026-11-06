CREATE TYPE "public"."habit_frequency" AS ENUM('DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TABLE "habit_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"habit_id" uuid NOT NULL,
	"completed_on" date NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_completions_habit_id_completed_on_unique" UNIQUE("habit_id","completed_on")
);
--> statement-breakpoint
CREATE TABLE "habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" varchar(4000),
	"category_id" uuid,
	"frequency" "habit_frequency" NOT NULL,
	"target_count" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_title_non_blank_check" CHECK (btrim("habits"."title") <> ''),
	CONSTRAINT "habits_description_non_blank_check" CHECK ("habits"."description" IS NULL OR btrim("habits"."description") <> ''),
	CONSTRAINT "habits_target_count_check" CHECK ("habits"."target_count" between 1 and 7),
	CONSTRAINT "habits_frequency_target_check" CHECK (("habits"."frequency" = 'DAILY' and "habits"."target_count" = 1) or ("habits"."frequency" = 'WEEKLY' and "habits"."target_count" between 1 and 7))
);
--> statement-breakpoint
ALTER TABLE "habit_completions" ADD CONSTRAINT "habit_completions_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "habit_completions_habit_id_completed_on_index" ON "habit_completions" USING btree ("habit_id","completed_on");--> statement-breakpoint
CREATE INDEX "habit_completions_completed_on_index" ON "habit_completions" USING btree ("completed_on");--> statement-breakpoint
CREATE INDEX "habits_active_created_at_index" ON "habits" USING btree ("active","created_at");--> statement-breakpoint
CREATE INDEX "habits_category_id_index" ON "habits" USING btree ("category_id");