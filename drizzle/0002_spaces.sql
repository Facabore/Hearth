CREATE TABLE "space_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"role" text,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "space_members_space_user" UNIQUE("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"period_policy" jsonb NOT NULL,
	"personal_owner_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spaces_personal_owner_user_id_unique" UNIQUE("personal_owner_user_id"),
	CONSTRAINT "spaces_personal_owner" CHECK (("spaces"."kind" = 'PERSONAL') = ("spaces"."personal_owner_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_personal_owner_user_id_user_id_fk" FOREIGN KEY ("personal_owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_members_user_id_idx" ON "space_members" USING btree ("user_id");