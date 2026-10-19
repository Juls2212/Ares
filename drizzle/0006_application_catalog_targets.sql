CREATE TYPE "public"."application_catalog_key" AS ENUM('GOOGLE_CHROME', 'MICROSOFT_EDGE', 'MOZILLA_FIREFOX', 'SPOTIFY', 'WHATSAPP', 'MICROSOFT_WORD', 'VISUAL_STUDIO_CODE', 'DISCORD');--> statement-breakpoint
CREATE TYPE "public"."application_launch_mode" AS ENUM('WINDOWS_EXECUTABLE', 'CATALOG_APPLICATION');--> statement-breakpoint
ALTER TYPE "public"."application_platform" ADD VALUE 'MACOS';--> statement-breakpoint
ALTER TYPE "public"."application_platform" ADD VALUE 'LINUX';--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_executable_path_non_blank_check";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "executable_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "launch_mode" "application_launch_mode" DEFAULT 'WINDOWS_EXECUTABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "catalog_key" "application_catalog_key";--> statement-breakpoint
UPDATE "applications" SET "platform" = 'WINDOWS', "launch_mode" = 'WINDOWS_EXECUTABLE', "catalog_key" = NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_launch_target_check" CHECK (("applications"."launch_mode" = 'WINDOWS_EXECUTABLE' AND "applications"."platform" = 'WINDOWS' AND "applications"."catalog_key" IS NULL) OR ("applications"."launch_mode" = 'CATALOG_APPLICATION' AND "applications"."catalog_key" IS NOT NULL AND "applications"."executable_path" IS NULL));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_executable_path_non_blank_check" CHECK (("applications"."launch_mode" = 'WINDOWS_EXECUTABLE' AND btrim("applications"."executable_path") <> '') OR ("applications"."launch_mode" = 'CATALOG_APPLICATION' AND "applications"."executable_path" IS NULL));
