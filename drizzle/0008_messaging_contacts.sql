CREATE TABLE "messaging_contact_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"alias" varchar(40) NOT NULL,
	"lookup_key" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_contact_aliases_alias_non_blank_check" CHECK (btrim("messaging_contact_aliases"."alias") <> ''),
	CONSTRAINT "messaging_contact_aliases_lookup_key_non_blank_check" CHECK (btrim("messaging_contact_aliases"."lookup_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "messaging_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" varchar(40) NOT NULL,
	"lookup_key" varchar(80) NOT NULL,
	"phone_digits" varchar(15) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_contacts_display_name_non_blank_check" CHECK (btrim("messaging_contacts"."display_name") <> ''),
	CONSTRAINT "messaging_contacts_lookup_key_non_blank_check" CHECK (btrim("messaging_contacts"."lookup_key") <> ''),
	CONSTRAINT "messaging_contacts_phone_digits_format_check" CHECK ("messaging_contacts"."phone_digits" ~ '^[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "messaging_contact_aliases" ADD CONSTRAINT "messaging_contact_aliases_contact_id_messaging_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."messaging_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_contact_aliases_lookup_key_unique" ON "messaging_contact_aliases" USING btree ("lookup_key");--> statement-breakpoint
CREATE INDEX "messaging_contact_aliases_contact_id_index" ON "messaging_contact_aliases" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_contacts_lookup_key_unique" ON "messaging_contacts" USING btree ("lookup_key");
