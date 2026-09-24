CREATE TABLE "event_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_notification_deliveries" ADD CONSTRAINT "event_notification_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_notification_deliveries_event_scheduled_unique" ON "event_notification_deliveries" USING btree ("event_id","scheduled_at");